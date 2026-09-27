import { afterEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";
import { VERCEL_PROJECTS_CHEFEBOT_LEGADOS, VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "./lib/vercelProjeto";

afterEach(() => {
  vi.unstubAllEnvs();
});

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, init);
}

describe("proxy — login canônico do ChefeBot", () => {
  test("alias legado conhecido redireciona /login para o domínio oficial preservando callback", async () => {
    vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL);

    const res = await proxy(req("https://chefebot-pjif.vercel.app/login?callbackUrl=%2Fadmin"));

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://chefedapizza.com.br/login?callbackUrl=%2Fadmin");
  });

  test("API de autenticação também é redirecionada antes de validar credenciais no legado", async () => {
    vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL);

    const res = await proxy(req("https://chefebot-pjif.vercel.app/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "usuario", password: "segredo-nao-real" }),
    }));

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://chefedapizza.com.br/api/auth/login");
  });

  test("deployment com project id legado redireciona mesmo usando hostname efêmero", async () => {
    vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECTS_CHEFEBOT_LEGADOS[1]);

    const res = await proxy(req("https://deployment-antigo.vercel.app/login"));

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://chefedapizza.com.br/login");
  });

  test("domínio oficial permanece no fluxo normal de login", async () => {
    vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL);

    const res = await proxy(req("https://chefedapizza.com.br/login"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
