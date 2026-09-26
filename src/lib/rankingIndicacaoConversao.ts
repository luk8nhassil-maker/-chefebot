// Migalha da conversão de indicação (primeira compra válida) por pedido —
// permite que o cancelamento tardio (correção do pedido do indicado para
// "cancelado" depois de já ter creditado a indicação) encontre indicador e
// indicado sem precisar reconsultar `indicacaoToken.ts` (a relação
// permanente já foi confirmada nesse momento e não muda depois).
import "server-only";
import { redis } from "./redis";
import { comBloqueioGamificacao } from "./rankingGamificacaoLock";

function chaveBreadcrumb(pedidoId: string): string {
  return `estrelasIndicacao:conversao:pedido:${pedidoId}`;
}

export type BreadcrumbConversaoIndicacao = {
  indicadorId: string;
  indicadoId: string;
  pedidoId: string;
};

export async function registrarConversaoIndicacao(params: BreadcrumbConversaoIndicacao): Promise<void> {
  await redis.set(chaveBreadcrumb(params.pedidoId), params);
}

export async function obterConversaoIndicacaoDoPedido(pedidoId: string): Promise<BreadcrumbConversaoIndicacao | null> {
  if (!pedidoId) return null;
  return redis.get<BreadcrumbConversaoIndicacao>(chaveBreadcrumb(pedidoId));
}

// Estado DURÁVEL da conversão principal de um indicado — separado da
// RELAÇÃO permanente indicador→indicado (indicacaoToken.ts), que nunca é
// apagada. Correção de blocker: sem isso, depois que a primeira compra do
// indicado fosse cancelada/estornada, a relação permanente continuava
// existindo e todo pedido seguinte caía direto em "apoio recorrente" — a
// conversão principal (+6 ao indicador) nunca podia acontecer de novo com
// uma compra comercial realmente válida.
//
// Este registro tem DOIS estados possíveis, nunca só "existe/não existe":
//   "processando" — um pedido RESERVOU o direito de ser a conversão
//                    principal, ANTES de creditar o +6. Escrito sob o lock
//                    (comReservaConversaoAtiva), sem TTL — sobrevive a um
//                    crash do processo entre o crédito e a confirmação. Só o
//                    PRÓPRIO pedidoId da reserva pode avançá-la para "ativa";
//                    nenhum outro pedido pode nem creditar, nem cair em
//                    apoio recorrente, enquanto ela existir — a segurança
//                    contra duas conversões principais simultâneas vem
//                    DESTE estado persistente, não do lock (que é só a
//                    seção crítica curta da transição, com TTL de 10s e
//                    portanto insuficiente sozinho contra um crash).
//   "ativa"       — a conversão principal já foi confirmada (crédito real
//                    concluído). Só então um pedido seguinte do mesmo
//                    indicado passa a virar apoio recorrente.
function chaveConversaoAtivaIndicado(indicadoId: string): string {
  return `estrelasIndicacao:conversaoAtiva:${indicadoId}`;
}

export type EstadoConversaoIndicado = "processando" | "ativa";
export type ConversaoAtivaIndicado = { estado: EstadoConversaoIndicado; indicadorId: string; pedidoId: string };

export async function obterConversaoAtivaIndicado(indicadoId: string): Promise<ConversaoAtivaIndicado | null> {
  if (!indicadoId) return null;
  return redis.get<ConversaoAtivaIndicado>(chaveConversaoAtivaIndicado(indicadoId));
}

function chaveLockConversaoAtiva(indicadoId: string): string {
  return `estrelasIndicacao:conversaoAtiva:lock:${indicadoId}`;
}

/**
 * Reserva atômica de uma SEÇÃO CRÍTICA CURTA por indicadoId — usada só para
 * tornar cada TRANSIÇÃO de estado (reservar, confirmar, revogar) atômica em
 * relação a qualquer outra transição concorrente do mesmo indicado. Nunca
 * precisa envolver o crédito no ledger inteiro (que pode ser lento e não
 * deve ficar refém do TTL de 10s deste lock) — a segurança contra crash vem
 * do ESTADO DURÁVEL gravado dentro da seção crítica, não do lock em si.
 */
export async function comReservaConversaoAtiva<T>(indicadoId: string, fn: () => Promise<T>): Promise<T> {
  return comBloqueioGamificacao(chaveLockConversaoAtiva(indicadoId), fn);
}

export type ResultadoReservaConversao =
  // Ninguém tinha reserva para este indicado — este pedido acabou de
  // reservar o direito de ser a conversão principal. Pode prosseguir com o
  // crédito e, ao final, confirmar via marcarConversaoAtivaIndicado.
  | "reservada_processando"
  // A reserva (em qualquer estado, processando OU ativa) já pertence a ESTE
  // MESMO pedidoId — é um retry seguro; o chamador deve prosseguir/repetir o
  // crédito (idempotente no ledger) e garantir os efeitos auxiliares.
  | "mesmo_pedido"
  // OUTRO pedido está no meio da própria conversão (processando, ainda não
  // confirmada). Este pedido NUNCA pode creditar a conversão principal, e
  // NUNCA pode virar apoio recorrente nesta disputa — apoio só é válido
  // contra uma conversão já ATIVA e sustentada. O chamador deve tratar como
  // retryable (lançar para o pipeline de efeitos criar uma pendência).
  | "ocupada_processando_outro"
  // Outro pedido já é a conversão principal ATIVA e sustentada — este
  // pedido segue o fluxo normal de apoio recorrente.
  | "ativa_outro_pedido";

/**
 * Reserva (ou identifica) atomicamente a conversão principal de um indicado
 * para um pedido específico — sempre a PRIMEIRA coisa a acontecer, antes de
 * qualquer crédito no ledger. Nunca resolve com um GET seguido de um SET
 * separados: toda a leitura+decisão+escrita roda dentro da mesma reserva
 * (comReservaConversaoAtiva).
 */
export async function reservarOuIdentificarConversao(
  indicadoId: string,
  params: { indicadorId: string; pedidoId: string },
): Promise<ResultadoReservaConversao> {
  return comReservaConversaoAtiva(indicadoId, async () => {
    const atual = await obterConversaoAtivaIndicado(indicadoId);
    if (!atual) {
      await redis.set(chaveConversaoAtivaIndicado(indicadoId), {
        estado: "processando",
        indicadorId: params.indicadorId,
        pedidoId: params.pedidoId,
      } satisfies ConversaoAtivaIndicado);
      return "reservada_processando";
    }
    if (atual.pedidoId === params.pedidoId) return "mesmo_pedido";
    return atual.estado === "processando" ? "ocupada_processando_outro" : "ativa_outro_pedido";
  });
}

/**
 * Confirma a conversão principal como ATIVA — só tem efeito se a reserva
 * atual (em qualquer estado) ainda pertencer a este MESMO pedidoId (nunca
 * confirma por cima de uma reserva que outro pedido já tenha tomado, e é
 * idempotente: confirmar de novo o mesmo pedido é um no-op seguro). Roda sob
 * a mesma reserva atômica.
 */
export async function marcarConversaoAtivaIndicado(indicadoId: string, params: { indicadorId: string; pedidoId: string }): Promise<void> {
  if (!indicadoId) return;
  await comReservaConversaoAtiva(indicadoId, async () => {
    const atual = await obterConversaoAtivaIndicado(indicadoId);
    if (atual && atual.pedidoId !== params.pedidoId) return;
    await redis.set(chaveConversaoAtivaIndicado(indicadoId), {
      estado: "ativa",
      indicadorId: params.indicadorId,
      pedidoId: params.pedidoId,
    } satisfies ConversaoAtivaIndicado);
  });
}

/**
 * Revoga a marca de conversão (em qualquer estado — processando OU ativa)
 * SOMENTE se ela pertence ao `pedidoId` dado — nunca apaga a marca de uma
 * conversão MAIS NOVA por engano quando um cancelamento tardio de um pedido
 * antigo é reprocessado fora de ordem, e nunca apaga uma reserva
 * "processando" de OUTRO pedido em andamento. A checagem+remoção roda sob a
 * MESMA reserva atômica usada para criar/marcar uma conversão, fechando a
 * corrida em que uma nova conversão é gravada exatamente entre o GET e o
 * DEL.
 */
export async function revogarConversaoAtivaIndicadoSePedido(indicadoId: string, pedidoId: string): Promise<void> {
  if (!indicadoId || !pedidoId) return;
  await comReservaConversaoAtiva(indicadoId, async () => {
    const atual = await obterConversaoAtivaIndicado(indicadoId);
    if (atual?.pedidoId === pedidoId) {
      await redis.del(chaveConversaoAtivaIndicado(indicadoId));
    }
  });
}
