// "Impulso do Pódio" — bônus limitado, com teto por temporada, concedido
// quando o cliente entra no Top 3 (fato "entrou_top3", já detectado por
// rankingRetencao.detectarFatosDePosicao). Fail-closed sem config; o cap por
// temporada é sempre respeitado mesmo que o cliente entre e saia do Top 3
// várias vezes.
import "server-only";
import { calcularImpulsoPodioDisponivel } from "./rankingGamificacao";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { creditarBonusCompeticaoComTeto } from "./rankingBonusTemporada";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";

export async function aplicarImpulsoPodioSeElegivel(params: {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  eventoId: string;
}): Promise<void> {
  const { tenantId, temporadaId, clienteId, eventoId } = params;
  const config = await obterConfigGamificacao();
  if (!config.impulsoPodioAtivo) return;

  // BLOCKER: o teto por temporada precisa ser aplicado ATOMICAMENTE junto
  // com a leitura do "já aplicado" e a escrita — nunca calculado fora do
  // lock. Dois fatos "entrou_top3" concorrentes (eventoIds diferentes) do
  // MESMO cliente/temporada, cada um lendo o "já aplicado" ANTES de
  // qualquer um creditar, podiam ambos calcular espaço sob o teto e
  // ultrapassá-lo — cada crédito é idempotente por evento, mas a SOMA não
  // respeitava o cap. creditarBonusCompeticaoComTeto faz a leitura, o
  // cálculo e a escrita dentro da MESMA seção crítica por
  // tenant/temporada/cliente.
  const resultado = await creditarBonusCompeticaoComTeto({
    tenantId,
    temporadaId,
    clienteId,
    eventoId,
    tipo: "impulso_podio",
    calcularPontosDisponiveis: (jaAplicado) =>
      calcularImpulsoPodioDisponivel({
        bonusConfigurado: config.impulsoPodioBonus,
        capMaximoTemporada: config.impulsoPodioCapTemporada,
        jaAplicadoNaTemporada: jaAplicado,
      }),
    motivo: "Impulso do Pódio — chegou ao Top 3",
  });
  // "creditado" ou "ja_creditado" (retry) precisam sincronizar da mesma
  // forma — nunca só o primeiro. "invalido" nunca credita de verdade.
  if (resultado === "creditado" || resultado === "ja_creditado") {
    await sincronizarScoreTemporadaComBonus(tenantId, temporadaId, clienteId);
  }
}
