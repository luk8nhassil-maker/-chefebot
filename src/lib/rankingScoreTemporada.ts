// Autoridade ÚNICA que escreve scoreTemporada = estrelasBaseValidasDaTemporada
// + bonusCompeticaoDaTemporada na projeção de ranking (rankingClientes.ts).
//
// Correção de blocker da auditoria do #446: antes existiam DOIS gravadores
// independentes da mesma chave — a sincronização interna de fidelidade.ts
// (só base) e este módulo (base + bônus). Qualquer evento que passasse pelo
// gravador base-only DEPOIS do gravador com bônus apagava o bônus da
// projeção (ex.: crédito de indicação processado depois do efeito de
// gamificação no mesmo pedido). A correção é ter uma ÚNICA função de escrita:
// mesmo fidelidade.ts (que nunca deve conter regra de negócio de
// gamificação) passa a chamar ESTA função — só que com o score base já
// calculado por ele mesmo, nunca recalculado aqui. Este arquivo nunca
// importa nada de fidelidade.ts (evita import circular); quem precisa
// recalcular a base a partir do extrato usa o wrapper em
// rankingScoreTemporadaSync.ts, que importa este projetor.
import "server-only";
import { atualizarScoreRanking } from "./rankingClientes";
import { obterBonusCompeticaoDaTemporada } from "./rankingBonusTemporada";

/**
 * Único ponto autorizado a escrever na projeção de ranking da temporada.
 * Recebe o score BASE já calculado pelo chamador — nunca recalcula sozinho
 * — e soma o bônus de competição atual antes de escrever. Nenhum outro
 * lugar do código deve chamar `atualizarScoreRanking` diretamente.
 */
export async function projetarScoreRankingComBonus(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
  scoreBase: number,
  primeiroAtingidoEm: number,
): Promise<void> {
  if (!tenantId || !temporadaId || !clienteId) return;
  try {
    const bonus = await obterBonusCompeticaoDaTemporada(tenantId, temporadaId, clienteId);
    const base = Number.isFinite(scoreBase) && scoreBase >= 0 ? scoreBase : 0;
    await atualizarScoreRanking(tenantId, temporadaId, clienteId, base + bonus, primeiroAtingidoEm);
  } catch (erro) {
    console.warn("[ChefeBot] Não foi possível projetar o score de competição da temporada", erro);
  }
}
