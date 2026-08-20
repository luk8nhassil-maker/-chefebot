import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function request(url: string) {
  const parsed = new URL(url);
  return new NextRequest(url, { headers: { host: parsed.host } });
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

  it("não redireciona rotas públicas que não pertencem ao gate operacional", async () => {
    for (const pathname of ["/pedido", "/entregador", "/login"] ) {
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
