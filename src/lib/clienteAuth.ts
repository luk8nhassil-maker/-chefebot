import type { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { redis } from "./redis";
import { sanitizeTelefoneCliente, buscarClientePorId, type Cliente } from "./clientes";

export const CLIENTE_COOKIE = "cliente-token";

const OTP_TTL_SEGUNDOS = 5 * 60;
const OTP_MAX_TENTATIVAS = 5;
const OTP_COOLDOWN_SEGUNDOS = 60;

// Sessão deslizante: 15 dias a partir do ÚLTIMO acesso, não do login. Um
// único número de dias alimenta o JWT (jose aceita "Nd"), o TTL da sessão no
// Redis e o Max-Age do cookie — evita o desalinhamento que existia antes
// entre o "30d" do JWT e o `maxAge` do cookie, hardcoded em dois lugares.
const SESSAO_DIAS = 15;
const SESSAO_TTL_SEGUNDOS = SESSAO_DIAS * 24 * 60 * 60;
const SESSAO_DURACAO_JWT = `${SESSAO_DIAS}d`;

// Renova (TTL da sessão no Redis + reemite o JWT/cookie) no máximo uma vez
// por hora de uso real, mesmo com acessos muito mais frequentes (ex.: o
// polling de 15s de /cliente/pedidos) — evita reescrever o Redis e reemitir
// cookie a cada request. Ainda assim, qualquer sessão usada ao menos uma vez
// por hora nunca expira antes de 15 dias de INATIVIDADE real.
const RENOVACAO_MIN_INTERVALO_MS = 60 * 60 * 1000;

export type ClienteTokenPayload = {
  clienteId: string;
  telefone: string;
};

type RegistroSessaoCliente = {
  criadoEm: string;
  ultimoAcessoEm: string;
};

export type SessaoClienteResolvida = {
  cliente: Cliente;
  /** true quando esta chamada já renovou (Redis + novoToken) — o chamador deve reemitir o cookie com `novoToken`. */
  deveRenovar: boolean;
  novoToken?: string;
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

export async function criarTokenCliente(payload: ClienteTokenPayload): Promise<string> {
  return new SignJWT({ clienteId: payload.clienteId, telefone: payload.telefone })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(SESSAO_DURACAO_JWT)
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

function chaveSessaoCliente(clienteId: string): string {
  return `cliente:sessao:${clienteId}`;
}

/**
 * Cria a sessão do cliente: grava o registro de sessão no Redis (TTL de 15
 * dias) e assina o JWT correspondente. Chamada só no login (verificação de
 * OTP bem-sucedida) — renovações usam `resolverSessaoCliente`, que reemite o
 * JWT sem passar por aqui de novo.
 */
export async function criarSessaoCliente(payload: ClienteTokenPayload): Promise<string> {
  const agora = new Date().toISOString();
  const registro: RegistroSessaoCliente = { criadoEm: agora, ultimoAcessoEm: agora };
  await redis.set(chaveSessaoCliente(payload.clienteId), registro, { ex: SESSAO_TTL_SEGUNDOS });
  return criarTokenCliente(payload);
}

/**
 * Resolve a sessão do cliente autenticado a partir do cookie da requisição —
 * ponto único usado por toda rota protegida de `/api/cliente/*` (evita
 * duplicar cookie->JWT->cliente rota a rota). Além de validar o JWT, exige
 * que exista um registro de sessão ativo no Redis: é essa checagem extra
 * (não só o `exp` do JWT) que permite ao logout invalidar a sessão
 * imediatamente no servidor, mesmo que o JWT em si ainda não tenha expirado.
 *
 * Deslizante: se o último acesso registrado foi há mais de
 * `RENOVACAO_MIN_INTERVALO_MS`, renova o TTL da sessão no Redis para mais 15
 * dias e reemite o JWT (mesmo payload, `exp` novo) — o chamador deve setar o
 * cookie com `novoToken` quando `deveRenovar` for true. Nunca renova mais de
 * uma vez dentro da mesma janela de 1h, mesmo sob polling frequente.
 */
export async function resolverSessaoCliente(req: NextRequest): Promise<SessaoClienteResolvida | null> {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return null;

  const payload = await verificarTokenCliente(token);
  if (!payload) return null;

  const registro = await redis.get<RegistroSessaoCliente>(chaveSessaoCliente(payload.clienteId));
  if (!registro) return null;

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return null;

  const ultimoAcessoMs = new Date(registro.ultimoAcessoEm).getTime();
  const deveRenovar = !Number.isFinite(ultimoAcessoMs) || Date.now() - ultimoAcessoMs >= RENOVACAO_MIN_INTERVALO_MS;

  if (!deveRenovar) {
    return { cliente, deveRenovar: false };
  }

  const novoRegistro: RegistroSessaoCliente = { criadoEm: registro.criadoEm, ultimoAcessoEm: new Date().toISOString() };
  await redis.set(chaveSessaoCliente(payload.clienteId), novoRegistro, { ex: SESSAO_TTL_SEGUNDOS });
  const novoToken = await criarTokenCliente(payload);

  return { cliente, deveRenovar: true, novoToken };
}

/** Invalida a sessão imediatamente no servidor (usado pelo logout). */
export async function invalidarSessaoCliente(clienteId: string): Promise<void> {
  await redis.del(chaveSessaoCliente(clienteId));
}

/** Aplica o cookie de sessão (mesmos atributos no login e nas renovações). */
export function definirCookieSessaoCliente(res: NextResponse, token: string): void {
  res.cookies.set(CLIENTE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSAO_TTL_SEGUNDOS,
  });
}
