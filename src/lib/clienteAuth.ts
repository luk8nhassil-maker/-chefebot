import { randomUUID } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { redis } from "./redis";
import { sanitizeTelefoneCliente } from "./clientes";

export const CLIENTE_COOKIE = "cliente-token";

const OTP_TTL_SEGUNDOS = 5 * 60;
const OTP_MAX_TENTATIVAS = 5;
const OTP_COOLDOWN_SEGUNDOS = 60;
const SESSAO_DURACAO = "30d";

export type ClienteTokenPayload = {
  clienteId: string;
  telefone: string;
};

type RegistroOtp = {
  codigo: string;
  tentativas: number;
};

function getSecret() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "chefebot-dev-secret-troque-em-producao"
  );
}

function chaveOtp(telefoneSanitizado: string): string {
  return `cliente:otp:${telefoneSanitizado}`;
}

function chaveCooldown(telefoneSanitizado: string): string {
  return `cliente:otp_cooldown:${telefoneSanitizado}`;
}

export async function podeReenviarOtp(telefone: string): Promise<boolean> {
  const tel = sanitizeTelefoneCliente(telefone);
  if (!tel) return false;
  const emCooldown = await redis.get(chaveCooldown(tel));
  return !emCooldown;
}

export async function gerarOtp(telefone: string): Promise<string> {
  const tel = sanitizeTelefoneCliente(telefone);
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const registro: RegistroOtp = { codigo, tentativas: 0 };
  await redis.set(chaveOtp(tel), registro, { ex: OTP_TTL_SEGUNDOS });
  await redis.set(chaveCooldown(tel), true, { ex: OTP_COOLDOWN_SEGUNDOS });
  return codigo;
}

export async function verificarOtp(telefone: string, codigo: string): Promise<boolean> {
  const tel = sanitizeTelefoneCliente(telefone);
  if (!tel || !codigo) return false;
  const chave = chaveOtp(tel);
  const registro = await redis.get<RegistroOtp>(chave);
  if (!registro) return false;

  if (registro.tentativas >= OTP_MAX_TENTATIVAS) {
    await redis.del(chave);
    return false;
  }

  if (registro.codigo !== codigo.trim()) {
    await redis.set(chave, { ...registro, tentativas: registro.tentativas + 1 }, { ex: OTP_TTL_SEGUNDOS });
    return false;
  }

  await redis.del(chave);
  return true;
}

// ============================================================================
// TICKET DE ATIVAÇÃO DE SESSÃO POR NAVEGAÇÃO
// O navegador interno do WhatsApp no iOS (WKWebView) não persiste de forma
// confiável um Set-Cookie vindo de resposta de fetch/XHR — comprovado em
// produção: POST /api/cliente/verificar 200 seguido de GETs 401 mesmo após
// 60s. Cookies definidos em resposta de NAVEGAÇÃO de documento persistem
// sempre. O ticket é um valor opaco de uso único (TTL 60s) que o verificar
// devolve junto com o cookie; se a sessão via fetch não "pegar", o front
// navega para GET /api/cliente/sessao?tk=..., que consome o ticket, emite o
// MESMO cookie numa resposta de navegação e redireciona de volta.
// ============================================================================

const TICKET_TTL_SEGUNDOS = 60;

function chaveTicket(ticket: string): string {
  return `cliente:ticket:${ticket}`;
}

export async function criarTicketSessao(payload: ClienteTokenPayload): Promise<string> {
  const ticket = randomUUID().replace(/-/g, "");
  await redis.set(chaveTicket(ticket), payload, { ex: TICKET_TTL_SEGUNDOS });
  return ticket;
}

// Uso único: o del acontece antes de devolver — um segundo consumo do mesmo
// ticket sempre retorna null (proteção contra replay do link de ativação).
export async function consumirTicketSessao(ticket: string | null | undefined): Promise<ClienteTokenPayload | null> {
  if (!ticket || !/^[a-f0-9]{32}$/.test(ticket)) return null;
  const chave = chaveTicket(ticket);
  const payload = await redis.get<ClienteTokenPayload>(chave);
  await redis.del(chave);
  if (!payload || typeof payload.clienteId !== "string" || typeof payload.telefone !== "string") return null;
  return { clienteId: payload.clienteId, telefone: payload.telefone };
}

export async function criarTokenCliente(payload: ClienteTokenPayload): Promise<string> {
  return new SignJWT({ clienteId: payload.clienteId, telefone: payload.telefone })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(SESSAO_DURACAO)
    .sign(getSecret());
}

export async function verificarTokenCliente(token: string): Promise<ClienteTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.clienteId !== "string" || typeof payload.telefone !== "string") return null;
    return { clienteId: payload.clienteId, telefone: payload.telefone };
  } catch {
    return null;
  }
}
