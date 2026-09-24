import { redis } from "./redis";
import {
  obterExtratoPontos,
  type MovimentoFidelidade,
  type MovimentoPontos,
} from "./fidelidade";
import type { EvidenciaCompraHistorica } from "./pesquisaPreferenciaHistorico";

function timestampValido(valor: unknown): number | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Adapter SOMENTE LEITURA para evidências históricas de compra já existentes.
 *
 * Fontes:
 * - fidelidade:extrato:{clienteId} (modelo legado por pizzas);
 * - obterExtratoPontos(clienteId), que já une estado atual + extrato legado
 *   do modelo por pontos.
 *
 * Ausência de movimento não significa ausência de compra histórica.
 */
export async function carregarEvidenciasHistoricasFidelidade(
  clienteId: string
): Promise<EvidenciaCompraHistorica[]> {
  const [extratoLegado, extratoPontos] = await Promise.all([
    redis.get<MovimentoFidelidade[]>(`fidelidade:extrato:${clienteId}`),
    obterExtratoPontos(clienteId),
  ]);

  const evidencias: EvidenciaCompraHistorica[] = [];

  for (const movimento of Array.isArray(extratoLegado) ? extratoLegado : []) {
    if (movimento.tipo !== "credito" || !movimento.pedidoId) continue;
    const criadoEmMs = timestampValido(movimento.createdAt);
    if (criadoEmMs === null) continue;
    evidencias.push({
      pedidoId: movimento.pedidoId,
      criadoEmMs,
      fonte: "fidelidade_legado",
    });
  }

  for (const movimento of Array.isArray(extratoPontos)
    ? (extratoPontos as MovimentoPontos[])
    : []) {
    if (movimento.tipo !== "confirmado" || !movimento.pedidoId) continue;
    const criadoEmMs = timestampValido(movimento.createdAt);
    if (criadoEmMs === null) continue;
    evidencias.push({
      pedidoId: movimento.pedidoId,
      criadoEmMs,
      fonte: "fidelidade_pontos",
    });
  }

  return evidencias;
}
