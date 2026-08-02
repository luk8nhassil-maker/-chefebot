import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesmo padrao dos demais page.test.ts do repo (ver src/app/admin/page.test.ts,
// src/app/configuracoes/page.test.ts): sem jsdom/testing-library, requisitos
// garantidos estruturalmente na fonte.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin/salao — proteção de acesso", () => {
  test("verifica o papel do usuário (admin/dev) antes de mostrar a tela", () => {
    expect(fonte).toContain("role === 'admin' || role === 'dev'");
  });

  test("redireciona para /login quando a API responde 401", () => {
    expect(fonte).toContain("router.push('/login?callbackUrl=/admin/salao')");
  });

  test("usuário sem permissão nunca vê o formulário de código", () => {
    const semAcesso = fonte.slice(fonte.indexOf("if (!isAdmin)"), fonte.indexOf("return (\n    <PanelShell showGestaoNav>"));
    expect(semAcesso).not.toContain("salvarCodigo");
  });
});

describe("/admin/salao — o código atual nunca vem do servidor", () => {
  test("o GET de configuração só popula 'configurado' e 'atualizadoEm', nunca um campo de código", () => {
    const bloco = fonte.slice(fonte.indexOf("fetch('/api/admin/salao/config')"), fonte.indexOf("gerarCodigo()"));
    expect(bloco).toContain("data.configurado");
    expect(bloco).toContain("data.atualizadoEm");
    expect(bloco).not.toMatch(/setCodigo\(data/);
  });

  test("o código recém-salvo só existe em memória local (nunca lido de volta da API)", () => {
    expect(fonte).toContain("setCodigoRecemSalvo(valor)");
    expect(fonte).toContain("por segurança, o código não fica visível depois de recarregar a página");
  });

  test("nunca loga o código (console.log/console.error com a variável codigo)", () => {
    expect(fonte).not.toMatch(/console\.(log|info|debug|warn|error)\([^)]*codigo/i);
  });
});

describe("/admin/salao — gerar e salvar código", () => {
  test("gera o código com crypto.getRandomValues, nunca Math.random", () => {
    const bloco = fonte.slice(fonte.indexOf("function gerarCodigoAleatorio"), fonte.indexOf("function formatarData"));
    expect(bloco).toContain("crypto.getRandomValues");
    expect(bloco).not.toContain("Math.random");
  });

  test("recusa código curto antes de chamar a API", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarCodigo"), fonte.indexOf("async function copiarCodigo"));
    expect(bloco).toContain("valor.length < CODIGO_MIN_LENGTH");
  });

  test("trava de clique duplo em salvarCodigo (mesmo padrão de src/app/configuracoes/page.tsx)", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarCodigo"), fonte.indexOf("async function copiarCodigo"));
    expect(bloco).toContain("if (salvandoRef.current) return");
    expect(bloco).toContain("salvandoRef.current = true");
    expect(bloco).toContain("salvandoRef.current = false");
  });

  test("pede confirmação antes de trocar um código já configurado", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarCodigo"), fonte.indexOf("async function copiarCodigo"));
    expect(bloco).toContain("if (configurado) {");
    expect(bloco).toContain("window.confirm(");
  });

  test("botão Copiar código só aparece quando há um código recém-salvo", () => {
    expect(fonte).toContain("{codigoRecemSalvo && (");
    expect(fonte).toContain("onClick={copiarCodigo}");
  });
});

describe("/admin/salao — revogação de sessões", () => {
  test("pede confirmação antes de revogar", () => {
    const bloco = fonte.slice(fonte.indexOf("async function revogarSessoes"), fonte.indexOf("if (checking)"));
    expect(bloco).toContain("window.confirm(");
  });

  test("trava de clique duplo em revogarSessoes", () => {
    const bloco = fonte.slice(fonte.indexOf("async function revogarSessoes"), fonte.indexOf("if (checking)"));
    expect(bloco).toContain("if (revogandoRef.current) return");
    expect(bloco).toContain("revogandoRef.current = true");
    expect(bloco).toContain("revogandoRef.current = false");
  });

  test("chama exatamente /api/admin/salao/revogar", () => {
    expect(fonte).toContain("fetch('/api/admin/salao/revogar', { method: 'POST' })");
  });

  test("texto da confirmação não menciona apagar comandas, mesas ou pedidos", () => {
    const bloco = fonte.slice(fonte.indexOf("async function revogarSessoes"), fonte.indexOf("if (checking)"));
    const confirmText = bloco.match(/window\.confirm\('([^']+)'\)/)?.[1] ?? "";
    expect(confirmText.toLowerCase()).toContain("comandas e pedidos não são afetados");
  });
});

describe("/admin/salao — abrir login do salão", () => {
  test("aponta para https://chefedapizza.com.br/salao/login em nova aba", () => {
    expect(fonte).toContain("const SALAO_LOGIN_URL = 'https://chefedapizza.com.br/salao/login'");
    expect(fonte).toContain('target="_blank"');
    expect(fonte).toContain('rel="noopener noreferrer"');
  });
});

describe("/admin/salao — usa PanelShell com o grupo Gestão/Equipe", () => {
  test("renderiza dentro de <PanelShell showGestaoNav>", () => {
    expect(fonte).toContain("<PanelShell showGestaoNav>");
  });
});
