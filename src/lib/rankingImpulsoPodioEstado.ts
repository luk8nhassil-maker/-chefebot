// "Impulso do Pódio" — bônus limitado, com teto por temporada, concedido
// quando o cliente entra no Top 3 (fato "entrou_top3", já detectado por
// rankingRetencao.detectarFatosDePosicao). Fail-closed sem config; o cap por
// temporada é sempre respeitado mesmo que o cliente entre e saia do Top 3
// várias vezes.
import "server-only";
import { calcularImpulsoPodioDisponivel } from "./rankingGamificacao";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { calcularTotalBonusPorTipo, creditarBonusCompeticao, obterMovimentosBonusTemporada } from "./rankingBonusTemporada";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporada";

export async function aplicarImpulsoPodioSeElegivel(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  eventoId: string;
}): Promise<void> {
  const { tenantId, temporadaId, clienteId, eventoId } = params;
  const config = await obterConfigGamificacao();
  if (!config.impulsoPodioAtivo) return;

  const movimentos = await obterMovimentosBonusTemporada(tenantId, temporadaId, clienteId);
  const jaAplicado = calcularTotalBonusPorTipo(movimentos, "impulso_podio");
  const disponivel = calcularImpulsoPodioDisponivel({
    bonusConfigurado: config.impulsoPodioBonus,
    capMaximoTemporada: config.impulsoPodioCapTemporada,
    jaAplicadoNaTemporada: jaAplicado,
  });
  if (disponivel <= 0) return;

  const resultado = await creditarBonusCompeticao({
    tenantId,
    temporadaId,
    clienteId,
    eventoId,
    tipo: "impulso_podio",
    pontos: disponivel,
    motivo: "Impulso do Pódio — chegou ao Top 3",
  });
  if (resultado === "creditado") {
    await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
  }
}
