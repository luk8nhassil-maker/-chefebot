// Único ponto que escreve scoreTemporada = estrelasBaseValidasDaTemporada +
// bonusCompeticaoDaTemporada na projeção de ranking (rankingClientes.ts).
//
// Por que este módulo existe em vez de alterar fidelidade.ts: a regra do
// produto é que NADA da Gamificação V2 pode tocar o saldo/ledger de
// fidelidade. `fidelidade.ts` já sincroniza a projeção do ranking sozinho a
// cada crédito/estorno de pontos (só com a base, sem bônus) — se este módulo
// escrevesse por cima da MESMA API sem coordenação, os dois viram gravadores
// concorrentes da mesma chave e o bônus "pisca" (o próximo pedido do cliente
// apagaria o bônus até a próxima sincronização). Em vez disso, este módulo
// SÓ LÊ o extrato de fidelidade (nunca escreve nele) e é chamado
// explicitamente depois de qualquer mutação no ledger de bônus, incluindo de
// dentro do efeito "gamificacao" do pedido — que roda logo depois do efeito
// "pontos" no mesmo pedido entregue, então mesmo a gravação base-only de
// fidelidade.ts é corrigida na sequência, dentro do mesmo processamento.
import "server-only";
import { obterExtratoPontos } from "./fidelidade";
import { obterTemporada } from "./temporadas";
import { calcularScoreDaTemporada, atualizarScoreRanking } from "./rankingClientes";
import { obterBonusCompeticaoDaTemporada } from "./rankingBonusTemporada";

export async function sincronizarScoreTemporadaComBonus(
  tenantId: string,
  temporadaId: string,
  clienteId: string,
): Promise<void> {
  if (!tenantId || !temporadaId || !clienteId) return;
  try {
    const temporada = await obterTemporada(tenantId, temporadaId);
    if (!temporada?.ativadaEm) return;
    const inicioMs = new Date(temporada.ativadaEm).getTime();
    const fimMs = temporada.fimEm ? new Date(temporada.fimEm).getTime() : Date.now();
    if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs)) return;
    const extrato = await obterExtratoPontos(clienteId);
    const base = calcularScoreDaTemporada(extrato, inicioMs, Math.min(fimMs, Date.now()));
    const bonus = await obterBonusCompeticaoDaTemporada(tenantId, temporadaId, clienteId);
    await atualizarScoreRanking(tenantId, temporadaId, clienteId, base.score + bonus, base.primeiroAtingidoEm ?? Date.now());
  } catch (erro) {
    console.warn("[ChefeBot] Não foi possível sincronizar o score de competição da temporada", erro);
  }
}
