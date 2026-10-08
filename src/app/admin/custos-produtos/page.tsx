"use client";

import { useEffect, useState } from "react";
import PanelShell from "@/components/PanelShell";

type Ingrediente = {
  id: string; nome: string; quantidadeCompra: number; unidadeCompra: "g" | "kg" | "ml" | "l" | "un"; precoCompraCents: number; aproveitamentoPercent: number;
};
type Componente = { ingredienteId: string; quantidade: string; unidade: "g" | "ml" | "un" };
type Receita = { produtoId: string; nomeProduto: string; precoVendaCents: number; componentes: Array<{ ingredienteId: string; quantidade: number; unidade: "g" | "ml" | "un" }>; embalagemCustoCents: number; taxaVendaPercent: number; ativo: boolean };
type Produto = { produtoId: string; nomeProduto: string; completo: boolean; sobraCents: number | null; faltantes: string[] };
type Dados = { config: { ingredientes: Ingrediente[]; receitas: Receita[] }; produtos: Produto[]; vendasAnalisadas: number; cobertura: { modo: string; produtosCompletos: number; produtosTotal: number; vendasCobertasPercent: number; produtosIncompletos: string[]; motivo: string } };

const moeda = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 42, border: "1px solid var(--surface-elevated)", borderRadius: 10, padding: "9px 11px", background: "var(--background)", color: "var(--foreground)" };

export default function CustosProdutosPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [ingrediente, setIngrediente] = useState({ id: "", nome: "", quantidadeCompra: "", unidadeCompra: "kg" as Ingrediente["unidadeCompra"], precoReais: "", aproveitamentoPercent: "100" });
  const [receita, setReceita] = useState({ produtoId: "", nomeProduto: "", precoReais: "", embalagemReais: "", taxaPercent: "0" });
  const [componentes, setComponentes] = useState<Componente[]>([{ ingredienteId: "", quantidade: "", unidade: "g" }]);

  async function carregar() {
    setErro("");
    try {
      const res = await fetch("/api/admin/custos-produtos", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Não foi possível carregar os custos.");
      setDados(json as Dados);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível carregar os custos."); }
  }

  useEffect(() => { void carregar(); }, []);

  async function salvarIngrediente(event: React.FormEvent) {
    event.preventDefault();
    setSalvando(true); setMensagem("");
    try {
      const body = { tipo: "ingrediente", ingrediente: { id: ingrediente.id, nome: ingrediente.nome, quantidadeCompra: Number(ingrediente.quantidadeCompra), unidadeCompra: ingrediente.unidadeCompra, precoCompraCents: Math.round(Number(ingrediente.precoReais.replace(",", ".")) * 100), aproveitamentoPercent: Number(ingrediente.aproveitamentoPercent) } };
      const res = await fetch("/api/admin/custos-produtos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Não foi possível salvar o ingrediente.");
      setIngrediente({ id: "", nome: "", quantidadeCompra: "", unidadeCompra: "kg", precoReais: "", aproveitamentoPercent: "100" });
      setMensagem("Ingrediente salvo. O robô usará esse custo automaticamente."); await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível salvar o ingrediente."); }
    finally { setSalvando(false); }
  }

  async function salvarReceita(event: React.FormEvent) {
    event.preventDefault();
    setSalvando(true); setMensagem("");
    try {
      const body = { tipo: "receita", receita: { produtoId: receita.produtoId, nomeProduto: receita.nomeProduto, precoVendaCents: Math.round(Number(receita.precoReais.replace(",", ".")) * 100), embalagemCustoCents: Math.round(Number(receita.embalagemReais.replace(",", ".") || 0) * 100), taxaVendaPercent: Number(receita.taxaPercent || 0), componentes: componentes.map((item) => ({ ingredienteId: item.ingredienteId, quantidade: Number(item.quantidade), unidade: item.unidade })), ativo: true } };
      const res = await fetch("/api/admin/custos-produtos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Não foi possível salvar a receita.");
      setReceita({ produtoId: "", nomeProduto: "", precoReais: "", embalagemReais: "", taxaPercent: "0" }); setComponentes([{ ingredienteId: "", quantidade: "", unidade: "g" }]);
      setMensagem("Produto salvo. O cálculo será atualizado sozinho."); await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível salvar o produto."); }
    finally { setSalvando(false); }
  }

  return <PanelShell showGestaoNav>
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "28px 18px 48px", fontFamily: "Archivo, sans-serif" }}>
      <a href="/admin" style={{ color: "var(--foreground-secondary)", fontSize: 13, textDecoration: "none" }}>← Voltar ao painel</a>
      <header style={{ margin: "20px 0 24px" }}><h1 style={{ margin: 0, fontSize: 28 }}>Custos dos produtos</h1><p style={{ margin: "7px 0 0", color: "var(--foreground-secondary)", lineHeight: 1.5 }}>Informe os custos uma vez. Depois, o robô calcula a sobra e muda de modo sozinho.</p></header>
      {erro && <p role="alert" style={{ padding: 12, borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)" }}>{erro}</p>}
      {mensagem && <p role="status" style={{ padding: 12, borderRadius: 10, background: "var(--success-soft)", color: "var(--success)" }}>{mensagem}</p>}
      <section style={{ border: "1px solid var(--surface-secondary)", borderRadius: 16, padding: 18, background: "var(--surface)", marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}><div><small style={{ color: "var(--foreground-secondary)", fontWeight: 800, letterSpacing: .6 }}>MODO ATUAL</small><h2 style={{ margin: "5px 0", fontSize: 22 }}>{dados?.cobertura.modo === "margem_ativa" ? "Margem ativa" : dados?.cobertura.modo === "margem_parcial" ? "Aprendendo custos" : "Modo vendas"}</h2><p style={{ margin: 0, color: "var(--foreground-secondary)", lineHeight: 1.45 }}>{dados?.cobertura.motivo || "Carregando estado..."}</p></div><strong style={{ fontSize: 26, color: "var(--primary)" }}>{dados ? `${dados.cobertura.produtosCompletos}/${dados.cobertura.produtosTotal}` : "—"}</strong></div>
        <div style={{ height: 9, marginTop: 16, borderRadius: 99, background: "var(--surface-secondary)", overflow: "hidden" }}><div style={{ height: "100%", width: `${dados && dados.cobertura.produtosTotal ? Math.round((dados.cobertura.produtosCompletos / dados.cobertura.produtosTotal) * 100) : 0}%`, background: "var(--primary)", borderRadius: 99 }} /></div>
        <small style={{ display: "block", marginTop: 7, color: "var(--foreground-secondary)" }}>{dados?.vendasAnalisadas ? `Pedidos entregues com produto identificado: ${dados.vendasAnalisadas}. Cobertura com custo: ${dados.cobertura.vendasCobertasPercent}%.` : "Ainda não há itens identificados para medir a cobertura por vendas."} Produtos incompletos não entram em promoções com margem.</small>
      </section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 18 }}>
        <form onSubmit={salvarIngrediente} style={{ border: "1px solid var(--surface-secondary)", borderRadius: 16, padding: 18, background: "var(--surface)" }}><h2 style={{ margin: "0 0 6px", fontSize: 18 }}>1. Ingrediente</h2><p style={{ margin: "0 0 14px", color: "var(--foreground-secondary)", fontSize: 13, lineHeight: 1.4 }}>Ex.: comprou 5 kg de queijo por R$ 100.</p><div style={{ display: "grid", gap: 9 }}><input required placeholder="Código simples (ex.: queijo)" value={ingrediente.id} onChange={e => setIngrediente(v => ({ ...v, id: e.target.value }))} style={inputStyle} /><input required placeholder="Nome do ingrediente" value={ingrediente.nome} onChange={e => setIngrediente(v => ({ ...v, nome: e.target.value }))} style={inputStyle} /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><input required type="number" min="0.001" step="0.001" placeholder="Quantidade" value={ingrediente.quantidadeCompra} onChange={e => setIngrediente(v => ({ ...v, quantidadeCompra: e.target.value }))} style={inputStyle} /><select value={ingrediente.unidadeCompra} onChange={e => setIngrediente(v => ({ ...v, unidadeCompra: e.target.value as Ingrediente["unidadeCompra"] }))} style={inputStyle}><option value="kg">kg</option><option value="g">g</option><option value="l">litro</option><option value="ml">ml</option><option value="un">unidade</option></select></div><input required type="number" min="0" step="0.01" placeholder="Preço pago (R$)" value={ingrediente.precoReais} onChange={e => setIngrediente(v => ({ ...v, precoReais: e.target.value }))} style={inputStyle} /><input type="number" min="1" max="100" step="1" placeholder="Aproveitamento (%)" value={ingrediente.aproveitamentoPercent} onChange={e => setIngrediente(v => ({ ...v, aproveitamentoPercent: e.target.value }))} style={inputStyle} /><button disabled={salvando} style={{ ...inputStyle, border: 0, background: "var(--primary)", color: "var(--primary-foreground)", fontWeight: 800, cursor: "pointer" }}>Salvar ingrediente</button></div></form>
        <form onSubmit={salvarReceita} style={{ border: "1px solid var(--surface-secondary)", borderRadius: 16, padding: 18, background: "var(--surface)" }}><h2 style={{ margin: "0 0 6px", fontSize: 18 }}>2. Produto e receita</h2><p style={{ margin: "0 0 14px", color: "var(--foreground-secondary)", fontSize: 13, lineHeight: 1.4 }}>Ligue o produto aos ingredientes usados. O cálculo acontece sozinho.</p><div style={{ display: "grid", gap: 9 }}><input required placeholder="Código do produto" value={receita.produtoId} onChange={e => setReceita(v => ({ ...v, produtoId: e.target.value }))} style={inputStyle} /><input required placeholder="Nome do produto" value={receita.nomeProduto} onChange={e => setReceita(v => ({ ...v, nomeProduto: e.target.value }))} style={inputStyle} /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><input required type="number" min="0" step="0.01" placeholder="Preço de venda (R$)" value={receita.precoReais} onChange={e => setReceita(v => ({ ...v, precoReais: e.target.value }))} style={inputStyle} /><input type="number" min="0" step="0.01" placeholder="Embalagem (R$)" value={receita.embalagemReais} onChange={e => setReceita(v => ({ ...v, embalagemReais: e.target.value }))} style={inputStyle} /></div><input type="number" min="0" max="100" step="0.01" placeholder="Taxa de pagamento (%)" value={receita.taxaPercent} onChange={e => setReceita(v => ({ ...v, taxaPercent: e.target.value }))} style={inputStyle} />{componentes.map((item, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 85px 72px", gap: 6 }}><select required value={item.ingredienteId} onChange={e => setComponentes(v => v.map((x, i) => i === index ? { ...x, ingredienteId: e.target.value } : x))} style={inputStyle}><option value="">Ingrediente</option>{dados?.config.ingredientes.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select><input required type="number" min="0.001" step="0.001" placeholder="Qtd." value={item.quantidade} onChange={e => setComponentes(v => v.map((x, i) => i === index ? { ...x, quantidade: e.target.value } : x))} style={inputStyle} /><select value={item.unidade} onChange={e => setComponentes(v => v.map((x, i) => i === index ? { ...x, unidade: e.target.value as Componente["unidade"] } : x))} style={inputStyle}><option value="g">g</option><option value="ml">ml</option><option value="un">un</option></select></div>)}<button type="button" onClick={() => setComponentes(v => [...v, { ingredienteId: "", quantidade: "", unidade: "g" }])} style={{ ...inputStyle, background: "transparent", cursor: "pointer" }}>+ Adicionar ingrediente</button><button disabled={salvando} style={{ ...inputStyle, border: 0, background: "var(--primary)", color: "var(--primary-foreground)", fontWeight: 800, cursor: "pointer" }}>Salvar produto</button></div></form>
      </div>
      <section style={{ marginTop: 18, border: "1px solid var(--surface-secondary)", borderRadius: 16, padding: 18, background: "var(--surface)" }}><h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Produtos cadastrados</h2>{dados?.produtos.length ? <div style={{ display: "grid", gap: 8 }}>{dados.produtos.map(item => <div key={item.produtoId} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--surface-secondary)" }}><div><strong>{item.nomeProduto}</strong><small style={{ display: "block", color: "var(--foreground-secondary)", marginTop: 3 }}>{item.completo ? `Sobra estimada: ${moeda(item.sobraCents ?? 0)}` : `Falta: ${item.faltantes.join(", ") || "receita completa"}`}</small></div><span style={{ color: item.completo ? "var(--success)" : "var(--warning)", fontWeight: 800 }}>{item.completo ? "Completo" : "Pendente"}</span></div>)}</div> : <p style={{ margin: 0, color: "var(--foreground-secondary)" }}>Nenhum produto foi ligado aos ingredientes ainda.</p>}</section>
    </main>
  </PanelShell>;
}
