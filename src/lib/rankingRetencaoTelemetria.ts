// Telemetria de produto da experiência de retenção do Ranking do Chefe
// (quem JÁ participa). Domínio novo e aditivo — não reaproveita
// `telemetria()`/`/api/cliente/telemetria`, que é explicitamente temporária
// (diagnóstico da migração Perfil 3.0, ver esse arquivo).
//
// Sem PII por construção: eventos são contadores agregados e anônimos —
// nenhuma chave aceita clienteId, telefone ou nome. Mesmo padrão de
// jornadaChef.ts (registrarEventoAnalytics): lista JSON em Redis, best-effort
// (nunca derruba o fluxo principal), capada em LIMITE_EVENTOS.

import "server-only";
import { redis } from "./redis";

export const TIPOS_EVENTO_RANKING_RETENCAO = [
  // Abertura da tela do ranking pelo participante.
  "ranking_aberto",
  "ranking_retorno",
  "disputa_visualizada",
  // Ações de avanço.
  "cta_subir_clicado",
  "indicacao_clicada",
  "link_indicacao_gerado",
  "compartilhamento_clicado",
  // Resultado real observado pelo cliente (nunca client-side fabricado).
  "indicacao_convertida",
  "subiu_posicao",
  "entrou_top10",
  "entrou_top3",
  // Sinal de privacidade — nunca guarda o que foi revogado, só a ação.
  "participacao_revogada",
] as const;

export type EventoRankingRetencao = (typeof TIPOS_EVENTO_RANKING_RETENCAO)[number];

const FAIXAS_POSICAO = ["top1", "top3", "top10", "outro"] as const;
type FaixaPosicao = (typeof FAIXAS_POSICAO)[number];

export type DetalheEventoRankingRetencao = {
  posicaoFaixa?: FaixaPosicao;
  casas?: number;
};

type EventoRegistrado = {
  tipo: EventoRankingRetencao;
  criadoEm: string;
  posicaoFaixa?: FaixaPosicao;
  casas?: number;
};

const LIMITE_EVENTOS = 5000;

function chaveEventos(tenantId: string): string {
  return `ranking:retencao:eventos:${tenantId}`;
}

/** Allowlist estrita — qualquer campo fora daqui é descartado, nunca persistido. */
export function sanitizarDetalheEventoRankingRetencao(
  detalhe: unknown,
): DetalheEventoRankingRetencao {
  if (!detalhe || typeof detalhe !== "object") return {};
  const bruto = detalhe as Record<string, unknown>;
  const resultado: DetalheEventoRankingRetencao = {};
  if (typeof bruto.posicaoFaixa === "string" && (FAIXAS_POSICAO as readonly string[]).includes(bruto.posicaoFaixa)) {
    resultado.posicaoFaixa = bruto.posicaoFaixa as FaixaPosicao;
  }
  if (typeof bruto.casas === "number" && Number.isFinite(bruto.casas)) {
    resultado.casas = Math.max(0, Math.min(999, Math.round(bruto.casas)));
  }
  return resultado;
}

export function eventoRankingRetencaoValido(tipo: unknown): tipo is EventoRankingRetencao {
  return typeof tipo === "string" && (TIPOS_EVENTO_RANKING_RETENCAO as readonly string[]).includes(tipo);
}

/**
 * Best-effort e anônimo — nunca lança, nunca recebe identificador de cliente.
 * Uma falha de Redis aqui não pode derrubar a tela do ranking.
 */
export async function registrarEventoRankingRetencao(
  tenantId: string,
  tipo: EventoRankingRetencao,
  detalhe?: unknown,
): Promise<void> {
  if (!tenantId || !eventoRankingRetencaoValido(tipo)) return;
  try {
    const chave = chaveEventos(tenantId);
    const eventos = (await redis.get<EventoRegistrado[]>(chave)) ?? [];
    const sanitizado = sanitizarDetalheEventoRankingRetencao(detalhe);
    const evento: EventoRegistrado = { tipo, criadoEm: new Date().toISOString(), ...sanitizado };
    const atualizados = [...eventos, evento].slice(-LIMITE_EVENTOS);
    await redis.set(chave, atualizados);
  } catch {
    // Telemetria nunca pode quebrar a experiência do participante.
  }
}
