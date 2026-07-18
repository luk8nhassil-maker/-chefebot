// Sessão da área do cliente no NAVEGADOR — ordem de resolução determinística:
// 1) token EM MEMÓRIA passado explicitamente (recém-criado pelo verificar —
//    funciona mesmo se sessionStorage estiver bloqueado);
// 2) token opaco do sessionStorage (sobrevive a navegação/refresh na aba);
// 3) cookie HttpOnly (o navegador envia sozinho; navegadores saudáveis).
// O token opaco é aleatório e resolvido no Redis — nunca contém telefone,
// nome ou clienteId, então pode viver em sessionStorage sem expor PII.

export const CF_SESSAO_KEY = "cf_sessao";

// Marcador curto da versão do bundle (diagnóstico do Perfil 3.0): aparece na
// telemetria para provar qual código o aparelho executou. Sem PII.
export const VERSAO_PERFIL3 = "p3d4";

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

export function sessaoFallbackAtual(): string | null {
  try {
    const t = sessionStorage.getItem(CF_SESSAO_KEY);
    return t && FORMATO_TOKEN_OPACO.test(t) ? t : null;
  } catch {
    return null;
  }
}

// Retorna se o token realmente ficou legível no storage — sessionStorage
// pode falhar silenciosamente em navegadores restritos. Uma falha aqui NUNCA
// interrompe o fluxo: o chamador continua com o token em memória.
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

// fetch da área do cliente. `tokenEmMemoria` (opcional) tem prioridade sobre
// o storage; sem nenhum token, é um fetch normal (cookie do navegador).
export function fetchCliente(input: string, init?: RequestInit, tokenEmMemoria?: string | null): Promise<Response> {
  const token =
    tokenEmMemoria && FORMATO_TOKEN_OPACO.test(tokenEmMemoria) ? tokenEmMemoria : sessaoFallbackAtual();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
