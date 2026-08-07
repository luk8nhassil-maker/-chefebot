import { randomUUID } from "crypto";
import { redis } from "@/lib/redis";

// Lock GLOBAL da chave Redis "pedidos" (achado da auditoria de lost update:
// ver docs/architecture/REDIS_KEY_INVENTORY.md, seção 1, e o relatório do
// incidente). Protege a seção crítica de leitura-modificação-escrita do
// array INTEIRO contra QUALQUER outro escritor cooperante — criação, status,
// edição, Pix (webhook e manual), escalonamento, arquivamento, crons — não
// só o mesmo pedidoId. O mutex de edição por pedido em pedidoEdicao.ts
// continua existindo para a regra de negócio "cliente está editando este
// pedido específico"; este lock aqui é ortogonal e mais amplo: garante que
// NENHUMA escrita de "pedidos" parte de um snapshot desatualizado, seja qual
// for o pedidoId envolvido (ou mesmo sem pedidoId nenhum, como a limpeza
// preguiçosa do GET /api/orders).
//
// Mesmo padrão SET NX + TTL curto + token, já validado e em produção em
// src/lib/fidelidade.ts (comBloqueioCliente/liberarLockPontosSeDono) —
// replicado aqui, mas com uma correção deliberada em relação ao mutex de
// EDIÇÃO por pedido (liberarMutexEdicao, em pedidoEdicao.ts): aquele faz
// GET-depois-DEL em duas operações separadas, o que abre uma janela real —
// entre o GET confirmar o token e o DEL rodar, o TTL pode expirar, outro
// dono pode adquirir, e o DEL do dono antigo apagaria o lock do dono NOVO.
// A liberação abaixo nunca faz isso: é sempre um único script Lua
// (GET+DEL condicional), atômico no servidor Redis, sem essa janela.

const CHAVE_MUTEX_PEDIDOS = "pedidos:mutex:global";
const MUTEX_TTL_SEGUNDOS = 5;
const MUTEX_MAX_TENTATIVAS = 50;
const MUTEX_ESPERA_MS = 20;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MutexPedidosIndisponivelError extends Error {
  constructor(motivo: string) {
    super(`Não foi possível adquirir o lock global de "pedidos": ${motivo}`);
    this.name = "MutexPedidosIndisponivelError";
  }
}

/**
 * Adquire o lock global — nunca devolve um token sem ter reivindicado a
 * chave de verdade (SET NX confirmado). Se o SET NX lançar (resultado
 * incerto: o Redis pode ou não ter aplicado a escrita antes de falhar a
 * resposta), trata como tentativa falha e tenta de novo com um token NOVO —
 * seguro porque o TTL curto garante que um acerto "fantasma" de uma
 * tentativa anterior nunca prende a chave além de `MUTEX_TTL_SEGUNDOS`.
 * Esgotadas as tentativas, lança `MutexPedidosIndisponivelError` — nunca
 * finge ter adquirido o lock.
 */
export async function adquirirMutexPedidos(): Promise<string> {
  for (let tentativa = 0; tentativa < MUTEX_MAX_TENTATIVAS; tentativa++) {
    const token = randomUUID();
    let obtido: unknown;
    try {
      obtido = await redis.set(CHAVE_MUTEX_PEDIDOS, token, { nx: true, ex: MUTEX_TTL_SEGUNDOS });
    } catch {
      obtido = null;
    }
    if (obtido) return token;
    await esperar(MUTEX_ESPERA_MS);
  }
  throw new MutexPedidosIndisponivelError(`${MUTEX_MAX_TENTATIVAS} tentativas esgotadas`);
}

const LIBERAR_MUTEX_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

/**
 * Libera o lock global SOMENTE se o token ainda for o dono atual da chave —
 * compare-and-delete atômico via Lua, nunca um GET seguido de um DEL em duas
 * chamadas separadas (ver nota de topo do arquivo). Um dono cujo TTL expirou
 * NUNCA apaga o lock de quem assumiu depois: o valor atual da chave já não é
 * mais o token dele, o script não apaga nada e devolve 0. Best-effort: se a
 * própria liberação falhar (Redis indisponível na hora do DEL), o TTL curto
 * garante que o lock não fica preso para sempre.
 */
export async function liberarMutexPedidos(token: string): Promise<void> {
  try {
    await redis.eval(LIBERAR_MUTEX_LUA, [CHAVE_MUTEX_PEDIDOS], [token]);
  } catch {
    // best-effort — TTL garante que o lock não fica preso para sempre.
  }
}

export type ResultadoMutacaoPedidos<TPedido, TResultado> =
  | { persistir: true; pedidos: TPedido[]; resultado: TResultado }
  | { persistir: false; resultado: TResultado };

/**
 * Executa uma leitura-modificação-escrita ATÔMICA (em relação a qualquer
 * OUTRO chamador de `mutarPedidos`, e a `adquirirMutexPedidos`/
 * `liberarMutexPedidos` usados diretamente) sobre a chave "pedidos":
 * adquire o lock global, relê "pedidos" FRESCO de dentro do lock (nunca
 * reaproveita um array lido antes de adquirir), aplica `fn` sobre esse
 * snapshot fresco, grava o resultado só se `persistir: true`, e libera o
 * lock sempre — mesmo se `fn` ou a escrita lançarem (erro nunca prende o
 * lock além do necessário nem impede a liberação).
 *
 * `fn` decide se algo deve ser persistido: `persistir: false` é o caso de
 * uma pré-condição que deixou de valer depois de reler o estado fresco
 * (ex.: "id não encontrado", "já estava confirmado por outro caminho") —
 * nada é escrito, exatamente como cada chamador já fazia antes desta
 * migração (nenhuma pré-condição/efeito foi alterado, só o acesso a
 * "pedidos" passou a ser sob lock).
 *
 * Erros de persistência (a chamada a `redis.set` dentro daqui) NUNCA são
 * engolidos — propagam para quem chamou, que mantém seu próprio
 * tratamento/reconciliação já existente (ex.: pedido-app relê e reconcilia
 * após uma exceção de persistência; isso continua funcionando sem mudança,
 * porque `mutarPedidos` não intercepta a exceção).
 *
 * NUNCA segure este lock durante uma chamada HTTP externa (Mercado Pago,
 * Evolution/WhatsApp, Web Push, impressão) — prepare os dados fora, e só
 * entre no lock para a parte curta e local (reler, validar, mutar,
 * persistir). Para o único fluxo que precisa combinar a escrita de
 * "pedidos" com outra chave na MESMA operação atômica (entregador, ver
 * orders/route.ts), use `adquirirMutexPedidos`/`liberarMutexPedidos`
 * diretamente ao redor da leitura fresca + validação + chamada ao script Lua
 * existente (que continua sendo a operação atômica de persistência entre as
 * duas chaves) em vez deste helper.
 */
export async function mutarPedidos<TPedido, TResultado>(
  fn: (
    pedidosFrescos: TPedido[]
  ) => ResultadoMutacaoPedidos<TPedido, TResultado> | Promise<ResultadoMutacaoPedidos<TPedido, TResultado>>
): Promise<TResultado> {
  const token = await adquirirMutexPedidos();
  try {
    const pedidosFrescos = (await redis.get<TPedido[]>("pedidos")) || [];
    const resultado = await fn(pedidosFrescos);
    if (resultado.persistir) {
      await redis.set("pedidos", resultado.pedidos);
    }
    return resultado.resultado;
  } finally {
    await liberarMutexPedidos(token);
  }
}
