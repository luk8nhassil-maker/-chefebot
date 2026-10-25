import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ler = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const page = ler("./page.tsx");
const form = ler("./CadastroFiscalForm.tsx");
const configuracoes = ler("../page.tsx");

describe("cadastro fiscal — UI do próprio empresário, sem emissão", () => {
  it("valida autorização no servidor por token, não cookie auth-user", () => {
    expect(page).toContain("verifyToken(token)");
    expect(page).toContain('user.role !== "admin"');
    expect(page).toContain("<CadastroFiscalForm />");
  });
  it("oferece acesso pela configuração sem editar catálogo nem Pix", () => {
    expect(configuracoes).toContain('getUserRole() === \'admin\'');
    expect(configuracoes).toContain('href="/configuracoes/nota-fiscal"');
    expect(configuracoes).toContain("Cadastrar dados fiscais");
  });
  it("não informa vínculo nem emissão após salvar rascunho", () => {
    expect(form).toContain("Nenhuma nota foi emitida ou enviada à WLG.");
    expect(form).toContain("rascunho_pendente_vinculo");
    expect(form).not.toContain('fetch("/api/fiscal/nfce');
    expect(form).not.toContain("clientSecret");
  });
  it("impede envio de certificado, senhas e tokens pelo formulário", () => {
    expect(form).toContain("Não envie certificados, CSC, senhas ou tokens");
    expect(form).not.toContain('name="certificado"');
    expect(form).not.toContain('name="clientSecret"');
  });
  it("orienta o próprio empresário a cadastrar a empresa diretamente na WLG", () => {
    expect(form).toContain("O cadastro é feito pelo próprio dono da pizzaria.");
    expect(form).toContain('href="https://wlgsistemas.com.br/api-emissao-nfe"');
    expect(form).toContain('href="https://app.wlgsistemas.com.br/portal-cliente/fiscal-api/credenciais"');
    expect(form).toContain('rel="noopener noreferrer"');
    expect(form).toContain("Não compartilhe esses dados por WhatsApp");
  });
  it("não promete conexão nem emissão ao abrir links externos", () => {
    expect(form).toContain("Situação: emissão ainda bloqueada");
    expect(form).toContain("abrir a WLG não conecta os sistemas");
    expect(form).toContain("Ainda não existe uma conexão automática disponível nesta tela.");
    expect(form).not.toContain("window.localStorage.setItem");
    expect(form).not.toContain('fetch("https://fiscal.wlgsistemas.com.br');
  });
  it("não deixa operador clicar em nota fiscal sem vínculo", () => {
    expect(form).not.toContain("Emitir NFC-e");
    expect(form).not.toContain("Emitir NF");
  });
});
