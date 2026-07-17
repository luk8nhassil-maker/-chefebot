import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { redis } from "./redis";
import type { EntregadorCadastro } from "@/types/entregador";

export const ENTREGADOR_COOKIE = "entregador-token";
export const ENTREGADOR_TICKET_TTL_SEGUNDOS = 24 * 60 * 60;
export const ENTREGADOR_SESSAO_TTL_SEGUNDOS = 7 * 24 * 60 * 60;
export const ENTREGADOR_APP_BASE_URL = "https://chefebot-pjif.vercel.app";

const ENTREGADOR_ISSUER = "chefebot:entregador-auth";
const ENTREGADOR_AUDIENCE = "chefebot:area-entregador";
const ENTREGADOR_SESSION_TYPE = "entregador";
const TICKET_BYTES = 32;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PEDIDO_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type EntregadorSessao = {
  entregadorId: string;
  nome: string;
  tipo: "entregador";
  issuedAt: number;
  expiresAt: number;
};

type RegistroTicket = {
  entregadorId: string;
  criadoEm: string;
  expiraEm: string;
};

/**
 * Verdadeiro em produção e em qualquer Preview hospedado na Vercel. Checar
 * só `NODE_ENV === "production"` deixa passar silenciosamente ambientes
 * hospedados onde essa variável não vem exatamente assim — `VERCEL_ENV`
 * cobre esse caso e nunca é definida fora da Vercel (não afeta dev/CI local).
 */
function ambienteExigeSeguranca(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview"
  );
}

function getSecret() {
  const segredoConfigurado = process.env.AUTH_SECRET?.trim();
  if (!segredoConfigurado && ambienteExigeSeguranca()) {
    throw new Error("AUTH_SECRET obrigatorio para autenticar entregadores em producao");
  }
  const segredoBase = segredoConfigurado || "chefebot-dev-secret-local-entregador";
  // Deriva uma chave exclusiva para esta sessao. Mesmo com o mesmo segredo
  // operacional, um JWT do entregador nao valida no autenticador da equipe.
  return createHash("sha256")
    .update(`${segredoBase}:entregador-session:v1`, "utf8")
    .digest();
}

export function entregadorIdValido(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function ticketAcessoValido(value: unknown): value is string {
  return typeof value === "string" && TICKET_PATTERN.test(value);
}

/**
 * Todo pedidoId usado como componente de chave Redis (`loc:`,
 * `entregador:pedidos:`, `entregador:rate:localizacao:`) precisa respeitar
 * este charset, não só o tamanho — evita que um valor com `:` ou espaço
 * colida com outro padrão de chave no mesmo namespace.
 */
export function pedidoIdValido(value: unknown): value is string {
  return typeof value === "string" && PEDIDO_ID_PATTERN.test(value);
}

export function hashTicketAcesso(ticket: string): string {
  return createHash("sha256").update(ticket, "utf8").digest("hex");
}

function chaveTicket(hash: string): string {
  return `entregador:acesso:${hash}`;
}

export async function listarEntregadores(): Promise<EntregadorCadastro[]> {
  return (await redis.get<EntregadorCadastro[]>("entregadores")) ?? [];
}

export async function obterEntregadorPorId(entregadorId: string): Promise<EntregadorCadastro | null> {
  const entregadores = await listarEntregadores();
  return entregadores.find((entregador) => entregador.id === entregadorId) ?? null;
}

export async function obterEntregadorAtivo(entregadorId: string): Promise<EntregadorCadastro | null> {
  const entregador = await obterEntregadorPorId(entregadorId);
  return entregador?.ativo ? entregador : null;
}

export async function criarTicketAcessoEntregador(entregadorId: string): Promise<{
  ticket: string;
  expiraEm: string;
}> {
  if (!entregadorIdValido(entregadorId)) throw new Error("entregador_invalido");

  const ticket = randomBytes(TICKET_BYTES).toString("base64url");
  const hash = hashTicketAcesso(ticket);
  const agora = Date.now();
  const expiraEm = new Date(agora + ENTREGADOR_TICKET_TTL_SEGUNDOS * 1000).toISOString();
  const registro: RegistroTicket = {
    entregadorId,
    criadoEm: new Date(agora).toISOString(),
    expiraEm,
  };

  // O valor puro existe apenas em memória para montar a mensagem. O Redis
  // recebe exclusivamente o SHA-256 e o registro mínimo com TTL.
  await redis.set(chaveTicket(hash), JSON.stringify(registro), {
    ex: ENTREGADOR_TICKET_TTL_SEGUNDOS,
  });
  return { ticket, expiraEm };
}

const CONSUMIR_TICKET_LUA = `
local value = redis.call("GET", KEYS[1])
if not value then return nil end
redis.call("DEL", KEYS[1])
return value
`;

function parseRegistroTicket(value: unknown): RegistroTicket | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<RegistroTicket>;
    if (!entregadorIdValido(record.entregadorId)) return null;
    if (typeof record.criadoEm !== "string" || typeof record.expiraEm !== "string") return null;
    if (!Number.isFinite(Date.parse(record.criadoEm)) || !Number.isFinite(Date.parse(record.expiraEm))) return null;
    return record as RegistroTicket;
  } catch {
    return null;
  }
}

/** Consome de forma atômica. Uma segunda troca nunca reencontra o registro. */
export async function consumirTicketAcesso(ticket: string): Promise<RegistroTicket | null> {
  if (!ticketAcessoValido(ticket)) return null;
  const hash = hashTicketAcesso(ticket);
  const raw = await redis.eval(CONSUMIR_TICKET_LUA, [chaveTicket(hash)], []);
  const registro = parseRegistroTicket(raw);
  if (!registro || Date.parse(registro.expiraEm) <= Date.now()) return null;
  return registro;
}

export async function invalidarTicketAcesso(ticket: string): Promise<void> {
  if (!ticketAcessoValido(ticket)) return;
  await redis.del(chaveTicket(hashTicketAcesso(ticket)));
}

export async function criarTokenEntregador(entregador: EntregadorCadastro): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ENTREGADOR_SESSAO_TTL_SEGUNDOS;
  return new SignJWT({ nome: entregador.nome, tipo: ENTREGADOR_SESSION_TYPE })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ENTREGADOR_ISSUER)
    .setAudience(ENTREGADOR_AUDIENCE)
    .setSubject(entregador.id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(getSecret());
}

export async function verificarTokenEntregador(token: string): Promise<EntregadorSessao | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ENTREGADOR_ISSUER,
      audience: ENTREGADOR_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (
      payload.tipo !== ENTREGADOR_SESSION_TYPE ||
      !entregadorIdValido(payload.sub) ||
      typeof payload.nome !== "string" ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp! <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      entregadorId: payload.sub,
      nome: payload.nome,
      tipo: ENTREGADOR_SESSION_TYPE,
      issuedAt: payload.iat!,
      expiresAt: payload.exp!,
    };
  } catch {
    return null;
  }
}

export async function autenticarEntregador(req: NextRequest): Promise<{
  sessao: EntregadorSessao;
  entregador: EntregadorCadastro;
} | null> {
  const token = req.cookies.get(ENTREGADOR_COOKIE)?.value;
  if (!token) return null;
  const sessao = await verificarTokenEntregador(token);
  if (!sessao) return null;
  const entregador = await obterEntregadorAtivo(sessao.entregadorId);
  if (!entregador) return null;
  return {
    sessao: { ...sessao, nome: entregador.nome },
    entregador,
  };
}

export function montarLinkAcessoEntregador(ticket: string): string {
  return `${ENTREGADOR_APP_BASE_URL}/entregador#acesso=${encodeURIComponent(ticket)}`;
}

export function normalizarTelefoneEntregador(telefone: string): string {
  const digits = telefone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

export function cookieEntregadorOptions(maxAge = ENTREGADOR_SESSAO_TTL_SEGUNDOS) {
  return {
    httpOnly: true,
    secure: ambienteExigeSeguranca(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    expires: new Date(Date.now() + Math.max(0, maxAge) * 1000),
  };
}

export function hashIdentificadorRateLimit(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
