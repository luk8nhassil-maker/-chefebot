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

// Estado "há uma conversão principal ATIVA (não estornada) para este
// indicado" — separado da RELAÇÃO permanente indicador→indicado
// (indicacaoToken.ts), que nunca é apagada. Correção de blocker: sem isso,
// depois que a primeira compra do indicado fosse cancelada/estornada, a
// relação permanente continuava existindo e todo pedido seguinte caía direto
// em "apoio recorrente" — a conversão principal (+6 ao indicador) nunca
// podia acontecer de novo com uma compra comercial realmente válida.
function chaveConversaoAtivaIndicado(indicadoId: string): string {
  return `estrelasIndicacao:conversaoAtiva:${indicadoId}`;
}

export type ConversaoAtivaIndicado = { indicadorId: string; pedidoId: string };

export async function marcarConversaoAtivaIndicado(indicadoId: string, params: ConversaoAtivaIndicado): Promise<void> {
  if (!indicadoId) return;
  await redis.set(chaveConversaoAtivaIndicado(indicadoId), params);
}

export async function obterConversaoAtivaIndicado(indicadoId: string): Promise<ConversaoAtivaIndicado | null> {
  if (!indicadoId) return null;
  return redis.get<ConversaoAtivaIndicado>(chaveConversaoAtivaIndicado(indicadoId));
}

function chaveLockConversaoAtiva(indicadoId: string): string {
  return `estrelasIndicacao:conversaoAtiva:lock:${indicadoId}`;
}

/**
 * Reserva atômica da decisão "esta compra é a conversão principal deste
 * indicado, ou é apoio recorrente" — todo o ciclo leitura-decisão-escrita
 * (obterConversaoAtivaIndicado → creditar → marcarConversaoAtivaIndicado, em
 * fidelidadeEfeitos.ts) precisa rodar dentro do MESMO `fn` passado aqui,
 * nunca como um GET seguido de um SET separados. Sem isso, dois pedidos
 * concorrentes do mesmo indicado (ex.: logo após a conversão original ter
 * sido cancelada, os dois observando "sem conversão ativa" ao mesmo tempo)
 * podiam creditar a conversão principal (+6) duas vezes — blocker de
 * concorrência apontado na auditoria final. `revogarConversaoAtivaIndicadoSePedido`
 * usa a MESMA reserva, o que torna seu compare-and-delete atômico em relação
 * a uma nova conversão sendo gravada ao mesmo tempo (nunca um cancelamento
 * tardio e fora de ordem apaga uma conversão mais nova).
 */
export async function comReservaConversaoAtiva<T>(indicadoId: string, fn: () => Promise<T>): Promise<T> {
  return comBloqueioGamificacao(chaveLockConversaoAtiva(indicadoId), fn);
}

/**
 * Revoga a marca de conversão ativa SOMENTE se ela pertence ao `pedidoId`
 * dado — nunca apaga a marca de uma conversão MAIS NOVA por engano quando um
 * cancelamento tardio de um pedido antigo é reprocessado fora de ordem. A
 * checagem+remoção roda sob a MESMA reserva atômica usada para criar/marcar
 * uma conversão ativa (comReservaConversaoAtiva), fechando a corrida em que
 * uma nova conversão é gravada exatamente entre o GET e o DEL.
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
