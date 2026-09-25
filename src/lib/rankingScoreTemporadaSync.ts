// Wrapper de conveniência para chamadores da Gamificação V2 que só têm
// (tenant, temporada, cliente) à mão — ex.: depois de creditar/estornar um
// bônus, sem ter o score base já calculado. Recalcula a base a partir do
// extrato de fidelidade (só leitura) e delega a escrita para o único
// projetor autorizado (rankingScoreTemporada.ts).
//
// Fica num arquivo separado do projetor para que fidelidade.ts possa
// importar o projetor sem nunca formar um import circular: fidelidade.ts →
// rankingScoreTemporada.ts (sem voltar para fidelidade.ts); este arquivo é
// que faz o caminho fidelidade.ts → rankingClientes.ts/temporadas.ts, e só é
// importado pelos módulos de gamificação, nunca por fidelidade.ts.
import "server-only";
import { obterExtratoPontos } from "./fidelidade";
import { obterTemporada } from "./temporadas";
import { calcularScoreDaTemporada } from "./rankingClientes";
import { projetarScoreRankingComBonus } from "./rankingScoreTemporada";

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
    await projetarScoreRankingComBonus(tenantId, temporadaId, clienteId, base.score, base.primeiroAtingidoEm ?? Date.now());
  } catch (erro) {
    console.warn("[ChefeBot] Não foi possível sincronizar o score de competição da temporada", erro);
  }
}
