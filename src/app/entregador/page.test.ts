import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

describe("/entregador — autenticação e sessão", () => {
  it("troca o ticket e limpa o segredo da URL", () => {
    expect(fonte).toContain("window.location.hash.slice(1)");
    expect(fonte).toContain("fragmento.get('acesso')");
    expect(fonte).toContain("window.history.replaceState");
    expect(fonte).toContain("/api/entregador/auth/trocar-acesso");
    expect(fonte).toContain("router.replace('/entregador')");
    expect(fonte.indexOf("window.history.replaceState")).toBeLessThan(
      fonte.indexOf("fetch('/api/entregador/auth/trocar-acesso'")
    );
    expect(fonte).not.toContain("params.get('acesso')");
    expect(fonte).not.toContain("localStorage");
    expect(fonte).not.toContain("sessionStorage");
  });

  it("não autentica silenciosamente links transitórios com acesso na query", () => {
    expect(fonte).toContain("params.has('acesso')");
    expect(fonte).toContain("Este acesso é inválido. Solicite um novo link seguro");
  });

  it("sessão válida carrega me e pedidos sem entregadorId", () => {
    expect(fonte).toContain("/api/entregador/auth/me");
    expect(fonte).toContain("fetch('/api/entregador-pedidos'");
    expect(fonte).not.toContain("/api/entregador-pedidos?entregadorId=");
  });

  it("ações e localização enviam somente os campos operacionais", () => {
    expect(fonte).toContain("JSON.stringify({ pedidoId, acao })");
    expect(fonte).toMatch(/JSON\.stringify\(\{\s*pedidoId,\s*lat:/);
    expect(fonte).not.toMatch(/JSON\.stringify\(\{[^}]*entregadorId[^}]*pedidoId/);
  });

  it("link antigo não concede acesso e só oferece reenvio controlado", () => {
    expect(fonte).toContain("params.get('id')");
    expect(fonte).toContain("Este link precisa ser atualizado.");
    expect(fonte).toContain("/api/entregador/auth/reenviar-acesso");
    expect(fonte).not.toContain("Código do entregador");
    expect(fonte).not.toMatch(/const \[entregadorId,\s*setEntregadorId\]/);
  });

  it("logout apaga a sessão no servidor", () => {
    expect(fonte).toContain("/api/entregador/auth/logout");
    expect(fonte).toContain("method: 'POST'");
    expect(fonte).toContain(">Sair</button>");
  });
});
