import { randomUUID, createHash } from "crypto";
import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt } from "jose";
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

// ============================================================================
// SESSÃO OPACA (fallback Bearer para navegadores sem cookie confiável)
// Validação humana em produção provou que o navegador interno do WhatsApp no
// iPhone não aplica Set-Cookie nem de resposta de fetch nem de redirect de
// navegação (dois hotfixes comprovaram: verificar 200 → perfil 401 sempre).
// Para esse navegador, a sessão é um token OPACO (128 bits aleatórios, sem
// nenhum dado do cliente embutido — pode viver em sessionStorage sem expor
// telefone), resolvido no Redis a cada uso e enviado via Authorization:
// Bearer. O cookie HttpOnly continua sendo o caminho principal em qualquer
// navegador normal; o front só usa o fallback quando o cookie comprovadamente
// não funcionou.
// ============================================================================

const SESSAO_OPACA_TTL_SEGUNDOS = 60 * 60 * 24 * 30;
const FORMATO_TOKEN_OPACO = /^[a-f0-9]{32}$/;

function chaveSessaoOpaca(token: string): string {
  return `cliente:sessao:${token}`;
}

export async function criarSessaoOpaca(payload: ClienteTokenPayload): Promise<string> {
  const token = randomUUID().replace(/-/g, "");
  await redis.set(chaveSessaoOpaca(token), payload, { ex: SESSAO_OPACA_TTL_SEGUNDOS });
  return token;
}

// Renova o TTL a cada uso — a sessão persiste por atividade, como o cookie.
export async function resolverSessaoOpaca(token: string | null | undefined): Promise<ClienteTokenPayload | null> {
  if (!token || !FORMATO_TOKEN_OPACO.test(token)) return null;
  const payload = await redis.get<ClienteTokenPayload>(chaveSessaoOpaca(token));
  if (!payload || typeof payload.clienteId !== "string" || typeof payload.telefone !== "string") return null;
  await redis.set(chaveSessaoOpaca(token), payload, { ex: SESSAO_OPACA_TTL_SEGUNDOS });
  return { clienteId: payload.clienteId, telefone: payload.telefone };
}

export async function revogarSessaoOpaca(token: string | null | undefined): Promise<void> {
  if (!token || !FORMATO_TOKEN_OPACO.test(token)) return;
  await redis.del(chaveSessaoOpaca(token));
}

export function extrairBearer(authorization: string | null | undefined): string | null {
  const m = (authorization || "").match(/^Bearer ([a-f0-9]{32})$/);
  return m ? m[1] : null;
}

// Extrai o valor bruto de Authorization: Bearer <valor>, sem restringir o
// formato — usado para tentar a sessão portátil (JWE) antes da opaca, já que
// os dois formatos têm formas bem diferentes (JWE tem pontos, opaca é hex).
function extrairBearerBruto(authorization: string | null | undefined): string | null {
  const m = (authorization || "").match(/^Bearer (.+)$/);
  return m ? m[1].trim() : null;
}

// ============================================================================
// SESSÃO PORTÁTIL (JWE, sem leitura de Redis para validar)
// Validação em produção provou uma segunda falha, distinta do problema de
// cookie: leituras de Redis logo após a escrita (réplica atrasada) faziam a
// sessão OPACA (que exige um redis.get a cada uso) devolver 401 mesmo com o
// header correto chegando ao servidor. A sessão portátil resolve isso
// eliminando essa leitura: o próprio token, cifrado (JWE, AES-256-GCM,
// alg "dir"), carrega clienteId+telefone e é validado só por decriptação — a
// mesma garantia de confidencialidade da sessão opaca (o valor é inútil sem a
// chave do servidor; pode viver em sessionStorage), mas sem depender de o
// Redis já ter propagado a escrita mais recente.
// ============================================================================

function chaveSessaoPortatil(): Buffer {
  return createHash("sha256").update(getSecret()).digest();
}

export async function criarSessaoPortatil(payload: ClienteTokenPayload): Promise<string> {
  return new EncryptJWT({ clienteId: payload.clienteId, telefone: payload.telefone })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(SESSAO_DURACAO)
    .encrypt(chaveSessaoPortatil());
}

export async function resolverSessaoPortatil(token: string | null | undefined): Promise<ClienteTokenPayload | null> {
  if (!token || !token.includes(".")) return null;
  try {
    const { payload } = await jwtDecrypt(token, chaveSessaoPortatil());
    if (typeof payload.clienteId !== "string" || typeof payload.telefone !== "string") return null;
    return { clienteId: payload.clienteId, telefone: payload.telefone };
  } catch {
    return null;
  }
}

// Leitura única de sessão para as rotas da área do cliente: cookie HttpOnly
// primeiro (caminho principal). Em seguida, Authorization: Bearer — tentando
// primeiro a sessão portátil (JWE, sem Redis) e só então a sessão opaca
// legada (compatibilidade com sessões emitidas antes desta mudança). Nunca
// aceita identificadores arbitrários de query/body.
export async function lerSessaoCliente(req: {
  cookies: { get(name: string): { value: string } | undefined };
  headers: { get(name: string): string | null };
}): Promise<ClienteTokenPayload | null> {
  const cookie = req.cookies.get(CLIENTE_COOKIE)?.value;
  if (cookie) {
    const payload = await verificarTokenCliente(cookie);
    if (payload) return payload;
  }
  const bruto = extrairBearerBruto(req.headers.get("authorization"));
  if (!bruto) return null;
  const portatil = await resolverSessaoPortatil(bruto);
  if (portatil) return portatil;
  return resolverSessaoOpaca(extrairBearer(`Bearer ${bruto}`));
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
