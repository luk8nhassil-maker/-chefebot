import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function request(url: string, method = "GET") {
  const parsed = new URL(url);
  return new NextRequest(url, { method, headers: { host: parsed.host } });
}

describe("middleware — alias operacional do ChefeBot", () => {
  it("manda /pedidos do alias de produção para o domínio oficial preservando query", async () => {
    const response = await middleware(request("https://chefebot-pjif.vercel.app/pedidos?filtro=fazendo"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://chefedapizza.com.br/pedidos?filtro=fazendo");
  });

  it("fecha também as outras rotas cobertas pelo gate de assinatura", async () => {
    for (const pathname of ["/conversas", "/cardapio", "/admin", "/financeiro", "/contador", "/configuracoes", "/relatorios", "/integracoes", "/setup", "/dev"]) {
      const response = await middleware(request(`https://chefebot-pjif.vercel.app${pathname}`));
      expect(response.status, pathname).toBe(308);
      expect(response.headers.get("location"), pathname).toBe(`https://chefedapizza.com.br${pathname}`);
    }
  });

  it("bloqueia criação direta de pedido pelo alias legado", async () => {
    const response = await middleware(request("https://chefebot-pjif.vercel.app/api/pedido-app", "POST"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(body).toMatchObject({
      ok: false,
      code: "PEDIDOS_TEMPORARIAMENTE_INDISPONIVEIS",
    });
  });

  it("não aplica o guard do alias à API do domínio oficial", async () => {
    const response = await middleware(request("https://chefedapizza.com.br/api/pedido-app", "POST"));
    expect(response.status).toBe(200);
  });

  it("não redireciona rotas públicas que não pertencem ao gate operacional", async () => {
    for (const pathname of ["/pedido", "/entregador", "/login"]) {
      const response = await middleware(request(`https://chefebot-pjif.vercel.app${pathname}`));
      expect(response.status, pathname).toBe(200);
      expect(response.headers.get("location"), pathname).toBeNull();
    }
  });

  it("não trata Preview Vercel como alias de produção", async () => {
    const response = await middleware(request("https://chefebot-git-fix-exemplo.vercel.app/pedidos"));
    expect(response.status).not.toBe(308);
    expect(response.headers.get("location")).not.toBe("https://chefedapizza.com.br/pedidos");
  });
});
