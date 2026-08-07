import { redis } from "./redis";

// Gera o número sequencial do pedido para o dia atual (1, 2, 3...).
// Usa INCR atômico no Redis — seguro mesmo se dois pedidos chegarem ao mesmo tempo.
// A chave inclui a data (America/Sao_Paulo) para resetar naturalmente todos os dias.
// O cron das 3am também limpa essa chave explicitamente (ver /api/cron), então o reset
// acontece tanto pela troca de data quanto por limpeza ativa — não depende de timestamp nem de ID aleatório.
export async function proximoNumeroPedido(): Promise<number> {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); // ex: "17/06/2026"
  const chave = `contador_pedidos:${hoje}`;
  const numero = await redis.incr(chave);
  // Garante que a chave não fique acumulando para sempre (expira em 36h, bem depois do reset das 3am)
  if (numero === 1) {
    await redis.expire(chave, 60 * 60 * 36);
  }
  return numero;
}

const CLAIM_ID_PEDIDO_TTL_SEGUNDOS = 5;
// 50 dá margem folgada para rajadas reais (uma pizzaria não tem centenas de
// checkouts fechando no mesmo milissegundo) sem deixar o pior caso caro: cada
// tentativa extra é só mais um SET NX, e o caso comum (sem colisão) continua
// gastando exatamente 1.
const MAX_TENTATIVAS_ID_PEDIDO = 50;

// Nunca devolvida com um id não reivindicado: se o Redis estiver indisponível
// ou todas as tentativas de desempate colidirem, é sempre um erro explícito
// — nunca um id "provavelmente" único. Ver AGENTS.md / auditoria do
// incidente de mistura de clientes: preferir falha segura e visível a
// arriscar duas requisições concorrentes acabando com o mesmo pedido.id.
export class IdPedidoIndisponivelError extends Error {
  constructor(motivo: string) {
    super(`Não foi possível gerar um id de pedido com unicidade garantida: ${motivo}`);
    this.name = "IdPedidoIndisponivelError";
  }
}

// Gera o `id` de um pedido — chave usada em TODA busca/atualização de status
// (PATCH, notificação, mutex de edição, etc.), portanto é o único campo cuja
// colisão pode fazer o sistema resolver o pedido ERRADO. `Date.now().toString()`
// sozinho tem resolução de 1ms e não garante unicidade sob criação concorrente
// (dois clientes finalizando pedido no mesmo milissegundo) — a raiz comprovada
// da mistura de nome/telefone entre clientes nas notificações de status.
//
// Reivindicação atômica (SET NX, mesmo padrão já usado para idempotência de
// mensagem do WhatsApp em src/app/api/whatsapp/route.ts): no caso comum (sem
// colisão) o id retornado é EXATAMENTE `Date.now().toString()`, idêntico ao
// comportamento anterior — não muda formato nem tamanho do id em nenhum fluxo
// existente (ordenação em timestampOrdenacaoPedido, txid do Pix em
// gerarTxidPixInterno, etc.). Só no caso raro de colisão real o id ganha um
// dígito extra de desempate, ainda como string puramente numérica.
//
// Propriedade garantida: a função SÓ retorna um candidato depois de reivindicá-lo
// com sucesso (SET NX retornou true). Qualquer incerteza — o SET NX lança (o
// Redis pode ou não ter aplicado a escrita antes de falhar a resposta) ou as
// `MAX_TENTATIVAS_ID_PEDIDO` tentativas colidem todas — vira `IdPedidoIndisponivelError`,
// nunca um id "torcendo para não colidir". Cada chamador decide como falhar
// com segurança a partir daí (nunca criando o pedido sem um id garantido).
export async function gerarIdPedidoUnico(): Promise<string> {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_ID_PEDIDO; tentativa++) {
    const candidato = tentativa === 0 ? Date.now().toString() : `${Date.now()}${tentativa}`;
    let reivindicado: unknown;
    try {
      reivindicado = await redis.set(`pedido_id_claim:${candidato}`, 1, {
        nx: true,
        ex: CLAIM_ID_PEDIDO_TTL_SEGUNDOS,
      });
    } catch (err) {
      throw new IdPedidoIndisponivelError(
        `SET NX falhou (resultado incerto — o Redis pode ou não ter aplicado a reivindicação): ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (reivindicado) return candidato;
  }
  throw new IdPedidoIndisponivelError(
    `${MAX_TENTATIVAS_ID_PEDIDO} tentativas de desempate colidiram consecutivamente`
  );
}
