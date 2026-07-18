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

const FORMATO_TOKEN_OPACO = /^[a-f0-9]{32}$/;

export function sessaoFallbackAtual(): string | null {
  try {
    const t = sessionStorage.getItem(CF_SESSAO_KEY);
    return t && FORMATO_TOKEN_OPACO.test(t) ? t : null;
  } catch {
    return null;
  }
}

export function guardarSessaoFallback(token: string): void {
  if (!FORMATO_TOKEN_OPACO.test(token)) return;
  try { sessionStorage.setItem(CF_SESSAO_KEY, token); } catch {}
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
