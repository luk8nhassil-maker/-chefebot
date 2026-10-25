import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PanelShell from "@/components/PanelShell";
import { verifyToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WLG_CADASTRO = "https://wlgsistemas.com.br/api-emissao-nfe";
const WLG_FISCAL_API = "https://app.wlgsistemas.com.br/portal-cliente/fiscal-api/credenciais";

// Esta tela apenas orienta. Não cria empresa, não salva credenciais e não emite notas.
// O status não deve ser alterado por clique, cookie ou declaração do navegador.
const cardStyle = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: "20px 18px",
  background: "var(--surface)",
  display: "grid",
  gap: 12,
} as const;

const mutedStyle = {
  color: "var(--foreground-secondary)",
  fontSize: 13,
  lineHeight: 1.6,
  margin: 0,
} as const;

function Etapa({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return (
    <section aria-label={`Etapa ${numero}: ${titulo}`} style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span aria-hidden="true" style={{
          width: 30, height: 30, borderRadius: 9,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--background)", border: "1px solid var(--border)",
          fontSize: 13, fontWeight: 900, flexShrink: 0,
        }}>{numero}</span>
        <h2 style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

export default async function NotaFiscalCadastroProprio() {
  const token = (await cookies()).get("auth-token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) redirect("/login?callbackUrl=/configuracoes/nota-fiscal");
  if (user.role !== "admin") redirect("/configuracoes");

  return (
    <PanelShell showGestaoNav>
      <main style={{
        minHeight: "100vh", padding: "24px 16px 64px",
        fontFamily: "'Archivo', sans-serif", color: "var(--foreground)",
      }}>
        <div style={{ maxWidth: 710, margin: "0 auto", display: "grid", gap: 14 }}>
          <Link href="/configuracoes" style={{
            fontSize: 13, color: "var(--foreground-secondary)", textDecoration: "none",
          }}>
            ← Voltar às configurações
          </Link>

          <header style={{ display: "grid", gap: 5, marginBottom: 2 }}>
            <h1 style={{ fontSize: "clamp(24px, 5vw, 30px)", fontWeight: 900, margin: 0 }}>
              Nota fiscal da pizzaria
            </h1>
            <p style={{ ...mutedStyle, fontSize: 14 }}>
              Prepare o cadastro da sua empresa. A emissão pelo ChefeBot ainda não está disponível.
            </p>
          </header>

          <section aria-label="Situação da nota fiscal" style={{
            border: "1px solid var(--border)", borderRadius: 14,
            padding: "14px 18px", background: "var(--surface)",
            display: "grid", gap: 5,
          }}>
            <strong style={{ fontSize: 13 }}>Cadastro e conexão pendentes</strong>
            <p style={mutedStyle}>
              O sistema não confirmou uma empresa conectada à WLG.
              O cadastro no site da WLG não ativa a emissão de notas pelo ChefeBot.
            </p>
          </section>

          <Etapa numero={1} titulo="Cadastre sua empresa na WLG">
            <p style={mutedStyle}>Crie sua conta e cadastre a pizzaria no site oficial da WLG.</p>
            <a href={WLG_CADASTRO} target="_blank" rel="noopener noreferrer" style={{
              display: "block", padding: "15px 18px", borderRadius: 11,
              background: "var(--primary)", color: "var(--primary-foreground)",
              textAlign: "center", textDecoration: "none", fontWeight: 900,
              fontSize: 15, minHeight: 50, boxSizing: "border-box",
            }}>
              Começar cadastro na WLG ↗
            </a>
            <p style={{ ...mutedStyle, fontSize: 12 }}>
              Na página da WLG, selecione “Criar conta gratuita”.
            </p>
          </Etapa>

          <Etapa numero={2} titulo="Separe os dados necessários">
            <p style={mutedStyle}>Tenha em mãos, com a ajuda do contador:</p>
            <ul style={{
              paddingLeft: 20, margin: 0, display: "grid", gap: 6,
              fontSize: 13, lineHeight: 1.6,
            }}>
              <li><strong>CNPJ</strong> e razão social.</li>
              <li><strong>Inscrição estadual</strong> e regime tributário.</li>
              <li><strong>Certificado digital A1</strong> e dados exigidos pela SEFAZ para NFC-e.</li>
              <li><strong>E-mail e telefone</strong> de contato.</li>
              <li><strong>Dados fiscais dos produtos</strong> orientados pelo contador.</li>
            </ul>
          </Etapa>

          <Etapa numero={3} titulo="Depois do cadastro">
            <p style={mutedStyle}>
              Finalize a configuração fiscal da sua empresa na WLG e abra a área Fiscal API.
            </p>
            <a href={WLG_FISCAL_API} target="_blank" rel="noopener noreferrer" style={{
              color: "var(--foreground)", fontSize: 13,
              fontWeight: 800, textUnderlineOffset: 3, width: "fit-content",
            }}>
              Abrir Fiscal API na WLG ↗
            </a>
            <p style={{ ...mutedStyle, fontSize: 12 }}>
              A conexão segura com o ChefeBot ainda será disponibilizada.
              O botão de cadastro permanecerá disponível até a conexão ser confirmada com segurança pelo servidor.
            </p>
          </Etapa>

          <aside aria-label="Segurança do cadastro fiscal" style={{
            borderTop: "1px solid var(--border)",
            padding: "14px 2px 0", display: "grid", gap: 5,
          }}>
            <strong style={{ fontSize: 13 }}>Sua segurança</strong>
            <p style={{ ...mutedStyle, fontSize: 12 }}>
              Não envie certificado, senha, CSC, ClientSecret ou outras credenciais
              por WhatsApp, e-mail ou chat. Configure esses dados diretamente na WLG.
            </p>
          </aside>
        </div>
      </main>
    </PanelShell>
  );
}
