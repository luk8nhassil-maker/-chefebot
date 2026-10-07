import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { redis } from "./redis";
import { statusAssinaturaChefeBot } from "./assinaturaChefeBot.server";

const UNLOCK_KEY = "radar-vendas:v2:unlock:permanent";
const REFERRAL_TOKEN_KEY = "radar-vendas:v2:referral:token";
const REFERRAL_TOKEN_PREFIX = "radar-vendas:v2:referral:valid:";
const LEAD_PREFIX = "radar-vendas:v2:lead:";
const LEAD_INDEX = "radar-vendas:v2:lead-index";
const LEAD_DEDUPE_PREFIX = "radar-vendas:v2:lead-dedupe:";
const LEAD_TTL_SECONDS = 180 * 24 * 60 * 60;
const DEDUPE_TTL_SECONDS = 30 * 24 * 60 * 60;

export type RadarVendasUnlock = {
  grantedAt: string;
  reason: "referral_converted";
  referralLeadId: string;
};

export type RadarVendasAcesso = {
  ativo: boolean;
  fonte: "pro" | "indicacao" | "bloqueado";
  currentPlanId: "basic" | "plus" | "pro";
  assinaturaBloqueada: boolean;
  desbloqueioPermanente: boolean;
};

export type RadarVendasReferralLead = {
  id: string;
  token: string;
  nome: string;
  pizzaria: string;
  whatsapp: string;
  createdAt: string;
  status: "novo" | "convertido";
  convertedAt?: string;
};

type RedisRadar = typeof redis & {
  zadd: (key: string, value: { score: number; member: string }) => Promise<number>;
  zrange: (key: string, start: number, stop: number, opts?: { rev?: boolean }) => Promise<string[]>;
};

const rredis = redis as RedisRadar;

function tokenValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{18,40}$/.test(token);
}

function limparTexto(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

function sanitizarWhatsapp(value: unknown): string {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  if (digits.length < 10 || digits.length > 13) return "";
  return digits;
}

function tokenIndexKey(token: string) {
  return `${REFERRAL_TOKEN_PREFIX}${token}`;
}

function leadKey(id: string) {
  return `${LEAD_PREFIX}${id}`;
}

export async function lerDesbloqueioPermanenteRadarVendas(): Promise<RadarVendasUnlock | null> {
  return redis.get<RadarVendasUnlock>(UNLOCK_KEY).catch(() => null);
}

export async function concederDesbloqueioPermanenteRadarVendas(
  referralLeadId: string,
): Promise<RadarVendasUnlock> {
  const unlock: RadarVendasUnlock = {
    grantedAt: new Date().toISOString(),
    reason: "referral_converted",
    referralLeadId,
  };
  const existente = await lerDesbloqueioPermanenteRadarVendas();
  if (existente) return existente;
  await redis.set(UNLOCK_KEY, unlock, { nx: true });
  return (await lerDesbloqueioPermanenteRadarVendas()) ?? unlock;
}

export async function statusAcessoRadarVendas(): Promise<RadarVendasAcesso> {
  const [assinatura, unlock] = await Promise.all([
    statusAssinaturaChefeBot(),
    lerDesbloqueioPermanenteRadarVendas(),
  ]);
  const assinaturaBloqueada = assinatura.avaliacao.blocked === true;
  const proAtivo = !assinaturaBloqueada && assinatura.estado.activePlanId === "pro";
  const indicadoAtivo = !assinaturaBloqueada && Boolean(unlock);

  return {
    ativo: proAtivo || indicadoAtivo,
    fonte: proAtivo ? "pro" : indicadoAtivo ? "indicacao" : "bloqueado",
    currentPlanId: assinatura.estado.activePlanId,
    assinaturaBloqueada,
    desbloqueioPermanente: Boolean(unlock),
  };
}

export async function obterOuCriarTokenIndicacaoRadarVendas(): Promise<string> {
  const atual = await redis.get<string>(REFERRAL_TOKEN_KEY).catch(() => null);
  if (atual && tokenValido(atual)) {
    await redis.set(tokenIndexKey(atual), { valid: true }, { nx: true });
    return atual;
  }

  const candidato = randomBytes(18).toString("base64url");
  const criado = await redis.set(REFERRAL_TOKEN_KEY, candidato, { nx: true });
  const vencedor = criado ? candidato : await redis.get<string>(REFERRAL_TOKEN_KEY);
  if (!vencedor || !tokenValido(vencedor)) throw new Error("radar_referral_token_unavailable");
  await redis.set(tokenIndexKey(vencedor), { valid: true }, { nx: true });
  return vencedor;
}

export async function tokenIndicacaoRadarValido(token: string): Promise<boolean> {
  if (!tokenValido(token)) return false;
  return Boolean(await redis.get(tokenIndexKey(token)).catch(() => null));
}

export async function registrarLeadIndicacaoRadarVendas(input: {
  token: unknown;
  nome: unknown;
  pizzaria: unknown;
  whatsapp: unknown;
}): Promise<{ ok: true; leadId: string; duplicate: boolean } | { ok: false; reason: string }> {
  const token = limparTexto(input.token, 64);
  const nome = limparTexto(input.nome, 80);
  const pizzaria = limparTexto(input.pizzaria, 100);
  const whatsapp = sanitizarWhatsapp(input.whatsapp);

  if (!tokenValido(token) || !(await tokenIndicacaoRadarValido(token))) return { ok: false, reason: "invalid_referral" };
  if (nome.length < 2 || pizzaria.length < 2 || !whatsapp) return { ok: false, reason: "invalid_lead" };

  const digest = createHash("sha256").update(`${token}:${whatsapp}`).digest("hex").slice(0, 32);
  const dedupeKey = `${LEAD_DEDUPE_PREFIX}${digest}`;
  const existente = await redis.get<string>(dedupeKey).catch(() => null);
  if (existente) return { ok: true, leadId: existente, duplicate: true };

  const id = randomUUID();
  const lead: RadarVendasReferralLead = {
    id,
    token,
    nome,
    pizzaria,
    whatsapp,
    createdAt: new Date().toISOString(),
    status: "novo",
  };

  const claim = await redis.set(dedupeKey, id, { nx: true, ex: DEDUPE_TTL_SECONDS });
  if (!claim) {
    const vencedor = await redis.get<string>(dedupeKey).catch(() => null);
    if (vencedor) return { ok: true, leadId: vencedor, duplicate: true };
    return { ok: false, reason: "dedupe_conflict" };
  }

  await redis.set(leadKey(id), lead, { ex: LEAD_TTL_SECONDS });
  await rredis.zadd(LEAD_INDEX, { score: Date.now(), member: id });
  return { ok: true, leadId: id, duplicate: false };
}

export async function listarLeadsIndicacaoRadarVendas(limite = 100): Promise<RadarVendasReferralLead[]> {
  const ids = await rredis.zrange(LEAD_INDEX, 0, Math.max(0, limite - 1), { rev: true }).catch(() => []);
  const leads = await Promise.all(ids.map((id) => redis.get<RadarVendasReferralLead>(leadKey(id)).catch(() => null)));
  return leads.filter((lead): lead is RadarVendasReferralLead => Boolean(lead));
}

export async function confirmarLeadPaganteRadarVendas(
  leadId: string,
): Promise<{ ok: true; unlock: RadarVendasUnlock; lead: RadarVendasReferralLead } | { ok: false; reason: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return { ok: false, reason: "invalid_lead_id" };
  const lead = await redis.get<RadarVendasReferralLead>(leadKey(leadId)).catch(() => null);
  if (!lead) return { ok: false, reason: "lead_not_found" };

  const convertedAt = lead.convertedAt ?? new Date().toISOString();
  const atualizado: RadarVendasReferralLead = {
    ...lead,
    status: "convertido",
    convertedAt,
  };
  await redis.set(leadKey(leadId), atualizado, { ex: LEAD_TTL_SECONDS });
  const unlock = await concederDesbloqueioPermanenteRadarVendas(leadId);
  return { ok: true, unlock, lead: atualizado };
}
