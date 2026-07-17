import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { createToken, type Role } from "@/lib/auth";

function requestFor(url: string, host: string) {
  return new NextRequest(url, {
    headers: { host },
  });
}

async function requestComRole(url: string, host: string, role: Role) {
  const token = await createToken({ username: "teste", name: "Teste", role });
  return new NextRequest(url, {
    headers: { host, cookie: `auth-token=${token}` },
  });
}

describe("middleware - rewrite chefedapizza.com.br", () => {
  it("faz rewrite de / para /cardapio quando o host é chefedapizza.com.br", async () => {
    const req = requestFor("https://chefedapizza.com.br/", "chefedapizza.com.br");
    const res = await middleware(req);

    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "https://chefedapizza.com.br/cardapio"
    );
  });

  it("preserva a query string da raiz no rewrite", async () => {
    const req = requestFor(
      "https://chefedapizza.com.br/?origem=instagram",
      "chefedapizza.com.br"
    );
    const res = await middleware(req);

    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "https://chefedapizza.com.br/cardapio?origem=instagram"
    );
  });

  it("não faz rewrite quando o host é chefebot-pjif.vercel.app", async () => {
    const req = requestFor(
      "https://chefebot-pjif.vercel.app/",
      "chefebot-pjif.vercel.app"
    );
    const res = await middleware(req);

    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("não faz rewrite para outro domínio qualquer", async () => {
    const req = requestFor("https://outrosite.com.br/", "outrosite.com.br");
    const res = await middleware(req);

    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("não faz rewrite novamente quando já está em /cardapio", async () => {
    const req = requestFor(
      "https://chefedapizza.com.br/cardapio",
      "chefedapizza.com.br"
    );
    const res = await middleware(req);

    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("usa x-forwarded-host quando presente, com fallback para host", async () => {
    const req = new NextRequest("https://internal.example/", {
      headers: {
        host: "internal.example",
        "x-forwarded-host": "chefedapizza.com.br",
      },
    });
    const res = await middleware(req);

    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "https://internal.example/cardapio"
    );
  });
});

describe("middleware - rotas administrativas protegidas", () => {
  it("redireciona para /login quando não há token", async () => {
    const req = requestFor("https://chefebot-pjif.vercel.app/admin", "chefebot-pjif.vercel.app");
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("callbackUrl=%2Fadmin");
  });

  it("redireciona /pedidos para /login sem token", async () => {
    const req = requestFor("https://chefebot-pjif.vercel.app/pedidos", "chefebot-pjif.vercel.app");
    const res = await middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("permite acesso a rotas não protegidas sem token", async () => {
    const req = requestFor("https://chefebot-pjif.vercel.app/cardapio", "chefebot-pjif.vercel.app");
    const res = await middleware(req);

    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("middleware - /financeiro e /contador protegidas", () => {
  const HOST = "chefebot-pjif.vercel.app";

  it("/financeiro sem token redireciona para /login com callbackUrl", async () => {
    const req = requestFor(`https://${HOST}/financeiro`, HOST);
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("callbackUrl=%2Ffinanceiro");
  });

  it("/contador sem token redireciona para /login com callbackUrl", async () => {
    const req = requestFor(`https://${HOST}/contador`, HOST);
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("/login");
    expect(location).toContain("callbackUrl=%2Fcontador");
  });

  it("admin acessa /financeiro, /contador e /admin", async () => {
    for (const path of ["/financeiro", "/contador", "/admin"]) {
      const req = await requestComRole(`https://${HOST}${path}`, HOST, "admin");
      const res = await middleware(req);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("dev acessa /financeiro e /contador (mesmo padrão de acesso administrativo já usado nas demais rotas)", async () => {
    for (const path of ["/financeiro", "/contador"]) {
      const req = await requestComRole(`https://${HOST}${path}`, HOST, "dev");
      const res = await middleware(req);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("financeiro acessa /financeiro mas não /contador nem /admin", async () => {
    const okReq = await requestComRole(`https://${HOST}/financeiro`, HOST, "financeiro");
    const okRes = await middleware(okReq);
    expect(okRes.headers.get("location")).toBeNull();

    const contadorReq = await requestComRole(`https://${HOST}/contador`, HOST, "financeiro");
    const contadorRes = await middleware(contadorReq);
    expect(contadorRes.status).toBe(307);
    expect(contadorRes.headers.get("location")).toContain("/login");

    const adminReq = await requestComRole(`https://${HOST}/admin`, HOST, "financeiro");
    const adminRes = await middleware(adminReq);
    expect(adminRes.status).toBe(307);
    expect(adminRes.headers.get("location")).toContain("/login");
  });

  it("contador acessa /contador mas não /financeiro nem /admin", async () => {
    const okReq = await requestComRole(`https://${HOST}/contador`, HOST, "contador");
    const okRes = await middleware(okReq);
    expect(okRes.headers.get("location")).toBeNull();

    const financeiroReq = await requestComRole(`https://${HOST}/financeiro`, HOST, "contador");
    const financeiroRes = await middleware(financeiroReq);
    expect(financeiroRes.status).toBe(307);
    expect(financeiroRes.headers.get("location")).toContain("/login");

    const adminReq = await requestComRole(`https://${HOST}/admin`, HOST, "contador");
    const adminRes = await middleware(adminReq);
    expect(adminRes.status).toBe(307);
    expect(adminRes.headers.get("location")).toContain("/login");
  });

  it("atendente não acessa /financeiro nem /contador (sem call site que justifique)", async () => {
    for (const path of ["/financeiro", "/contador"]) {
      const req = await requestComRole(`https://${HOST}${path}`, HOST, "atendente");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login");
    }
  });

  it("rewrite de chefedapizza.com.br para /cardapio continua funcionando após as mudanças", async () => {
    const req = requestFor("https://chefedapizza.com.br/", "chefedapizza.com.br");
    const res = await middleware(req);
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "https://chefedapizza.com.br/cardapio"
    );
  });

  it("/entregador continua sem proteção de middleware (risco residual documentado — ver src/lib/auth.ts)", async () => {
    // Entregadores não têm auth-token: gatear esta rota quebraria a entrega
    // de pedidos para qualquer motoboy real. Este teste apenas fixa o
    // comportamento atual (intencional) para não haver regressão silenciosa
    // em nenhuma direção.
    const req = requestFor(`https://${HOST}/entregador`, HOST);
    const res = await middleware(req);
    expect(res.headers.get("location")).toBeNull();
  });
});
