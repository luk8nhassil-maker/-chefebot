import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  derivarClienteIdPorTelefone,
  estrelasV1Ativa,
  metaEstrelasDaConfig,
  obterConfigFidelidadePontos,
  obterRecompensasPontos,
  obterSaldoPontos,
} from "./fidelidade";
import { obterParticipacaoRanking } from "./consentimentoRanking";
import { redis } from "./redis";

const MS_DIA = 24 * 60 * 60 * 1000;
const TTL_90_DIAS = 90 * 24 * 60 * 60;
const TTL_MUTEX_SEGUNDOS = 20;
const LINK_AREA_CLIENTE = "https://chefedapizza.com.br/cliente";

export const POLITICA_CONVITE_RANKING_WHATSAPP = {
  // Alinhada ao teto conservador já usado pelo ChefeBot em contatos proativos.
  cooldownDias: 14,
  maxConvites90Dias: 3,
  janelaDias: 90,
} as const;

export type SituacaoConviteRankingWhatsapp =
  | "presente_garantido"
  | "meta_alcancada"
  | "progresso_estrelas";

export type ResultadoPreparacaoConviteRankingWhatsapp =
  | {
      status: "pronto";
      exposureId: string;
      situacao: SituacaoConviteRankingWhatsapp;
      mensagem: string;
    }
  | {
      status: "suprimido";
      motivo:
        | "identidade_incerta"
        | "ja_participa"
        | "opt_out"
        | "estrelas_inativas"
        | "sem_progresso_real"
        | "avaliacao_nao_positiva"
        | "cooldown_14_dias"
        | "limite_3_convites_90_dias"
        | "evento_ja_reservado"
        | "mutex_ocupado";
    };

type EstadoExposicao = {
  status: "reservado" | "enviado";
  customerKey: string;
  exposureId: string;
  situacao: SituacaoConviteRankingWhatsapp;
  criadoEmMs: number;
  enviadoEmMs?: number;
};

type RedisRankingConvite = {
  zadd: (key: string, entry: { score: number; member: string }) => Promise<number>;
  zrange: (key: string, min: number | string, max: number | string, opts?: { byScore?: boolean }) => Promise<string[]>;
  zscore: (key: string, member: string) => Promise<number | null>;
  zremrangebyscore: (key: string, min: number | string, max: number | string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
};

const rredis = redis as unknown as RedisRankingConvite;

const LIBERAR_MUTEX_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function hash(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

export function derivarCustomerKeyConviteRanking(telefone?: string): string | null {
  const clienteId = derivarClienteIdPorTelefone(telefone);
  if (!clienteId) return null;
  return hash(`chefebot:ranking-invite:v1:${clienteId}`);
}

function normalizarEvento(eventId: string): string | null {
  const valor = eventId.trim();
  if (!valor || valor.length > 180) return null;
  return valor;
}

function exposureId(customerKey: string, triggerEventId: string): string {
  return hash(`chefebot:ranking-invite:exposure:v1:${customerKey}:${triggerEventId}`);
}

function chaveHistorico(customerKey: string): string {
  return `ranking:convites-whatsapp:v1:${customerKey}`;
}

function chaveOptOut(customerKey: string): string {
  return `ranking:convites-whatsapp:optout:v1:${customerKey}`;
}

function chaveMutex(customerKey: string): string {
  return `ranking:convites-whatsapp:mutex:v1:${customerKey}`;
}

function chaveExposicao(id: string): string {
  return `ranking:convites-whatsapp:exposicao:v1:${id}`;
}

export function ehComandoOptOutRankingWhatsapp(texto: string): boolean {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase() === "sair ranking";
}

export async function registrarOptOutConviteRankingWhatsapp(telefone?: string): Promise<boolean> {
  const customerKey = derivarCustomerKeyConviteRanking(telefone);
  if (!customerKey) return false;
  await redis.set(chaveOptOut(customerKey), {
    optOut: true,
    registradoEmMs: Date.now(),
  });
  return true;
}

export async function clienteTemOptOutConviteRankingWhatsapp(telefone?: string): Promise<boolean> {
  const customerKey = derivarCustomerKeyConviteRanking(telefone);
  if (!customerKey) return true;
  const estado = await redis.get<{ optOut?: boolean }>(chaveOptOut(customerKey));
  return estado?.optOut === true;
}

export async function consumirOptOutConviteRankingWhatsapp(params: {
  telefone?: string;
  resposta: string;
}): Promise<boolean> {
  if (!ehComandoOptOutRankingWhatsapp(params.resposta)) return false;
  return registrarOptOutConviteRankingWhatsapp(params.telefone);
}

export function montarMensagemConviteRankingWhatsapp(params: {
  situacao: SituacaoConviteRankingWhatsapp;
  saldoEstrelas: number;
  metaEstrelas: number;
  coberturaEconomicaAprovada?: boolean;
}): string {
  const saldo = Math.max(0, Math.round(params.saldoEstrelas));

  if (params.situacao === "presente_garantido") {
    return [
      "🎁 Você já tem um presente esperando por você!",
      `Veja aqui: ${LINK_AREA_CLIENTE}`,
      "",
      "Se não quiser mais receber convites do Ranking, responda *SAIR RANKING*.",
    ].join("\n");
  }

  const chamada = params.coberturaEconomicaAprovada === true
    ? "🎁 Quer ganhar presentes da pizzaria?"
    : "⭐ Quer entrar no Ranking do Chefe?";

  return [
    chamada,
    `Você já tem *${saldo} Estrelas*. É só clicar: ${LINK_AREA_CLIENTE}`,
    "",
    "Se não quiser mais receber convites do Ranking, responda *SAIR RANKING*.",
  ].join("\n");
}

async function listarTentativas(customerKey: string, agoraMs: number): Promise<number[]> {
  const inicio = agoraMs - POLITICA_CONVITE_RANKING_WHATSAPP.janelaDias * MS_DIA;
  const key = chaveHistorico(customerKey);
  const members = await rredis.zrange(key, inicio, agoraMs, { byScore: true });
  const scores: number[] = [];
  for (const member of members) {
    const score = await rredis.zscore(key, member);
    if (score !== null && Number.isFinite(score) && score > inicio && score <= agoraMs) scores.push(score);
  }
  return scores;
}

async function liberarMutex(chave: string, token: string): Promise<void> {
  try {
    await rredis.eval(LIBERAR_MUTEX_LUA, [chave], [token]);
  } catch {
    // O TTL curto evita lock permanente. Nunca apaga mutex de outro processo.
  }
}

export async function prepararConviteRankingWhatsapp(params: {
  telefone?: string;
  triggerEventId: string;
  notaAvaliacao?: number;
  agoraMs?: number;
}): Promise<ResultadoPreparacaoConviteRankingWhatsapp> {
  const agoraMs = params.agoraMs ?? Date.now();
  const clienteId = derivarClienteIdPorTelefone(params.telefone);
  const customerKey = derivarCustomerKeyConviteRanking(params.telefone);
  const triggerEventId = normalizarEvento(params.triggerEventId);

  if (!clienteId || !customerKey || !triggerEventId || !Number.isFinite(agoraMs) || agoraMs <= 0) {
    return { status: "suprimido", motivo: "identidade_incerta" };
  }
  if (params.notaAvaliacao !== undefined && (!Number.isFinite(params.notaAvaliacao) || params.notaAvaliacao < 4)) {
    return { status: "suprimido", motivo: "avaliacao_nao_positiva" };
  }

  const mutexKey = chaveMutex(customerKey);
  const token = randomUUID();
  const lock = await redis.set(mutexKey, token, { nx: true, ex: TTL_MUTEX_SEGUNDOS });
  if (!lock) return { status: "suprimido", motivo: "mutex_ocupado" };

  try {
    const id = exposureId(customerKey, triggerEventId);
    const estadoExistente = await redis.get<EstadoExposicao>(chaveExposicao(id));
    if (estadoExistente) {
      return { status: "suprimido", motivo: "evento_ja_reservado" };
    }

    const [participa, optOut, config] = await Promise.all([
      // Falha fechada: se não for possível provar que NÃO participa, não convida.
      obterParticipacaoRanking(clienteId).catch(() => true),
      clienteTemOptOutConviteRankingWhatsapp(params.telefone),
      obterConfigFidelidadePontos(),
    ]);

    if (participa) return { status: "suprimido", motivo: "ja_participa" };
    if (optOut) return { status: "suprimido", motivo: "opt_out" };
    if (!estrelasV1Ativa(config)) return { status: "suprimido", motivo: "estrelas_inativas" };

    const [saldoObj, recompensas] = await Promise.all([
      obterSaldoPontos(clienteId),
      obterRecompensasPontos(clienteId),
    ]);
    const saldo = Math.max(0, Math.round(saldoObj.disponivel));
    if (saldo <= 0) return { status: "suprimido", motivo: "sem_progresso_real" };

    const tentativas = await listarTentativas(customerKey, agoraMs);
    const inicioCooldown = agoraMs - POLITICA_CONVITE_RANKING_WHATSAPP.cooldownDias * MS_DIA;
    if (tentativas.some((ts) => ts > inicioCooldown)) {
      return { status: "suprimido", motivo: "cooldown_14_dias" };
    }
    if (tentativas.length >= POLITICA_CONVITE_RANKING_WHATSAPP.maxConvites90Dias) {
      return { status: "suprimido", motivo: "limite_3_convites_90_dias" };
    }

    const meta = metaEstrelasDaConfig(config);
    const temPresente = config.coberturaEconomicaAprovada === true && recompensas.some(
      (r) => r.status === "disponivel" || r.status === "notificada",
    );
    const situacao: SituacaoConviteRankingWhatsapp = temPresente
      ? "presente_garantido"
      : saldo >= meta
        ? "meta_alcancada"
        : "progresso_estrelas";

    // Reserva ANTES do provider. Uma falha externa consome a janela conservadora
    // em vez de arriscar mensagem duplicada por retry ambíguo.
    const historyKey = chaveHistorico(customerKey);
    await rredis.zadd(historyKey, { score: agoraMs, member: id });
    await rredis.zremrangebyscore(
      historyKey,
      "-inf",
      agoraMs - POLITICA_CONVITE_RANKING_WHATSAPP.janelaDias * MS_DIA,
    );
    await rredis.expire(historyKey, TTL_90_DIAS);

    const estado: EstadoExposicao = {
      status: "reservado",
      customerKey,
      exposureId: id,
      situacao,
      criadoEmMs: agoraMs,
    };
    await redis.set(chaveExposicao(id), estado, { ex: TTL_90_DIAS });

    return {
      status: "pronto",
      exposureId: id,
      situacao,
      mensagem: montarMensagemConviteRankingWhatsapp({
        situacao,
        saldoEstrelas: saldo,
        metaEstrelas: meta,
        coberturaEconomicaAprovada: config.coberturaEconomicaAprovada === true,
      }),
    };
  } finally {
    await liberarMutex(mutexKey, token);
  }
}

export async function confirmarConviteRankingWhatsapp(params: {
  exposureId: string;
  enviadoEmMs?: number;
}): Promise<boolean> {
  const id = params.exposureId.trim();
  if (!id) return false;
  const key = chaveExposicao(id);
  const estado = await redis.get<EstadoExposicao>(key);
  if (!estado || estado.exposureId !== id) return false;
  if (estado.status === "enviado") return true;

  await redis.set(key, {
    ...estado,
    status: "enviado",
    enviadoEmMs: params.enviadoEmMs ?? Date.now(),
  }, { ex: TTL_90_DIAS });
  return true;
}
