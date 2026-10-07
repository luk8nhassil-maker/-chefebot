import "server-only";

import { createHmac, randomBytes } from "crypto";
import { redis } from "./redis";
import { chaveExpedienteOperacional } from "./expedienteOperacional";
import {
  classificarOrigemMovimentoPontos,
  obterExtratoPontos,
} from "./fidelidade";
import { obterOuCriarTokenIndicacao } from "./indicacaoToken";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { obterTemporada, obterTemporadaAtiva } from "./temporadas";
import { obterParticipacaoRanking } from "./consentimentoRanking";
import {
  creditarBonusCompeticao,
  obterMovimentosBonusTemporada,
} from "./rankingBonusTemporada";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";

const TTL_TOKEN_SEGUNDOS = 72 * 60 * 60;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{24}$/;

type TokenDivulgacao = {
  tenantId: string;
  temporadaId: string;
  clienteId: string;
  expedienteId: string;
  refToken: string;
  criadoEm: string;
};

export type EstadoMissaoDivulgacao = {
  ativa: boolean;
  elegivel: boolean;
  concluidaHoje: boolean;
  bonus: number;
  expedienteId: string;
  motivoBloqueio: "desligada" | "sem_temporada" | "fora_ranking" | "sem_pedido_confirmado" | "infraestrutura_indisponivel" | null;
};

function chaveToken(token: string): string {
  return `marketing:divulgacao:token:${token}`;
}

function referenciaPrivadaCliente(clienteId: string): string | null {
  const segredo = process.env.PRIVACY_CONSENT_HMAC_SECRET?.trim() ?? "";
  if (!clienteId || segredo.length < 32) return null;
  return createHmac("sha256", segredo).update(clienteId).digest("hex");
}

function chaveTokenDoDia(payload: Pick<TokenDivulgacao, "tenantId" | "temporadaId" | "clienteId" | "expedienteId">): string | null {
  const referencia = referenciaPrivadaCliente(payload.clienteId);
  if (!referencia) return null;
  return `marketing:divulgacao:dia:${payload.tenantId}:${payload.temporadaId}:${referencia}:${payload.expedienteId}`;
}

function eventoId(expedienteId: string): string {
  return `missao_divulgacao_diaria:${expedienteId}`;
}

async function temPedidoConfirmadoValido(clienteId: string): Promise<boolean> {
  try {
    const extrato = await obterExtratoPontos(clienteId);
    const confirmados = new Set(
      extrato
        .filter((movimento) =>
          movimento.tipo === "confirmado" &&
          !!movimento.pedidoId &&
          movimento.eventoId?.startsWith("confirmado:") &&
          classificarOrigemMovimentoPontos(movimento.eventoId) === "pedido"
        )
        .map((movimento) => movimento.pedidoId as string),
    );
    const invalidados = new Set(
      extrato
        .filter((movimento) =>
          (movimento.tipo === "cancelado" || movimento.tipo === "estornado") &&
          !!movimento.pedidoId
        )
        .map((movimento) => movimento.pedidoId as string),
    );
    return [...confirmados].some((pedidoId) => !invalidados.has(pedidoId));
  } catch {
    return false;
  }
}

export async function obterEstadoMissaoDivulgacao(params: {
  tenantId: string;
  clienteId: string;
  agora?: number;
}): Promise<EstadoMissaoDivulgacao> {
  const agora = params.agora ?? Date.now();
  const expedienteId = chaveExpedienteOperacional(agora);
  const config = await obterConfigGamificacao();
  if (!config.missaoDivulgacaoAtiva || config.missaoDivulgacaoBonus <= 0) {
    return { ativa: false, elegivel: false, concluidaHoje: false, bonus: 0, expedienteId, motivoBloqueio: "desligada" };
  }

  const temporada = await obterTemporadaAtiva(params.tenantId);
  if (!temporada) {
    return { ativa: true, elegivel: false, concluidaHoje: false, bonus: config.missaoDivulgacaoBonus, expedienteId, motivoBloqueio: "sem_temporada" };
  }

  const participa = await obterParticipacaoRanking(params.clienteId).catch(() => false);
  if (!participa) {
    return { ativa: true, elegivel: false, concluidaHoje: false, bonus: config.missaoDivulgacaoBonus, expedienteId, motivoBloqueio: "fora_ranking" };
  }

  if (!(await temPedidoConfirmadoValido(params.clienteId))) {
    return { ativa: true, elegivel: false, concluidaHoje: false, bonus: config.missaoDivulgacaoBonus, expedienteId, motivoBloqueio: "sem_pedido_confirmado" };
  }

  const movimentos = await obterMovimentosBonusTemporada(params.tenantId, temporada.temporadaId, params.clienteId);
  const concluidaHoje = movimentos.some((movimento) =>
    movimento.tipo === "missao_divulgacao_diaria" &&
    movimento.eventoId === eventoId(expedienteId) &&
    movimento.pontos > 0
  );

  return {
    ativa: true,
    elegivel: true,
    concluidaHoje,
    bonus: config.missaoDivulgacaoBonus,
    expedienteId,
    motivoBloqueio: null,
  };
}

export async function obterOuCriarConviteDivulgacao(params: {
  tenantId: string;
  clienteId: string;
  agora?: number;
}): Promise<{
  estado: EstadoMissaoDivulgacao;
  token: string | null;
  refToken: string | null;
  premioDescricao: string | null;
}> {
  const agora = params.agora ?? Date.now();
  const estado = await obterEstadoMissaoDivulgacao({ ...params, agora });
  if (!estado.elegivel || estado.concluidaHoje) {
    return { estado, token: null, refToken: null, premioDescricao: null };
  }

  if (!referenciaPrivadaCliente(params.clienteId)) {
    return {
      estado: { ...estado, elegivel: false, motivoBloqueio: "infraestrutura_indisponivel" },
      token: null,
      refToken: null,
      premioDescricao: null,
    };
  }

  const temporada = await obterTemporadaAtiva(params.tenantId);
  if (!temporada) return { estado, token: null, refToken: null, premioDescricao: null };

  const base: TokenDivulgacao = {
    tenantId: params.tenantId,
    temporadaId: temporada.temporadaId,
    clienteId: params.clienteId,
    expedienteId: estado.expedienteId,
    refToken: await obterOuCriarTokenIndicacao(params.clienteId),
    criadoEm: new Date(agora).toISOString(),
  };

  const chaveDia = chaveTokenDoDia(base);
  if (!chaveDia) {
    return {
      estado: { ...estado, elegivel: false, motivoBloqueio: "infraestrutura_indisponivel" },
      token: null,
      refToken: null,
      premioDescricao: null,
    };
  }
  const existente = await redis.get<string>(chaveDia);
  if (existente && FORMATO_TOKEN.test(existente)) {
    const payload = await redis.get<TokenDivulgacao>(chaveToken(existente));
    if (payload?.clienteId === params.clienteId && payload.expedienteId === estado.expedienteId) {
      return {
        estado,
        token: existente,
        refToken: payload.refToken,
        premioDescricao: temporada.premioAprovado === true ? (temporada.premioDescricao ?? null) : null,
      };
    }
  }

  const token = randomBytes(18).toString("base64url");
  await redis.set(chaveToken(token), base, { ex: TTL_TOKEN_SEGUNDOS });
  await redis.set(chaveDia, token, { ex: TTL_TOKEN_SEGUNDOS });

  return {
    estado,
    token,
    refToken: base.refToken,
    premioDescricao: temporada.premioAprovado === true ? (temporada.premioDescricao ?? null) : null,
  };
}

export async function resolverConviteDivulgacao(token: string): Promise<TokenDivulgacao | null> {
  if (!FORMATO_TOKEN.test(token)) return null;
  const payload = await redis.get<TokenDivulgacao>(chaveToken(token));
  if (!payload || !payload.tenantId || !payload.temporadaId || !payload.clienteId || !payload.expedienteId || !payload.refToken) return null;
  return payload;
}

export async function confirmarAberturaConviteDivulgacao(params: {
  token: string;
  visitanteClienteId?: string | null;
}): Promise<{
  valido: boolean;
  refToken: string | null;
  bonus: "creditado" | "ja_creditado" | "nao_elegivel" | "self_open";
}> {
  const payload = await resolverConviteDivulgacao(params.token);
  if (!payload) return { valido: false, refToken: null, bonus: "nao_elegivel" };

  if (params.visitanteClienteId && params.visitanteClienteId === payload.clienteId) {
    return { valido: true, refToken: payload.refToken, bonus: "self_open" };
  }

  const [config, temporada, participa] = await Promise.all([
    obterConfigGamificacao(),
    obterTemporada(payload.tenantId, payload.temporadaId),
    obterParticipacaoRanking(payload.clienteId).catch(() => false),
  ]);

  if (
    !config.missaoDivulgacaoAtiva ||
    config.missaoDivulgacaoBonus <= 0 ||
    temporada?.estado !== "ativa" ||
    !participa
  ) {
    return { valido: true, refToken: payload.refToken, bonus: "nao_elegivel" };
  }

  const credito = await creditarBonusCompeticao({
    tenantId: payload.tenantId,
    temporadaId: payload.temporadaId,
    clienteId: payload.clienteId,
    eventoId: eventoId(payload.expedienteId),
    tipo: "missao_divulgacao_diaria",
    pontos: config.missaoDivulgacaoBonus,
    motivo: "Missão diária de divulgação",
  });

  if (credito === "creditado" || credito === "ja_creditado") {
    await sincronizarScoreTemporadaComBonus(payload.tenantId, payload.temporadaId, payload.clienteId);
    return { valido: true, refToken: payload.refToken, bonus: credito };
  }

  return { valido: true, refToken: payload.refToken, bonus: "nao_elegivel" };
}
