"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { CAMPOS_FORMULARIO_FISCAL, VAZIO, type CampoFiscal, type RespostasFiscais } from "@/lib/fiscal/questionario";

type Modo = "dono" | "contador";
type Dados = { respostas: RespostasFiscais; versao: number; atualizadoEm?: string; conviteAtivo?: boolean; importacaoDisponivel?: boolean };
const grupos: { titulo: string; descricao: string; campos: { id: CampoFiscal; rotulo: string; dica?: string }[] }[] = [
  { titulo: "Dados da empresa", descricao: "Preencha apenas o que souber.", campos: [
    { id: "cnpj", rotulo: "CNPJ que constará nas notas", dica: "Numérico ou alfanumérico" },
    { id: "razaoSocial", rotulo: "Razão social" },
    { id: "nomeFantasia", rotulo: "Nome fantasia (opcional)" },
    { id: "inscricaoEstadual", rotulo: "Inscrição estadual", dica: "Número ou ISENTO, quando aplicável" },
    { id: "porteEmpresa", rotulo: "Porte da empresa" },
    { id: "cnaePrincipal", rotulo: "CNAE principal", dica: "Ex.: 5611-2/01 (preenchimento pelo contador)" },
  ] },
  { titulo: "Endereço fiscal do CNPJ", descricao: "Informe o endereço fiscal do CNPJ que aparecerá nas notas.", campos: [
    { id: "uf", rotulo: "UF", dica: "Ex.: MA" },
    { id: "municipio", rotulo: "Cidade" },
    { id: "codigoIBGE", rotulo: "Código IBGE do município" },
    { id: "cep", rotulo: "CEP" },
    { id: "logradouro", rotulo: "Rua / avenida" },
    { id: "numero", rotulo: "Número" },
    { id: "bairro", rotulo: "Bairro" },
  ] },
  { titulo: "Informações para o contador", descricao: "Não informe valores ou impostos por suposição.", campos: [
    { id: "regimeTributario", rotulo: "Regime tributário" },
    { id: "credenciamentoNfce", rotulo: "Credenciamento para NFC-e" },
    { id: "certificadoNaWlg", rotulo: "Certificado digital configurado na WLG?" },
    { id: "orientacoesProdutos", rotulo: "Regras fiscais dos produtos", dica: "NCM, CFOP, CST/CSOSN e orientações por produto. Não substitui a futura configuração item a item." },
    { id: "observacoes", rotulo: "Observações" },
  ] },
];
const options: Partial<Record<CampoFiscal, [string,string][]>> = {
  porteEmpresa: [["", "Ainda não sei"], ["mei","MEI"], ["me","Microempresa (ME)"], ["epp","Empresa de pequeno porte (EPP)"], ["demais","Média, grande ou outro porte"], ["nao_informado","Não informado"]],
  regimeTributario: [["", "Ainda não sei"], ["simei","SIMEI (MEI)"], ["simples_nacional","Simples Nacional"], ["lucro_presumido","Lucro Presumido"], ["lucro_real","Lucro Real"], ["outro","Outro / regime especial"], ["nao_informado","Não informado"]],
  credenciamentoNfce: [["","Ainda não sei"], ["pendente","Pendente"], ["habilitado","Já credenciado"], ["nao_informado","Não informado"]],
  certificadoNaWlg: [["","Ainda não sei"], ["sim","Sim"], ["nao","Não"], ["nao_informado","Não informado"]],
};
const fieldStyle: CSSProperties = {
  width:"100%",padding:"11px 12px",minHeight:44,
  border:"1px solid var(--border)",borderRadius:10,
  background:"var(--background)",color:"var(--foreground)",
  boxSizing:"border-box" as const,font:"inherit",fontSize:14,
};
const textMuted: CSSProperties = { fontSize:13, lineHeight:1.6, color:"var(--foreground-secondary)", margin:0 };
const acaoStyle: CSSProperties = {padding:"12px 14px",borderRadius:10,border:"1px solid var(--border)",fontSize:14,fontWeight:750,cursor:"pointer",background:"var(--surface)",color:"var(--foreground)"};

export default function FormularioFiscalCompartilhado({ modo }: { modo: Modo }) {
  const [respostas, setRespostas] = useState<RespostasFiscais>({ ...VAZIO });
  const [versao, setVersao] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pronto, setPronto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [info, setInfo] = useState("");
  const [token, setToken] = useState("");
  const [link, setLink] = useState("");
  const [conviteAtivo, setConviteAtivo] = useState(false);

  const chamar = useCallback(async (acao: "ler" | "salvar", dados?: { versao: number; respostas: RespostasFiscais }, convite?: string) => {
    const path = modo === "dono" ? "/api/fiscal/questionario" : "/api/fiscal/questionario/compartilhado";
    const body = modo === "dono" ? dados : { acao, token: convite, ...dados };
    const res = await fetch(path, {
      method: modo === "dono" ? (acao === "ler" ? "GET" : "PUT") : "POST",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      cache:"no-store", credentials:modo === "dono" ? "same-origin" : "omit",
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Não foi possível carregar o formulário.");
    return json as Dados;
  }, [modo]);

  useEffect(() => {
    let live = true;
    const invite = modo === "contador" ? new URLSearchParams(window.location.hash.slice(1)).get("convite") ?? "" : "";
    if (modo === "contador" && !invite) {
      queueMicrotask(() => { if (live) { setErro("O convite está incompleto. Peça outro link ao dono."); setLoading(false); } });
      return () => { live = false; };
    }
    if (invite) queueMicrotask(() => { if(live) setToken(invite); });
    chamar("ler", undefined, invite).then(async json => {
      let cadastro = json;
      // A importação só é executada pelo navegador já autenticado do dono.
      // Não ocorre no modo contador e nunca altera campos existentes.
      if (modo === "dono" && json.importacaoDisponivel) {
        try {
          const response = await fetch("/api/fiscal/questionario", {
            method: "POST", credentials: "same-origin", cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ acao: "importar_dados_da_nota" }),
          });
          const resultado = await response.json();
          if (!response.ok) throw new Error(resultado.error || "Não foi possível importar os dados da nota.");
          if (resultado.status === "importado") {
            cadastro = resultado as Dados;
            if (live) setInfo("Os dados confirmados da nota foram preenchidos e salvos. O restante pode ser completado depois.");
          }
        } catch (e) {
          if (live) setErro(e instanceof Error ? e.message : "Importação indisponível.");
        }
      }
      if (!live) return;
      setRespostas({ ...VAZIO, ...cadastro.respostas });
      setVersao(cadastro.versao);
      setConviteAtivo(json.conviteAtivo === true);
      setPronto(true);
    }).catch(e => { if(live) setErro(e instanceof Error ? e.message : "Convite indisponível."); })
      .finally(() => {if(live) setLoading(false);});
    return () => { live = false; };
  }, [modo, chamar]);

  const atualizar = (key: CampoFiscal, value: string) => {
    setRespostas(old => ({ ...old, [key]: value }));
    setInfo("");
  };

  const salvar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || loading) return;
    setBusy(true);setErro("");setInfo("");
    try {
      const json = await chamar("salvar", { versao, respostas }, token);
      setVersao(json.versao);
      setRespostas({ ...VAZIO, ...json.respostas });
      setInfo("Respostas salvas. Você pode continuar depois. Nenhuma nota foi emitida.");
    } catch(e) {setErro(e instanceof Error ? e.message : "Não foi possível salvar.");}
    finally {setBusy(false);}
  };

  const gerenciarConvite = async (acao: "criar" | "revogar") => {
    if (modo !== "dono" || busy) return;
    setBusy(true);setErro("");setInfo("");
    try {
      const res = await fetch("/api/fiscal/questionario", {
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao}),cache:"no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Não foi possível preparar o convite.");
      if (acao === "criar") {
        setLink(window.location.origin + "/configuracoes/nota-fiscal/contador#convite=" + encodeURIComponent(json.token));
        setConviteAtivo(true);setInfo("Link criado. Envie somente ao seu contador. Ele vale por 72 horas.");
      } else {
        setLink("");setConviteAtivo(false);setInfo("Convite revogado.");
      }
    } catch(e){setErro(e instanceof Error ? e.message : "Não foi possível preparar o convite.");}
    finally{setBusy(false);}
  };

  const preenchidos = CAMPOS_FORMULARIO_FISCAL.filter(k => respostas[k].length > 0).length;

  return (
    <main style={{minHeight:"100vh",padding:"26px 16px 70px",fontFamily:"'Archivo', sans-serif",color:"var(--foreground)"}}>
      <div style={{maxWidth:700,margin:"0 auto",display:"grid",gap:16}}>
        {modo === "dono" && <Link href="/configuracoes/nota-fiscal" style={{textDecoration:"none",...textMuted}}>← Voltar à nota fiscal</Link>}
        <header style={{display:"grid",gap:6}}>
          <h1 style={{fontSize:"clamp(23px,5vw,30px)",fontWeight:900,margin:0}}>
            {modo === "dono" ? "Dados fiscais da pizzaria" : "Informações fiscais para a pizzaria"}
          </h1>
          <p style={textMuted}>Preencha somente o que souber. Tudo pode ficar para depois. O salvamento não ativa notas fiscais.</p>
        </header>
        {modo === "dono" && <section aria-label="Compartilhar com contador" style={{border:"1px solid var(--border)",borderRadius:16,padding:18,background:"var(--surface)",display:"grid",gap:11}}>
          <strong style={{fontSize:16}}>Peça ajuda ao seu contador</strong>
          <p style={textMuted}>Envie um link exclusivo. Ele acessará só este formulário, sem ver pedidos, pagamentos ou outras áreas.</p>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button type="button" disabled={busy||loading} onClick={()=>gerenciarConvite("criar")} style={acaoStyle}>
              {conviteAtivo ? "Criar novo link" : "Convidar contador"}
            </button>
            {conviteAtivo && <button type="button" disabled={busy} onClick={()=>gerenciarConvite("revogar")} style={acaoStyle}>Revogar convite</button>}
          </div>
          {link && <div style={{display:"grid",gap:7}}>
            <label htmlFor="link-contador" style={{...textMuted,fontWeight:700}}>Link (visível apenas agora)</label>
            <input id="link-contador" readOnly value={link} onFocus={e=>e.currentTarget.select()} style={fieldStyle}/>
            <button type="button" style={acaoStyle} onClick={() => navigator.clipboard.writeText(link).then(()=>setInfo("Link copiado."),()=>setErro("Selecione e copie o link acima."))}>Copiar link para o WhatsApp</button>
          </div>}
          <p style={{...textMuted,fontSize:12}}>O convite expira em 72 horas. Criar outro link cancela o anterior. Não envie senhas ou certificados.</p>
        </section>}
        {loading ? <p role="status">Carregando formulário…</p> : pronto && <>
          <div role="status" style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:13,color:"var(--foreground-secondary)"}}>
            <span>{preenchidos} de {CAMPOS_FORMULARIO_FISCAL.length} campos preenchidos</span>
            <span>Rascunho · sem emissão</span>
          </div>
          <p style={{...textMuted,fontSize:12}}>
            Um único CNPJ e endereço fiscal serão usados para o emitente.
            A emissão permanecerá bloqueada até a conferência dos dados e do credenciamento fiscal.
          </p>
          <form onSubmit={salvar} style={{display:"grid",gap:14}}>
            {grupos.map(grupo => <section key={grupo.titulo} style={{border:"1px solid var(--border)",borderRadius:16,background:"var(--surface)",padding:"19px 16px",display:"grid",gap:15}}>
              <div style={{display:"grid",gap:3}}>
                <h2 style={{fontSize:17,fontWeight:850,margin:0}}>{grupo.titulo}</h2>
                <p style={textMuted}>{grupo.descricao}</p>
              </div>
              {grupo.campos.map(campo => <label key={campo.id} style={{display:"grid",gap:6,minWidth:0}}>
                <span style={{fontSize:13,fontWeight:750}}>{campo.rotulo}</span>
                {options[campo.id] ? <select value={respostas[campo.id]} onChange={e=>atualizar(campo.id,e.target.value)} style={fieldStyle}>
                  {options[campo.id]?.map(([value,label])=><option key={value} value={value}>{label}</option>)}
                </select> : campo.id === "orientacoesProdutos" || campo.id === "observacoes" ?
                  <textarea rows={campo.id === "orientacoesProdutos" ? 4 : 3} value={respostas[campo.id]} maxLength={campo.id === "orientacoesProdutos" ? 1200 : 800}
                    onChange={e=>atualizar(campo.id,e.target.value)} placeholder={campo.dica || "Pode deixar em branco"} style={{...fieldStyle,resize:"vertical"}}/> :
                  <input value={respostas[campo.id]} onChange={e=>atualizar(campo.id,e.target.value)}
                    placeholder={campo.dica||"Pode deixar em branco"} maxLength={({cnpj:18,razaoSocial:150,nomeFantasia:150,inscricaoEstadual:20,cnaePrincipal:10,uf:2,municipio:100,codigoIBGE:7,cep:9,logradouro:150,numero:20,bairro:100} as Partial<Record<CampoFiscal,number>>)[campo.id] ?? 100}
                    autoComplete="off" style={fieldStyle}/>}
              </label>)}
            </section>)}
            <p style={{...textMuted,fontSize:12}}>Não cole senhas, certificado A1, CSC, tokens nem credenciais WLG. Os dados serão revisados antes de qualquer emissão.</p>
            {erro && <p role="alert" style={{margin:0,color:"var(--danger)",fontSize:13}}>{erro}</p>}
            {info && <p role="status" style={{margin:0,color:"var(--success)",fontSize:13}}>{info}</p>}
            <button type="submit" disabled={busy||loading} style={{...acaoStyle,background:"var(--primary)",color:"var(--primary-foreground)",padding:15,fontSize:15}}>
              {busy ? "Salvando…" : "Salvar e continuar depois"}
            </button>
          </form>
        </>}
        {!loading && !pronto && erro && <p role="alert" style={{color:"var(--danger)",fontSize:14}}>{erro}</p>}
      </div>
    </main>
  );
}
