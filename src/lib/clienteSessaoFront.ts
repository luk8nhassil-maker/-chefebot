// Sessão da área do cliente no NAVEGADOR — ordem de resolução determinística:
// 1) token EM MEMÓRIA passado explicitamente (recém-criado pelo verificar —
//    funciona mesmo se sessionStorage estiver bloqueado);
// 2) token do sessionStorage (sobrevive a navegação/refresh na aba);
// 3) cookie HttpOnly (o navegador envia sozinho; navegadores saudáveis).
// O token é uma sessão portátil (JWE cifrado no servidor) — ilegível sem a
// chave do servidor, nunca expõe telefone/nome/clienteId em texto claro,
// então pode viver em sessionStorage sem expor PII. Formatos aceitos:
// portátil (JWE compacto, 5 partes separadas por ".") e, por compatibilidade
// com sessões emitidas antes desta mudança, o token opaco legado (32 hex).

export const CF_SESSAO_KEY = "cf_sessao";

// Marcador curto da versão do bundle (diagnóstico do Perfil 3.0): aparece na
// telemetria para provar qual código o aparelho executou. Sem PII.
export const VERSAO_PERFIL3 = "p3d6";

// Telemetria temporária best-effort — só slugs/booleans/trace da allowlist do
// backend; nunca envia OTP, telefone, tokens, cookies ou nome.
export function telemetria(evt: string, extra?: { ok?: boolean; motivo?: string; trace?: string | null; status?: number }): void {
  try {
    fetch("/api/cliente/telemetria", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evt, v: VERSAO_PERFIL3, ...extra, trace: extra?.trace ?? undefined }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

const FORMATO_TOKEN_OPACO = /^[a-f0-9]{32}$/;
const FORMATO_SESSAO_PORTATIL = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function formatoSessaoValido(t: string): boolean {
  return FORMATO_SESSAO_PORTATIL.test(t) || FORMATO_TOKEN_OPACO.test(t);
}

export function sessaoFallbackAtual(): string | null {
  try {
    const t = sessionStorage.getItem(CF_SESSAO_KEY);
    return t && formatoSessaoValido(t) ? t : null;
  } catch {
    return null;
  }
}

// Retorna se o token realmente ficou legível no storage — sessionStorage
// pode falhar silenciosamente em navegadores restritos. Uma falha aqui NUNCA
// interrompe o fluxo: o chamador continua com o token em memória.
export function guardarSessaoFallback(token: string): boolean {
  if (!formatoSessaoValido(token)) return false;
  try {
    sessionStorage.setItem(CF_SESSAO_KEY, token);
    return sessionStorage.getItem(CF_SESSAO_KEY) === token;
  } catch {
    return false;
  }
}

export function limparSessaoFallback(): void {
  try { sessionStorage.removeItem(CF_SESSAO_KEY); } catch {}
}

// fetch da área do cliente. `tokenEmMemoria` (opcional) tem prioridade sobre
// o storage; sem nenhum token, é um fetch normal (cookie do navegador).
export function fetchCliente(input: string, init?: RequestInit, tokenEmMemoria?: string | null): Promise<Response> {
  const token =
    tokenEmMemoria && formatoSessaoValido(tokenEmMemoria) ? tokenEmMemoria : sessaoFallbackAtual();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
