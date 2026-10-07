import "server-only";

import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { obterTemporadaAtiva } from "./temporadas";
import { obterParticipacaoRanking } from "./consentimentoRanking";
import { creditarBonusCompeticao } from "./rankingBonusTemporada";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";
import { registrarBonusFotoRankingCliente, type Cliente } from "./clientes";
import { derivarClienteIdPorTelefone } from "./fidelidade";

export type ResultadoMissaoFotoRanking =
  | { status: "inativa" | "inelegivel" | "ja_concluida"; pontos: 0; temporadaId: string | null }
  | { status: "creditado" | "ja_creditado"; pontos: number; temporadaId: string };

export async function concederBonusMissaoFotoRanking(params: {
  tenantId: string;
  cliente: Cliente;
}): Promise<ResultadoMissaoFotoRanking> {
  const { tenantId, cliente } = params;
  const clienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  if (cliente.rankingFotoBonusConcedidoEm) {
    return { status: "ja_concluida", pontos: 0, temporadaId: cliente.rankingFotoBonusTemporadaId ?? null };
  }

  const config = await obterConfigGamificacao();
  if (!config.missaoFotoPerfilAtiva || config.missaoFotoPerfilBonus <= 0) {
    return { status: "inativa", pontos: 0, temporadaId: null };
  }

  const [temporada, participa] = await Promise.all([
    obterTemporadaAtiva(tenantId),
    obterParticipacaoRanking(clienteId),
  ]);
  if (!temporada || !participa) {
    return { status: "inelegivel", pontos: 0, temporadaId: temporada?.temporadaId ?? null };
  }

  const eventoId = `missao_foto_perfil:${clienteId}`;
  const resultado = await creditarBonusCompeticao({
    tenantId,
    temporadaId: temporada.temporadaId,
    clienteId: clienteId,
    eventoId,
    tipo: "missao_foto_perfil",
    pontos: config.missaoFotoPerfilBonus,
    motivo: "Missão de foto do perfil",
  });

  if (resultado !== "creditado" && resultado !== "ja_creditado") {
    return { status: "inelegivel", pontos: 0, temporadaId: temporada.temporadaId };
  }

  await sincronizarScoreTemporadaComBonus(tenantId, temporada.temporadaId, clienteId);
  await registrarBonusFotoRankingCliente(cliente.telefone, temporada.temporadaId);

  return {
    status: resultado,
    pontos: config.missaoFotoPerfilBonus,
    temporadaId: temporada.temporadaId,
  };
}
