import { SignJWT, jwtVerify } from "jose";
import { redis } from "./redis";

// Sessão do Módulo Salão — TOTALMENTE separada do login administrativo
// (src/lib/auth.ts): cookie próprio, segredo próprio, sem nenhuma conta em
// USERS e sem nenhum papel (Role) novo. Um código de acesso configurado
// pelo admin (nunca hardcoded) é o que autentica quem atende o salão —
// pensado para um tablet/terminal fixo do salão, não para uma conta
// pessoal por atendente.

export const SALAO_COOKIE = "salao-session";
const SESSAO_DURACAO = "12h";
const CHAVE_CONFIG_SALAO = "config:salao";

type ConfigSalao = { codigoAcesso?: string };

function getSecretSalao() {
  return new TextEncoder().encode(
    process.env.SALAO_SESSION_SECRET ?? process.env.AUTH_SECRET ?? "chefebot-dev-secret-troque-em-producao"
  );
}

export async function obterConfigSalao(): Promise<ConfigSalao> {
  return (await redis.get<ConfigSalao>(CHAVE_CONFIG_SALAO)) || {};
}

/** Só quem já tem uma sessão administrativa pode trocar o código — ver a rota que chama isto. */
export async function definirCodigoAcessoSalao(codigo: string): Promise<void> {
  await redis.set(CHAVE_CONFIG_SALAO, { codigoAcesso: codigo.trim() });
}

export async function validarCodigoAcessoSalao(codigo: string): Promise<boolean> {
  const config = await obterConfigSalao();
  const esperado = (config.codigoAcesso || "").trim();
  const recebido = (codigo || "").trim();
  // Sem código configurado, o login do Salão fica desligado por padrão —
  // nunca existe um código de fábrica aceito silenciosamente.
  if (!esperado || !recebido) return false;
  return esperado === recebido;
}

export async function criarTokenSalao(): Promise<string> {
  return new SignJWT({ tipo: "salao" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(SESSAO_DURACAO)
    .sign(getSecretSalao());
}

async function verificarTokenSalao(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecretSalao());
    return payload.tipo === "salao";
  } catch {
    return false;
  }
}

type RequisicaoComCookies = {
  cookies?: { get?: (nome: string) => { value?: string } | undefined };
};

/**
 * Sessão do Salão da requisição, ou `null`. Mesma filosofia de
 * lerSessaoAdministrativa: nunca lança, e `null` é sempre a direção segura
 * do erro.
 */
export async function lerSessaoSalao(
  req: RequisicaoComCookies | null | undefined
): Promise<{ tipo: "salao" } | null> {
  try {
    const token = req?.cookies?.get?.(SALAO_COOKIE)?.value;
    if (!token || typeof token !== "string") return null;
    const valido = await verificarTokenSalao(token);
    return valido ? { tipo: "salao" } : null;
  } catch {
    return null;
  }
}
