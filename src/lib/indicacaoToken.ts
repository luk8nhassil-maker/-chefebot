import { randomBytes } from "crypto";
import { redis } from "./redis";

// Token opaco de 18 bytes → 24 chars base64url. Válido por 90 dias.
const TTL_TOKEN_SEGUNDOS = 90 * 24 * 60 * 60;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{24}$/;

function chaveToken(token: string): string { return `indicacao:token:${token}`; }
function chaveRelacao(indicadoId: string): string { return `indicacao:relacao:${indicadoId}`; }

export type RelacaoIndicacao = {
  indicadorId: string;
  criadoEm: string;
};

export function gerarTokenIndicacao(): string {
  return randomBytes(18).toString("base64url");
}

export function tokenIndicacaoValido(token: string): boolean {
  return typeof token === "string" && FORMATO_TOKEN.test(token);
}

export async function salvarTokenIndicacao(indicadorId: string): Promise<string> {
  const token = gerarTokenIndicacao();
  await redis.set(chaveToken(token), { indicadorId, criadoEm: new Date().toISOString() }, { ex: TTL_TOKEN_SEGUNDOS });
  return token;
}

/**
 * Resolve um token opaco para o clienteId do indicador.
 * Retorna null para tokens inválidos ou expirados — nunca lança.
 */
export async function resolverTokenIndicacao(token: string): Promise<string | null> {
  if (!tokenIndicacaoValido(token)) return null;
  const entry = await redis.get<{ indicadorId: string }>(chaveToken(token));
  return entry?.indicadorId ?? null;
}

/**
 * Registra a relação permanente indicador→indicado (first-write-wins).
 * Self-referral é bloqueado antes de qualquer escrita.
 */
export async function registrarRelacaoIndicacao(
  indicadoId: string,
  indicadorId: string
): Promise<"registrado" | "ja_existe" | "self_referral"> {
  if (!indicadoId || !indicadorId) return "ja_existe";
  if (indicadoId === indicadorId) return "self_referral";
  const payload: RelacaoIndicacao = { indicadorId, criadoEm: new Date().toISOString() };
  const ok = await redis.set(chaveRelacao(indicadoId), payload, { nx: true });
  return ok ? "registrado" : "ja_existe";
}

export async function obterRelacaoIndicacao(indicadoId: string): Promise<RelacaoIndicacao | null> {
  if (!indicadoId) return null;
  return redis.get<RelacaoIndicacao>(chaveRelacao(indicadoId));
}
