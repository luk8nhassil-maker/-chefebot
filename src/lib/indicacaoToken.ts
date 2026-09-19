import { randomBytes } from "crypto";
import { redis } from "./redis";

// Token opaco de 18 bytes → 24 chars base64url. Válido por 90 dias.
const TTL_TOKEN_SEGUNDOS = 90 * 24 * 60 * 60;
// Candidatura expira junto com o token que a originou.
const TTL_CANDIDATURA_SEGUNDOS = 90 * 24 * 60 * 60;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{24}$/;

function chaveToken(token: string): string { return `indicacao:token:${token}`; }
function chaveRelacao(indicadoId: string): string { return `indicacao:relacao:${indicadoId}`; }
function chaveCandidatura(indicadoId: string): string { return `indicacao:candidatura:${indicadoId}`; }

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

export async function resolverTokenIndicacao(token: string): Promise<string | null> {
  if (!tokenIndicacaoValido(token)) return null;
  const entry = await redis.get<{ indicadorId: string }>(chaveToken(token));
  return entry?.indicadorId ?? null;
}

/**
 * Salva a candidatura de indicação: origem temporária registrada quando o
 * indicado clica no link, ANTES de qualquer compra. TTL = 90 dias.
 * First-write-wins; self-referral bloqueado sem escrita.
 */
export async function salvarCandidaturaIndicacao(
  indicadoId: string,
  indicadorId: string,
): Promise<"registrado" | "ja_existe" | "self_referral"> {
  if (!indicadoId || !indicadorId) return "ja_existe";
  if (indicadoId === indicadorId) return "self_referral";
  const payload: RelacaoIndicacao = { indicadorId, criadoEm: new Date().toISOString() };
  const ok = await redis.set(chaveCandidatura(indicadoId), payload, { nx: true, ex: TTL_CANDIDATURA_SEGUNDOS });
  return ok ? "registrado" : "ja_existe";
}

export async function obterCandidaturaIndicacao(indicadoId: string): Promise<RelacaoIndicacao | null> {
  if (!indicadoId) return null;
  return redis.get<RelacaoIndicacao>(chaveCandidatura(indicadoId));
}

/**
 * Confirma a relação permanente indicador→indicado na primeira compra válida.
 * First-write-wins, sem TTL. Token expirado nunca altera esta chave.
 */
export async function registrarRelacaoIndicacao(
  indicadoId: string,
  indicadorId: string,
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

function chaveTokenCliente(clienteId: string): string {
  return `indicacao:tokenCliente:${clienteId}`;
}

/**
 * Retorna o token de indicação existente (se ainda válido e pertence a este
 * cliente) ou cria um novo. Idempotente: chamadas repetidas retornam o mesmo
 * token enquanto ele estiver no prazo.
 */
export async function obterOuCriarTokenIndicacao(clienteId: string): Promise<string> {
  if (!clienteId) throw new Error("clienteId obrigatorio");
  const existente = await redis.get<string>(chaveTokenCliente(clienteId));
  if (existente && tokenIndicacaoValido(existente)) {
    const entry = await redis.get<{ indicadorId: string }>(chaveToken(existente));
    if (entry?.indicadorId === clienteId) return existente;
  }
  const token = gerarTokenIndicacao();
  await redis.set(chaveToken(token), { indicadorId: clienteId, criadoEm: new Date().toISOString() }, { ex: TTL_TOKEN_SEGUNDOS });
  await redis.set(chaveTokenCliente(clienteId), token, { ex: TTL_TOKEN_SEGUNDOS });
  return token;
}
