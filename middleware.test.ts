import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function requestFor(url: string, host: string) {
  return new NextRequest(url, {
    headers: { host },
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
