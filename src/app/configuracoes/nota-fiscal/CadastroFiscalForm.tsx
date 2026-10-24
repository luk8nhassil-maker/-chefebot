"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PanelShell from "@/components/PanelShell";

type Campos = {
  cnpj: string; razaoSocial: string; nomeFantasia: string;
  inscricaoEstadual: string; uf: string; municipio: string;
  regimeTributario: string; declaracaoResponsavel: boolean;
};
const VAZIO: Campos = {
  cnpj: "", razaoSocial: "", nomeFantasia: "", inscricaoEstadual: "",
  uf: "", municipio: "", regimeTributario: "nao_informado",
  declaracaoResponsavel: false,
};
const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const entrada: React.CSSProperties = {
  width: "100%", minHeight: 46, padding: "10px 12px",
  border: "1px solid var(--border)", borderRadius: 10,
  background: "var(--background)", color: "var(--foreground)",
  fontSize: 15, boxSizing: "border-box", fontFamily: "inherit",
};
const legenda: React.CSSProperties = {
  display: "block", marginBottom: 7, fontSize: 13,
  fontWeight: 700, color: "var(--foreground-secondary)",
};
const campo: React.CSSProperties = { display: "block", minWidth: 0 };

function Field({ id, title, value, onChange, placeholder, maxLength, required = false }: {
  id: keyof Campos; title: string; value: string; onChange: (v: string) => void;
  placeholder?: string; maxLength?: number; required?: boolean;
}) {
  return (
    <label style={campo}>
      <span style={legenda}>{title}{required ? " *" : ""}</span>
      <input
        name={id} autoComplete="off" style={entrada} value={value}
        placeholder={placeholder} maxLength={maxLength}
        required={required} onChange={e => onChange(e.currentTarget.value)}
      />
    </label>
  );
}

export default function CadastroFiscalForm() {
  const [campos, setCampos] = useState<Campos>(VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [situacao, setSituacao] = useState<"nao_iniciado" | "rascunho_pendente_vinculo">("nao_iniciado");
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const salvandoRef = useRef(false);
  const atualizar = <K extends keyof Campos>(chave: K, valor: Campos[K]) => {
    setCampos(old => ({ ...old, [chave]: valor }));
  };

  useEffect(() => {
    let ativo = true;
    fetch("/api/fiscal/cadastro", { cache: "no-store" })
      .then(async response => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Não foi possível carregar.");
        return json;
      })
      .then(json => {
        if (!ativo) return;
        if (json.cadastro) {
          setCampos({
            cnpj: json.cadastro.cnpj || "",
            razaoSocial: json.cadastro.razaoSocial || "",
            nomeFantasia: json.cadastro.nomeFantasia || "",
            inscricaoEstadual: json.cadastro.inscricaoEstadual || "",
            uf: json.cadastro.uf || "",
            municipio: json.cadastro.municipio || "",
            regimeTributario: json.cadastro.regimeTributario || "nao_informado",
            declaracaoResponsavel: json.cadastro.declaracaoResponsavel === true,
          });
          setSituacao("rascunho_pendente_vinculo");
        }
      })
      .catch(e => { if (ativo) setErro(e instanceof Error ? e.message : "Cadastro indisponível."); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, []);

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (salvandoRef.current) return;
    salvandoRef.current = true;
    setSalvando(true); setErro(""); setMensagem("");
    try {
      const resp = await fetch("/api/fiscal/cadastro", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos), cache: "no-store",
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || "Não foi possível salvar.");
      setSituacao("rascunho_pendente_vinculo");
      setMensagem("Dados guardados como rascunho. Nenhuma nota foi emitida ou enviada à WLG.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      salvandoRef.current = false; setSalvando(false);
    }
  }

  return (
    <PanelShell showGestaoNav>
      <main style={{ padding: "24px 16px 60px", color: "var(--foreground)", minHeight: "100vh", fontFamily: "'Archivo', sans-serif" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 18 }}>
          <Link href="/configuracoes" style={{ color: "var(--foreground-secondary)", fontSize: 14, textDecoration: "none" }}>
            ← Voltar às configurações
          </Link>
          <div>
            <h1 style={{ fontSize: "clamp(24px, 5vw, 32px)", margin: "0 0 8px", fontWeight: 900 }}>Nota fiscal da sua empresa</h1>
            <p style={{ color: "var(--foreground-secondary)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              Cadastre os dados da sua pizzaria para preparar a futura emissão de NFC-e pelo ChefeBot.
            </p>
          </div>
          <div role="status" style={{
            padding: 17, borderRadius: 14, border: "1px solid var(--border)",
            background: "var(--surface)", display: "grid", gap: 7,
          }}>
            <strong style={{ fontSize: 14 }}>
              {situacao === "rascunho_pendente_vinculo" ? "Cadastro salvo, aguardando conexão" : "Emissão de notas ainda não disponível"}
            </strong>
            <p style={{ margin: 0, color: "var(--foreground-secondary)", lineHeight: 1.55, fontSize: 13 }}>
              Esta etapa salva apenas um rascunho dos dados informados. Ainda não cadastra sua empresa na WLG,
              não valida impostos nem autoriza a emissão de nota fiscal.
            </p>
          </div>
          <form onSubmit={salvar} style={{
            border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 16,
            padding: "20px 18px", display: "grid", gap: 17,
          }}>
            <div>
              <h2 style={{ fontSize: 17, margin: "0 0 6px" }}>Dados da empresa</h2>
              <p style={{ fontSize: 12, margin: 0, color: "var(--foreground-secondary)" }}>
                Campos com * são obrigatórios. Preencha somente informações da sua própria empresa.
              </p>
            </div>
            <Field id="cnpj" title="CNPJ" required maxLength={18}
              placeholder="00.000.000/0000-00" value={campos.cnpj} onChange={v => atualizar("cnpj", v)} />
            <Field id="razaoSocial" title="Razão social" required maxLength={150}
              placeholder="Nome registrado da empresa" value={campos.razaoSocial} onChange={v => atualizar("razaoSocial", v)} />
            <Field id="nomeFantasia" title="Nome fantasia" maxLength={150}
              placeholder="Como sua pizzaria é conhecida" value={campos.nomeFantasia} onChange={v => atualizar("nomeFantasia", v)} />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.38fr)", gap: 12 }}>
              <Field id="municipio" title="Município" required maxLength={100}
                placeholder="Cidade" value={campos.municipio} onChange={v => atualizar("municipio", v)} />
              <label style={campo}>
                <span style={legenda}>UF *</span>
                <select required name="uf" value={campos.uf} style={entrada} onChange={e => atualizar("uf", e.currentTarget.value)}>
                  <option value="">Selecione</option>
                  {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
              </label>
            </div>
            <Field id="inscricaoEstadual" title="Inscrição estadual" maxLength={20}
              placeholder="Número ou ISENTO, se aplicável" value={campos.inscricaoEstadual}
              onChange={v => atualizar("inscricaoEstadual", v)} />
            <label style={campo}>
              <span style={legenda}>Regime tributário informado pelo empresário</span>
              <select name="regimeTributario" style={entrada} value={campos.regimeTributario}
                onChange={e => atualizar("regimeTributario", e.currentTarget.value)}>
                <option value="nao_informado">Não sei informar</option>
                <option value="simples_nacional">Simples Nacional</option>
                <option value="lucro_presumido">Lucro Presumido</option>
                <option value="lucro_real">Lucro Real</option>
              </select>
            </label>
            <label style={{ display: "flex", gap: 12, alignItems: "flex-start", lineHeight: 1.5, fontSize: 13 }}>
              <input type="checkbox" name="declaracaoResponsavel"
                checked={campos.declaracaoResponsavel}
                onChange={e => atualizar("declaracaoResponsavel", e.currentTarget.checked)}
                required style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }} />
              Confirmo que sou responsável ou autorizado a informar os dados desta empresa. Entendo que salvar não emite notas.
            </label>
            {erro && <p role="alert" style={{ margin: 0, padding: 12, borderRadius: 8, color: "var(--danger)", border: "1px solid var(--danger)", fontSize: 13 }}>{erro}</p>}
            {mensagem && <p role="status" style={{ margin: 0, padding: 12, borderRadius: 8, color: "var(--success)", border: "1px solid var(--success)", fontSize: 13 }}>{mensagem}</p>}
            <button type="submit" disabled={carregando || salvando || !!erro && carregando}
              style={{
                background: "var(--primary)", color: "var(--primary-foreground)",
                border: 0, borderRadius: 12, padding: 15, fontWeight: 800,
                fontSize: 15, cursor: salvando ? "wait" : "pointer", opacity: carregando || salvando ? 0.6 : 1,
              }}>
              {salvando ? "Salvando..." : carregando ? "Carregando..." : "Salvar cadastro da minha empresa"}
            </button>
          </form>
          <section style={{ color: "var(--foreground-secondary)", lineHeight: 1.6, fontSize: 13 }}>
            <strong style={{ color: "var(--foreground)" }}>O que vem depois?</strong>
            <p style={{ margin: "6px 0 0" }}>O ChefeBot precisará confirmar o vínculo da pizzaria,
              os dados tributários e o certificado digital A1 por um canal seguro.
              Não envie certificados, CSC, senhas ou tokens por este formulário.</p>
          </section>
        </div>
      </main>
    </PanelShell>
  );
}
