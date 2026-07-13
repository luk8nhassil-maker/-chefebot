import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Sem testing-library/jsdom neste repo (ver ClientBottomNav.test.tsx e os demais
// page.test.ts): a tela /admin e um client component pesado (auth por cookie,
// varias chamadas no mount, next/navigation), inviavel de montar em teste. Os
// requisitos do toggle "Ativar/Desativar Pix automatico" (Nivel 5.8) sao
// garantidos estruturalmente na fonte — evita que o wiring do `enabled` volte a
// se perder, que foi exatamente a causa do pedido cair no Pix manual.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin — ativar/desativar Pix automatico Mercado Pago", () => {
  test("salvar token continua funcionando e nao envia enabled (fluxo independente)", () => {
    // O botao de salvar segue existindo e o corpo do salvar mantem apenas
    // token + e-mail fallback — salvar nao ativa a integracao por si so.
    expect(fonte).toContain("const salvarMercadoPago = async");
    expect(fonte).toContain("Salvar configuracao");
    const corpoSalvar = fonte.slice(
      fonte.indexOf("const salvarMercadoPago = async"),
      fonte.indexOf("const testarMercadoPago = async")
    );
    expect(corpoSalvar).toContain("accessToken: mpToken");
    expect(corpoSalvar).toContain("payerEmailFallback: mpPayerEmail");
    expect(corpoSalvar).not.toContain("enabled");
  });

  test("o handler de ativar/desativar envia SOMENTE { enabled } via PUT, preservando o token", () => {
    expect(fonte).toContain("const alternarPixAutomatico = async (ativar: boolean)");
    const corpoToggle = fonte.slice(
      fonte.indexOf("const alternarPixAutomatico = async"),
      fonte.indexOf("const pedidosFiltrados =")
    );
    expect(corpoToggle).toContain("'/api/admin/integracoes/mercadopago'");
    expect(corpoToggle).toContain("method: 'PUT'");
    expect(corpoToggle).toContain("body: JSON.stringify({ enabled: ativar })");
    // Nao reenvia token nem e-mail ao apenas alternar o estado.
    expect(corpoToggle).not.toContain("accessToken");
    expect(corpoToggle).not.toContain("clearToken");
  });

  test("botao 'Ativar Pix automatico' chama o handler com true", () => {
    expect(fonte).toContain("Ativar Pix automatico");
    expect(fonte).toContain("alternarPixAutomatico(true)");
  });

  test("botao 'Desativar Pix automatico' chama o handler com false", () => {
    expect(fonte).toContain("Desativar Pix automatico");
    expect(fonte).toContain("alternarPixAutomatico(false)");
  });

  test("estado visual do Pix automatico reflete mpConfig.enabled (Ativo/Inativo)", () => {
    // Rotulo de estado e alternancia de botao dependem de enabled real.
    expect(fonte).toMatch(/mpConfig\?\.enabled \? 'Ativo' : 'Inativo'/);
    expect(fonte).toMatch(/mpConfig\?\.enabled \? \(/);
  });

  test("sem token configurado, o botao ativar fica desabilitado, com aviso e guarda no handler", () => {
    // Botao ativar bloqueado quando nao ha token salvo.
    expect(fonte).toContain("disabled={mpToggling || !mpConfig?.configured}");
    // Aviso claro na UI.
    expect(fonte).toContain("Configure e salve o token do Mercado Pago para poder ativar o Pix automatico.");
    // Guarda defensiva no handler (nao ativa sem token mesmo se chamado).
    expect(fonte).toContain("if (ativar && !mpConfig?.configured)");
  });
});
