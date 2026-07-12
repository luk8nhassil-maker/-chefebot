import { randomBytes } from "crypto";
import { redis } from "./redis";
import { sanitizeTelefoneCliente } from "./clientes";

export const CLIENTE_COOKIE = "cliente-token";

const OTP_TTL_SEGUNDOS = 5 * 60;
const OTP_MAX_TENTATIVAS = 5;
const OTP_COOLDOWN_SEGUNDOS = 60;

/**
 * Sessao do cliente: expiracao deslizante de 15 dias, guardada no Redis
 * (nunca um JWT autocontido). O valor no cookie e um id opaco de sessao —
 * so tem significado se a chave `cliente:sessao:{id}` ainda existir no
 * Redis, o que torna logout e expiracao imediatos (nao depende de decodificar
 * nada localmente). Todo acesso autenticado valido (verificarTokenCliente)
 * renova o TTL da chave para mais 15 dias a partir de agora — por isso quem
 * chama tambem deve re-setar o cookie com o mesmo valor e o novo maxAge
 * (ver cookieOptionsSessaoCliente), para o navegador nao expirar o cookie
 * antes do Redis.
 */
export const SESSAO_TTL_SEGUNDOS = 15 * 24 * 60 * 60;

export type ClienteTokenPayload = {
  clienteId: string;
  telefone: string;
};

type RegistroOtp = {
  codigo: string;
  tentativas: number;
};

function chaveOtp(telefoneSanitizado: string): string {
  return `cliente:otp:${telefoneSanitizado}`;
}

function chaveCooldown(telefoneSanitizado: string): string {
  return `cliente:otp_cooldown:${telefoneSanitizado}`;
}

function chaveSessao(sessionId: string): string {
  return `cliente:sessao:${sessionId}`;
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

function gerarSessionId(): string {
  return randomBytes(32).toString("hex");
}

/** Cria uma nova sessao de cliente no Redis (TTL inicial de 15 dias) e devolve o id opaco a guardar no cookie. */
export async function criarTokenCliente(payload: ClienteTokenPayload): Promise<string> {
  const sessionId = gerarSessionId();
  await redis.set(chaveSessao(sessionId), payload, { ex: SESSAO_TTL_SEGUNDOS });
  return sessionId;
}

/**
 * Valida uma sessao de cliente pelo id opaco do cookie. Sessao inexistente
 * ou expirada retorna null (mesmo tratamento de "sem sessao" usado por todas
 * as rotas). Expiracao deslizante: toda validacao com sucesso renova o TTL
 * da chave no Redis para mais 15 dias — quem chama deve tambem re-setar o
 * cookie de resposta (cookieOptionsSessaoCliente) para manter os dois em
 * sincronia.
 */
export async function verificarTokenCliente(sessionId: string): Promise<ClienteTokenPayload | null> {
  if (!sessionId) return null;
  const sessao = await redis.get<ClienteTokenPayload>(chaveSessao(sessionId));
  if (!sessao || typeof sessao.clienteId !== "string" || typeof sessao.telefone !== "string") return null;
  await redis.expire(chaveSessao(sessionId), SESSAO_TTL_SEGUNDOS);
  return sessao;
}

/** Apaga a sessao do Redis (logout). Idempotente — id ausente/ja apagado nao e erro. */
export async function invalidarSessaoCliente(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  await redis.del(chaveSessao(sessionId));
}

/** Opcoes de cookie para a sessao do cliente — HttpOnly, SameSite=Lax, Secure em producao, maxAge sempre igual ao TTL da sessao no Redis. */
export function cookieOptionsSessaoCliente() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSAO_TTL_SEGUNDOS,
  };
}
