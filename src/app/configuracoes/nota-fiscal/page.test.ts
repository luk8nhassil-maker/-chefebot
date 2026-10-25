import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ler = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const page = ler("./page.tsx");
const settings = ler("../page.tsx");
const shell = ler("../../../components/PanelShell.tsx");

describe("Nota fiscal: autoatendimento do dono, sem liberar emissões", () => {
  it("exige sessão verificada e papel de dono no servidor", () => {
    expect(page).toContain("verifyToken(token)");
    expect(page).toContain('user.role !== "admin"');
    expect(page).toContain('redirect("/login?callbackUrl=/configuracoes/nota-fiscal")');
  });
  it("oferece cadastro pelo site oficial da WLG, nunca coleta certificados", () => {
    expect(page).toContain("https://wlgsistemas.com.br/api-emissao-nfe");
    expect(page).toContain("Cadastrar minha empresa na WLG");
    expect(page).toContain('rel="noopener noreferrer"');
    expect(page).toContain("Certificado digital A1");
    expect(page).not.toContain('type="file"');
    expect(page).not.toContain("fetch(");
  });
  it("sem prova de vínculo mantém CTA, não apresenta emissão falsa", () => {
    expect(page).toContain("Cadastro e conexão pendentes");
    expect(page).toContain("O sistema não confirmou uma empresa conectada à WLG");
    expect(page).toContain("O botão de cadastro permanecerá disponível");
    expect(page).not.toContain("Emitir NFC-e");
  });
  it("mostra Nota fiscal na sidebar Gestão somente para admin, com destaque na rota", () => {
    expect(shell).toContain('admin = JSON.parse(decoded)?.role === "admin"');
    expect(shell).toContain("{mostrarNotaFiscal && (");
    expect(shell).toContain('router.push("/configuracoes/nota-fiscal")');
    expect(shell).toContain('aria-current={onNotaFiscal ? "page" : undefined}');
    expect(shell).toContain('pathname.startsWith("/configuracoes") && !onNotaFiscal');
  });
  it("apenas dono vê acesso na tela de configurações", () => {
    expect(settings).toContain("getUserRole() === 'admin'");
    expect(settings).toContain("router.push('/configuracoes/nota-fiscal')");
  });
});
