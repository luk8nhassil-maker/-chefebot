import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PanelShell from "@/components/PanelShell";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WLG_CADASTRO = "https://wlgsistemas.com.br/api-emissao-nfe";
const WLG_FISCAL_API = "https://app.wlgsistemas.com.br/portal-cliente/fiscal-api/credenciais";

/**
 * Etapa de autoatendimento: NÃO representa vínculo fiscal nem emite NFC-e.
 * Não temos ainda tenantId assinado, credenciais da WLG ou emissor homologado.
 * Por isso, não aceitar confirmação só por clique, cookie ou dado do cliente.
 * O CTA só poderá ser substituído por status 'habilitado' quando existir
 * integração de consulta autenticada ao emissor para esta empresa.
 */
export default async function NotaFiscalCadastroProprio() {
  const token = (await cookies()).get("auth-token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) redirect("/login?callbackUrl=/configuracoes/nota-fiscal");
  if (user.role !== "admin") redirect("/configuracoes");

  return (
    <PanelShell showGestaoNav>
      <main style={{ minHeight: "100vh", padding: "24px 16px 64px", fontFamily: "'Archivo', sans-serif", color: "var(--foreground)" }}>
        <div style={{ maxWidth: 710, margin: "0 auto", display: "grid", gap: 18 }}>
          <Link href="/configuracoes" style={{ fontSize: 14, color: "var(--foreground-secondary)", textDecoration: "none" }}>
            ← Voltar às configurações
          </Link>
          <header style={{ display: "grid", gap: 7 }}>
            <h1 style={{ fontSize: "clamp(24px, 5vw, 30px)", fontWeight: 900, margin: 0 }}>Nota fiscal da pizzaria</h1>
            <p style={{ color: "var(--foreground-secondary)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              Você mesmo cadastra sua empresa na WLG. Não precisa enviar documentos nem senhas ao ChefeBot ou ao desenvolvedor.
            </p>
          </header>
          <section aria-label="Situação da nota fiscal" style={{ border: "1px solid var(--border)", borderRadius: 16,
            padding: "17px 18px", background: "var(--surface)", display: "grid", gap: 6 }}>
            <strong style={{ fontSize: 14 }}>Cadastro e conexão pendentes</strong>
            <p style={{ color: "var(--foreground-secondary)", lineHeight: 1.6, fontSize: 13, margin: 0 }}>
              A emissão pelo ChefeBot ainda não está liberada. O sistema não confirmou uma empresa conectada à WLG.
              Clicar no cadastro não significa que a empresa foi habilitada.
            </p>
          </section>
          <section aria-labelledby="wlg-documentos" style={{ border: "1px solid var(--border)", borderRadius: 16,
            padding: "22px 18px", background: "var(--surface)", display: "grid", gap: 14 }}>
            <div>
              <h2 id="wlg-documentos" style={{ fontSize: 19, fontWeight: 900, margin: "0 0 6px" }}>O que você precisa ter em mãos</h2>
              <p style={{ fontSize: 13, color: "var(--foreground-secondary)", margin: 0, lineHeight: 1.5 }}>
                Peça ajuda ao seu contador caso não saiba algum dado fiscal.
              </p>
            </div>
            <ul style={{ paddingLeft: 22, margin: 0, display: "grid", gap: 10, lineHeight: 1.55, fontSize: 14 }}>
              <li><strong>CNPJ</strong> e razão social da pizzaria.</li>
              <li><strong>Inscrição estadual</strong> e regime tributário, conforme sua empresa.</li>
              <li><strong>Certificado digital A1</strong> e informações exigidas pela SEFAZ para NFC-e, com orientação do contador.</li>
              <li><strong>E-mail e telefone</strong> para criar e acessar sua conta na WLG.</li>
              <li><strong>Dados fiscais dos produtos</strong>, com orientação do contador.</li>
            </ul>
            <a href={WLG_CADASTRO} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", padding: "16px 18px", borderRadius: 12, background: "var(--primary)",
                color: "var(--primary-foreground)", textAlign: "center", textDecoration: "none", fontWeight: 900,
                fontSize: 15, minHeight: 52, boxSizing: "border-box" }}>
              Cadastrar minha empresa na WLG ↗
            </a>
            <p style={{ fontSize: 12, color: "var(--foreground-secondary)", margin: 0, lineHeight: 1.6 }}>
              O cadastro abre no site oficial da WLG. Use o botão “Criar conta gratuita” nessa página.
              O certificado e os dados fiscais devem ser configurados na WLG, não neste formulário.
            </p>
          </section>
          <section aria-labelledby="wlg-depois" style={{ border: "1px solid var(--border)", borderRadius: 16,
            padding: "20px 18px", background: "var(--surface)", display: "grid", gap: 10 }}>
            <h2 id="wlg-depois" style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>Já me cadastrei. E agora?</h2>
            <p style={{ color: "var(--foreground-secondary)", margin: 0, fontSize: 13, lineHeight: 1.6 }}>
              Na sua conta WLG, configure a empresa e abra a área Fiscal API. Guarde suas credenciais em segurança.
              O ChefeBot ainda precisa oferecer uma conexão protegida antes de liberar notas automaticamente.
            </p>
            <a href={WLG_FISCAL_API} target="_blank" rel="noopener noreferrer"
              style={{ color: "var(--foreground)", fontSize: 13, fontWeight: 800, textUnderlineOffset: 3 }}>
              Abrir Fiscal API na WLG ↗
            </a>
            <p style={{ fontSize: 12, color: "var(--foreground-secondary)", lineHeight: 1.6, margin: 0 }}>
              Não envie certificado, senha, CSC, ClientSecret ou outras credenciais por WhatsApp, e-mail ou chat.
              O botão de cadastro permanecerá disponível até a conexão ser confirmada com segurança pelo servidor.
            </p>
          </section>
        </div>
      </main>
    </PanelShell>
  );
}
