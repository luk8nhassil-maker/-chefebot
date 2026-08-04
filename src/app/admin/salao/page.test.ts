import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mesmo padrao dos demais page.test.ts do repo (ver src/app/admin/page.test.ts,
// src/app/configuracoes/page.test.ts): sem jsdom/testing-library, requisitos
// garantidos estruturalmente na fonte.
const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("/admin/salao — proteção de acesso", () => {
  // A autorização é sempre decidida pelo servidor (lerSessaoAdministrativa +
  // admin/dev em /api/admin/salao/config) — a página não faz uma segunda
  // checagem de papel no cliente (isso exigiria ler cookie durante a
  // renderização, arriscando mismatch de hidratação SSR/CSR). Um 401 real
  // da API é a única coisa que decide "sem permissão" aqui.
  test("não lê o papel do usuário a partir de cookie no cliente", () => {
    expect(fonte).not.toContain("document.cookie");
    expect(fonte).not.toContain("getUserRole");
  });

  test("redireciona para /login quando a API responde 401", () => {
    expect(fonte).toContain("router.push('/login?callbackUrl=/admin/salao')");
  });

  test("nenhum setState síncrono direto no corpo do efeito (sem cascading render) — só dentro de callbacks assíncronos", () => {
    const efeito = fonte.slice(fonte.indexOf("useEffect(() => {"), fonte.indexOf("}, [router])"));
    const linhas = efeito.split("\n").map((l) => l.trim());
    const idxFetch = linhas.findIndex((l) => l.startsWith("fetch("));
    const antesDoFetch = linhas.slice(0, idxFetch === -1 ? linhas.length : idxFetch);
    expect(antesDoFetch.some((l) => /^set[A-Z]\w*\(/.test(l))).toBe(false);
  });
});

describe("/admin/salao — sem bloqueio de código, só o WhatsApp do atendimento", () => {
  test("não existe mais nenhuma referência a código de acesso do terminal", () => {
    expect(fonte).not.toMatch(/código de acesso/i);
    expect(fonte).not.toContain("gerarCodigoAleatorio");
    expect(fonte).not.toContain("CODIGO_MIN_LENGTH");
  });

  test("carrega o WhatsApp configurado a partir da API", () => {
    const bloco = fonte.slice(fonte.indexOf("fetch('/api/admin/salao/config')"), fonte.indexOf("salvarWhatsapp"));
    expect(bloco).toContain("data.configurado");
    expect(bloco).toContain("data.atualizadoEm");
    expect(bloco).toContain("data.whatsappAtendimento");
  });

  test("trava de clique duplo em salvarWhatsapp (mesmo padrão de src/app/configuracoes/page.tsx)", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarWhatsapp"), fonte.indexOf("return ("));
    expect(bloco).toContain("if (salvandoRef.current) return");
    expect(bloco).toContain("salvandoRef.current = true");
    expect(bloco).toContain("salvandoRef.current = false");
  });

  test("envia whatsappAtendimento para /api/admin/salao/config", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarWhatsapp"), fonte.indexOf("return ("));
    expect(bloco).toContain("method: 'POST'");
    expect(bloco).toContain("whatsappAtendimento: whatsapp");
  });

  test("mostra se o link do terminal foi enviado por mensagem ou não", () => {
    const bloco = fonte.slice(fonte.indexOf("async function salvarWhatsapp"), fonte.indexOf("return ("));
    expect(bloco).toContain("data.linkEnviado");
    expect(bloco).toContain("terminal enviado por mensagem");
    expect(bloco).toContain("não foi possível enviar o link por mensagem");
  });
});

describe("/admin/salao — abrir terminal do salão", () => {
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
