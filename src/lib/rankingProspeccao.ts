export const RANKING_CONVITE_ADIADO_SESSION_KEY = "cf_ranking_convite_adiado_sessao_v1";

export type RankingProspeccaoStatusPagamento =
  | "nao_pix"
  | "aguardando_pix"
  | "pago"
  | "em_revisao"
  | "conferencia_manual";

type DecisaoConviteRanking = {
  pedidoConcluido: boolean;
  participaCampanha: boolean | null;
  adiouNestaSessao: boolean;
  pagamentoStatus: RankingProspeccaoStatusPagamento;
};

/** Decide apenas se o convite pode aparecer. Nao concede consentimento, nao pontua e nao altera pedido/pagamento. */
export function deveMostrarConviteRankingPosPedido({ pedidoConcluido, participaCampanha, adiouNestaSessao, pagamentoStatus }: DecisaoConviteRanking): boolean {
  if (!pedidoConcluido || participaCampanha === true || adiouNestaSessao) return false;
  return pagamentoStatus === "nao_pix" || pagamentoStatus === "pago";
}
