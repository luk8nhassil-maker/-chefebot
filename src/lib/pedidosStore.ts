// Módulo central de mutação atômica da chave Redis "pedidos" — PR de
// concorrência do Modo Sobrevivência.
//
// PROBLEMA: "pedidos" é um único array JSON. Antes deste módulo, todo writer
// fazia seu próprio `GET pedidos` → mutação em memória → `SET pedidos` sem
// nenhuma proteção contra escrita concorrente entre `clientRequestId`s (ou
// canais: site, WhatsApp, painel, cron, webhooks) DIFERENTES — duas escritas
// quase simultâneas liam o mesmo array e a última a gravar apagava
// silenciosamente a mudança da outra (perda de pedido, sobrescrita de
// status, reaparecimento de um pedido já removido, etc.).
//
// SOLUÇÃO (menor mecanismo seguro compatível com o Upstash atual — sem
// PostgreSQL, sem dual-write, sem serviço novo): um LOCK DISTRIBUÍDO CURTO
// (SET NX EX + ownerToken aleatório + compare-and-delete via Lua, MESMO
// padrão já usado em src/lib/mercadoPagoReconciliacao.ts e
// src/lib/pedidoEdicao.ts) serializa a seção crítica de QUALQUER mutação da
// chave "pedidos": GET fresco → validação de identidade → aplica a mutação
// → SET. A seção crítica NUNCA inclui rede externa (Mercado Pago, WhatsApp,
// cardápio, autenticação) — isso é responsabilidade do CHAMADOR, que resolve
// tudo isso ANTES de chamar as funções deste módulo.
//
// GARANTIA: com este módulo, duas mutações concorrentes de PEDIDOS
// DIFERENTES nunca se perdem uma à outra; duas mutações do MESMO pedido são
// serializadas (a segunda vê o resultado da primeira). Não é escala
// infinita — é uma mitigação segura para a arquitetura Redis/Upstash atual
// (ver seção de custo/limitações no PR), não um substituto para um banco
// transacional.
//
// Genérico sobre o formato do pedido de propósito: diferentes canais (site,
// WhatsApp, painel) usam tipos locais ligeiramente diferentes
// (`PedidoRedis`, `PedidoArmazenado`, `Pedido`) — este módulo só exige `id`
// (string, único) e `revision` (opcional, controle de concorrência
// otimista), nunca força um reshape de tipo em quem já usa este array.

import { randomUUID, randomBytes } from "crypto";
import { redis } from "@/lib/redis";

export const PEDIDOS_KEY = "pedidos";

export type PedidoComRevisao = { id: string; revision?: number };

// TTL curto o bastante para nunca prender o array por muito tempo se uma
// execução travar, mas maior que qualquer seção crítica real (GET+validação
// +SET nunca deveria passar de dezenas de ms) — mesmo racional do
// CLAIM_TTL_SEGUNDOS em src/survival/pedidoIdempotencia.ts.
const LOCK_TTL_SEGUNDOS = 5;
const LOCK_KEY = "lock:pedidos:mutex";

// Retries limitados com backoff + jitter — nunca espera indefinidamente.
// 40 tentativas * (20-50ms) ≈ até ~2s de espera total no pior caso, dentro
// da margem do maxDuration=20s das rotas que usam este módulo.
const LOCK_RETRY_MAX = 40;
const LOCK_RETRY_BASE_MS = 20;
const LOCK_RETRY_JITTER_MS = 30;

// Compare-and-delete atômico (Lua) — nunca um DEL cego: uma execução antiga
// (que já teve seu lock expirado por TTL e uma execução nova já adquiriu a
// chave de novo) nunca pode liberar o lock da execução nova. Idêntico ao
// padrão já usado em mercadoPagoReconciliacao.ts/pedidoIdempotencia.ts.
const LIBERAR_LOCK_SE_DONO_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adquirirLockPedidos(): Promise<string | null> {
  const token = randomUUID();
  for (let tentativa = 0; tentativa < LOCK_RETRY_MAX; tentativa++) {
    let obtido: unknown;
    try {
      obtido = await redis.set(LOCK_KEY, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
    } catch {
      return null; // Redis indisponível durante a aquisição — nunca prossegue sem o lock.
    }
    if (obtido) return token;
    await esperar(LOCK_RETRY_BASE_MS + Math.random() * LOCK_RETRY_JITTER_MS);
  }
  return null;
}

async function liberarLockPedidos(token: string): Promise<void> {
  try {
    await redis.eval(LIBERAR_LOCK_SE_DONO_SCRIPT, [LOCK_KEY], [token]);
  } catch {
    // Liberação é best-effort — o TTL curto garante que o lock nunca fica
    // preso indefinidamente mesmo se este EVAL falhar.
  }
}

/** pedidoId globalmente único: timestamp (ms, 13 dígitos por várias décadas
 * — preserva ordenação lexicográfica/cronológica em todo código existente
 * que faz `localeCompare`/comparação de string) + 4 bytes de entropia
 * criptográfica em hex. Nunca colide, mesmo com centenas de criações no
 * MESMO milissegundo (ao contrário do antigo `Date.now().toString()`
 * isolado). Deliberadamente NÃO puramente numérico — o único consumidor que
 * assumia isso (`timestampOrdenacaoPedido` em src/lib/clientePedidos.ts) já
 * tinha fallback defensivo para id não-numérico (usa data+horario), então
 * nenhuma mudança foi necessária lá. `gerarTxidPixInterno`/`X-Idempotency-Key`
 * do Mercado Pago e o vínculo da Jornada do Chef são interpolação de string
 * pura — sem nenhuma suposição numérica. */
export function gerarPedidoIdUnico(): string {
  return `${Date.now()}${randomBytes(4).toString("hex")}`;
}

type ResultadoReconciliacaoEscrita = "confirmado" | "ausente" | "inconsistente" | "incerto";

// Depois de um `redis.set(PEDIDOS_KEY, ...)` lançar, NUNCA assume que a
// escrita falhou (Redis pode ter aplicado a operação e só a resposta ao
// cliente ter sofrido timeout) — reconcilia com uma leitura FRESCA. `SET`
// substitui o valor inteiro atomicamente do lado do Redis (nunca há escrita
// parcial), então esta leitura é uma prova confiável do que realmente
// aconteceu.
async function reconciliarEscritaPedidos<P>(
  verificar: (atuais: P[]) => "confirmado" | "ausente" | "inconsistente"
): Promise<ResultadoReconciliacaoEscrita> {
  let atuais: P[];
  try {
    atuais = (await redis.get<P[]>(PEDIDOS_KEY)) || [];
  } catch {
    return "incerto";
  }
  return verificar(atuais);
}

export type ResultadoAdicionar<P> =
  | { tipo: "sucesso"; pedido: P }
  | { tipo: "id_ja_existe" }
  | { tipo: "lock_indisponivel" }
  | { tipo: "leitura_incerta" }
  | { tipo: "escrita_incerta" };

/** Acrescenta um pedido novo (id já deve vir de `gerarPedidoIdUnico`).
 * Nunca duplica: se o array já contiver um pedido com o mesmo id (defensivo
 * — só aconteceria por reuso indevido de id ou corrida com um mutex que
 * expirou), devolve `id_ja_existe` sem gravar nada. */
export async function adicionarPedidoAtomico<P extends PedidoComRevisao>(novoPedido: P): Promise<ResultadoAdicionar<P>> {
  const token = await adquirirLockPedidos();
  if (!token) return { tipo: "lock_indisponivel" };
  try {
    let atuais: P[];
    try {
      atuais = (await redis.get<P[]>(PEDIDOS_KEY)) || [];
    } catch {
      return { tipo: "leitura_incerta" };
    }
    if (atuais.some((p) => p && p.id === novoPedido.id)) {
      return { tipo: "id_ja_existe" };
    }
    const pedidoGravado: P = { ...novoPedido, revision: novoPedido.revision ?? 1 };
    try {
      await redis.set(PEDIDOS_KEY, [...atuais, pedidoGravado]);
    } catch {
      const reconciliacao = await reconciliarEscritaPedidos<P>((freq) => {
        const encontrados = freq.filter((p) => p && p.id === novoPedido.id);
        if (encontrados.length === 0) return "ausente";
        if (encontrados.length > 1) return "inconsistente";
        return "confirmado";
      });
      if (reconciliacao === "confirmado") return { tipo: "sucesso", pedido: pedidoGravado };
      return { tipo: "escrita_incerta" }; // "ausente"/"inconsistente"/"incerto": nunca finge sucesso.
    }
    return { tipo: "sucesso", pedido: pedidoGravado };
  } finally {
    await liberarLockPedidos(token);
  }
}

export type ResultadoAtualizar<P> =
  | { tipo: "sucesso"; pedido: P }
  | { tipo: "nao_encontrado" }
  | { tipo: "multiplos_encontrados" }
  | { tipo: "conflito_revisao"; revisionAtual: number }
  | { tipo: "lock_indisponivel" }
  | { tipo: "leitura_incerta" }
  | { tipo: "escrita_incerta" };

/** Atualiza UM pedido por id, com controle de concorrência otimista pelo
 * campo `revision` (já existente em `PedidoComEdicao`). `expectedRevision`:
 * `null` para pular a checagem (mutações best-effort de um único campo,
 * onde não há "revisão esperada" do lado do chamador — ainda assim
 * protegidas contra perda de outras mutações pelo MESMO lock global); um
 * número para exigir igualdade exata (edição do cliente vs. aceite do
 * painel, por exemplo) — divergência retorna `conflito_revisao`, NUNCA
 * sobrescreve silenciosamente uma mudança mais nova. Pedidos legados sem
 * `revision` são tratados como revisão `1` (fallback documentado) e passam
 * a ter uma revisão válida assim que sofrem a primeira mutação por aqui. */
export async function atualizarPedidoAtomico<P extends PedidoComRevisao>(
  pedidoId: string,
  expectedRevision: number | null,
  mutator: (pedido: P) => P
): Promise<ResultadoAtualizar<P>> {
  const token = await adquirirLockPedidos();
  if (!token) return { tipo: "lock_indisponivel" };
  try {
    let atuais: P[];
    try {
      atuais = (await redis.get<P[]>(PEDIDOS_KEY)) || [];
    } catch {
      return { tipo: "leitura_incerta" };
    }
    const candidatos = atuais.filter((p) => p && p.id === pedidoId);
    if (candidatos.length === 0) return { tipo: "nao_encontrado" };
    if (candidatos.length > 1) return { tipo: "multiplos_encontrados" };
    const atual = candidatos[0];
    const revisionAtual = typeof atual.revision === "number" && Number.isFinite(atual.revision) ? atual.revision : 1;
    if (expectedRevision !== null && revisionAtual !== expectedRevision) {
      return { tipo: "conflito_revisao", revisionAtual };
    }
    const atualizado: P = { ...mutator(atual), id: pedidoId, revision: revisionAtual + 1 };
    const novosPedidos = atuais.map((p) => (p && p.id === pedidoId ? atualizado : p));
    try {
      await redis.set(PEDIDOS_KEY, novosPedidos);
    } catch {
      const reconciliacao = await reconciliarEscritaPedidos<P>((freq) => {
        const encontrados = freq.filter((p) => p && p.id === pedidoId);
        if (encontrados.length > 1) return "inconsistente";
        if (encontrados.length === 0) return "inconsistente"; // pedido nunca deveria sumir numa atualização
        return encontrados[0].revision === atualizado.revision ? "confirmado" : "ausente";
      });
      if (reconciliacao === "confirmado") return { tipo: "sucesso", pedido: atualizado };
      return { tipo: "escrita_incerta" };
    }
    return { tipo: "sucesso", pedido: atualizado };
  } finally {
    await liberarLockPedidos(token);
  }
}

/** Mesma operação de `atualizarPedidoAtomico`, sem checagem de revisão —
 * atalho para mutações best-effort de um único campo (ex.: marcar
 * escalonado, limpar um lock expirado) que ainda precisam da proteção do
 * lock global (nunca perdem uma mutação concorrente de OUTRO pedido), mas
 * não têm um valor de "revisão esperada" do lado do chamador. */
export async function mutarPedidoPorIdAtomico<P extends PedidoComRevisao>(
  pedidoId: string,
  mutator: (pedido: P) => P
): Promise<ResultadoAtualizar<P>> {
  return atualizarPedidoAtomico<P>(pedidoId, null, mutator);
}

export type ResultadoRemover =
  | { tipo: "sucesso" }
  | { tipo: "nao_encontrado" }
  | { tipo: "multiplos_encontrados" }
  | { tipo: "lock_indisponivel" }
  | { tipo: "leitura_incerta" }
  | { tipo: "escrita_incerta" };

/** Remove UM pedido por id (rollback de resgate, exclusão manual no painel,
 * limpeza). Nunca reescreve um snapshot antigo por cima de pedidos novos —
 * sempre parte de uma leitura FRESCA dentro do lock, nunca de um array
 * capturado antes da seção crítica. */
export async function removerPedidoAtomico<P extends PedidoComRevisao>(pedidoId: string): Promise<ResultadoRemover> {
  const token = await adquirirLockPedidos();
  if (!token) return { tipo: "lock_indisponivel" };
  try {
    let atuais: P[];
    try {
      atuais = (await redis.get<P[]>(PEDIDOS_KEY)) || [];
    } catch {
      return { tipo: "leitura_incerta" };
    }
    const candidatos = atuais.filter((p) => p && p.id === pedidoId);
    if (candidatos.length === 0) return { tipo: "nao_encontrado" };
    if (candidatos.length > 1) return { tipo: "multiplos_encontrados" };
    const novosPedidos = atuais.filter((p) => !(p && p.id === pedidoId));
    try {
      await redis.set(PEDIDOS_KEY, novosPedidos);
    } catch {
      const reconciliacao = await reconciliarEscritaPedidos<P>((freq) => {
        const encontrados = freq.filter((p) => p && p.id === pedidoId);
        if (encontrados.length > 1) return "inconsistente";
        return encontrados.length === 0 ? "confirmado" : "ausente";
      });
      if (reconciliacao === "confirmado") return { tipo: "sucesso" };
      return { tipo: "escrita_incerta" };
    }
    return { tipo: "sucesso" };
  } finally {
    await liberarLockPedidos(token);
  }
}

export type ResultadoLote<P> =
  | { tipo: "sucesso"; pedidos: P[] }
  | { tipo: "lock_indisponivel" }
  | { tipo: "leitura_incerta" }
  | { tipo: "escrita_incerta" };

/** Aplica uma mutação arbitrária ao array inteiro sob o MESMO lock global —
 * escape hatch para operações em lote (limpeza de pedidos antigos,
 * arquivamento em massa) que não se encaixam em add/update/remove de um
 * único pedido. `mutator` recebe o array fresco e devolve o array final —
 * nunca deve fazer I/O de rede dentro de si (a seção crítica precisa
 * permanecer curta). Reconciliação pós-falha é comprovadamente mais fraca
 * aqui (só confirma que o tamanho final do array bate) — use as operações
 * específicas acima sempre que possível; reservado para os poucos
 * consumidores que genuinamente precisam de uma transformação em lote. */
export async function mutarLotePedidosAtomico<P extends PedidoComRevisao>(mutator: (atuais: P[]) => P[]): Promise<ResultadoLote<P>> {
  const token = await adquirirLockPedidos();
  if (!token) return { tipo: "lock_indisponivel" };
  try {
    let atuais: P[];
    try {
      atuais = (await redis.get<P[]>(PEDIDOS_KEY)) || [];
    } catch {
      return { tipo: "leitura_incerta" };
    }
    const novosPedidos = mutator(atuais);
    try {
      await redis.set(PEDIDOS_KEY, novosPedidos);
    } catch {
      const reconciliacao = await reconciliarEscritaPedidos<P>((freq) => (freq.length === novosPedidos.length ? "confirmado" : "ausente"));
      if (reconciliacao === "confirmado") return { tipo: "sucesso", pedidos: novosPedidos };
      return { tipo: "escrita_incerta" };
    }
    return { tipo: "sucesso", pedidos: novosPedidos };
  } finally {
    await liberarLockPedidos(token);
  }
}

/** Leitura pura, sem lock — nunca precisa de proteção de concorrência para
 * simplesmente ler o estado atual. */
export async function listarPedidos<P>(): Promise<P[]> {
  return (await redis.get<P[]>(PEDIDOS_KEY)) || [];
}

/** Leitura de um único pedido por id — sem lock (só leitura). */
export async function buscarPedido<P extends PedidoComRevisao>(pedidoId: string): Promise<P | null> {
  const pedidos = await listarPedidos<P>();
  return pedidos.find((p) => p && p.id === pedidoId) ?? null;
}
