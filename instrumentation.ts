// Hook de instrumentação do Next.js (carregado uma vez, na subida do
// servidor, tanto em `next dev` quanto em `next start`). Existe SÓ para dar
// uma prova de rede real ao E2E HTTP local (scripts/e2e-ranking-gamificacao-http.mjs
// + scripts/run-e2e-ranking-http.sh) — sem isto, a auditoria de "nenhuma
// chamada externa" dependia só de ler o código (grep) e dos guards
// explícitos de cada integração (ex.: CHEFEBOT_E2E em
// src/app/api/cliente/login/route.ts). Este arquivo torna qualquer chamada
// externa esquecida numa FALHA BARULHENTA em tempo real, não uma suposição.
//
// Só tem efeito quando CHEFEBOT_E2E === "1" — fora do E2E (produção, dev
// normal), `register()` retorna imediatamente e nada é alterado. Nunca ativo
// em produção porque essa env nunca é "1" fora do runner do E2E local.
export async function register() {
  if (process.env.CHEFEBOT_E2E !== "1") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  function hostPermitido(url: string): boolean {
    try {
      const { hostname } = new URL(url, "http://127.0.0.1");
      return hostname === "127.0.0.1" || hostname === "localhost";
    } catch {
      return false;
    }
  }

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!hostPermitido(url)) {
      throw new Error(`[CHEFEBOT_E2E] fetch bloqueado: destino não é 127.0.0.1/localhost (${url})`);
    }
    return fetchOriginal(input, init);
  }) as typeof fetch;

  console.log("[CHEFEBOT_E2E] instrumentation: fetch global restrito a 127.0.0.1/localhost para esta execução.");
}
