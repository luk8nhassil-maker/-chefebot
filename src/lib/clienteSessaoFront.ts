// Sessão da área do cliente no NAVEGADOR: o caminho principal é o cookie
// HttpOnly (o browser envia sozinho). O fallback existe para navegadores que
// comprovadamente não aplicam Set-Cookie (navegador interno do WhatsApp no
// iPhone — provado em produção nas duas tentativas de hotfix): um token de
// sessão OPACO (aleatório, resolvido no Redis, SEM nenhum dado do cliente —
// nunca contém telefone, nome ou clienteId) guardado em sessionStorage e
// enviado via Authorization: Bearer. O front só grava esse token depois de
// comprovar que o cookie não funcionou; em navegadores normais nada é
// guardado.

export const CF_SESSAO_KEY = "cf_sessao";

// Marcador curto da versão do bundle (diagnóstico do Perfil 3.0): aparece na
// telemetria para provar qual código o aparelho executou. Sem PII.
export const VERSAO_PERFIL3 = "p3h3";

// Telemetria temporária best-effort — só slugs/booleans da allowlist do
// backend; nunca envia OTP, telefone, tokens, cookies ou nome.
export function telemetria(evt: string, extra?: { ok?: boolean; motivo?: string }): void {
  try {
    fetch("/api/cliente/telemetria", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evt, v: VERSAO_PERFIL3, ...extra }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

const FORMATO_TOKEN_OPACO = /^[a-f0-9]{32}$/;

export function sessaoFallbackAtual(): string | null {
  try {
    const t = sessionStorage.getItem(CF_SESSAO_KEY);
    return t && FORMATO_TOKEN_OPACO.test(t) ? t : null;
  } catch {
    return null;
  }
}

// Retorna se o token realmente ficou legível no storage — sessionStorage
// pode falhar silenciosamente em navegadores restritos.
export function guardarSessaoFallback(token: string): boolean {
  if (!FORMATO_TOKEN_OPACO.test(token)) return false;
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

// fetch da área do cliente: injeta o Bearer do fallback quando ele existir.
// Sem fallback gravado, é um fetch normal (cookie do navegador).
export function fetchCliente(input: string, init?: RequestInit): Promise<Response> {
  const token = sessaoFallbackAtual();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
