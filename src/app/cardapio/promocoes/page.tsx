"use client";
import { useEffect, useMemo, useState } from "react";
import { catalogoDoMenu, type CatalogoProduto, type Promocao, type PromoTipo } from "@/lib/promocoes";

// Gestão de Promoções do Cardápio (Kellyne/equipe). Página protegida no
// client pelo cookie de papel (mesmo padrão do painel do /cardapio); as APIs
// admin exigem auth-token válido de qualquer forma.

const money = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

const TIPOS: { value: PromoTipo; label: string }[] = [
  { value: "combo_fixed_price", label: "Combo com preço fixo" },
  { value: "buy_get_free", label: "Produto com brinde (preço normal)" },
  { value: "product_discount", label: "Desconto em produto" },
  { value: "custom_bundle", label: "Promoção personalizada" },
];

type Form = {
  id?: string;
  active: boolean;
  featured: boolean;
  badge: string;
  title: string;
  description: string;
  buttonText: string;
  type: PromoTipo;
  mainProductId: string;
  mainQuantity: number;
  freeProductId: string;
  freeQuantity: number;
  promotionalPrice: string;
  includedText: string;
  maxUsesPerOrder: string;
};

const FORM_VAZIO: Form = { active: false, featured: true, badge: "PROMO DE HOJE", title: "", description: "", buttonText: "Pedir essa promoção →", type: "combo_fixed_price", mainProductId: "", mainQuantity: 1, freeProductId: "", freeQuantity: 1, promotionalPrice: "", includedText: "", maxUsesPerOrder: "" };

const inputStyle = { width: "100%", background: "var(--surface)", border: "1px solid var(--surface-elevated)", borderRadius: 10, padding: "10px 12px", color: "var(--foreground)", fontSize: 14 } as const;
const labelStyle = { display: "block", fontSize: 11, fontWeight: 800, color: "var(--foreground-secondary)", textTransform: "uppercase" as const, letterSpacing: ".5px", margin: "12px 0 5px" };

export default function PromocoesPage() {
  const [autorizado, setAutorizado] = useState<boolean | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoProduto[]>([]);
  const [esgotados, setEsgotados] = useState<string[]>([]);
  const [promos, setPromos] = useState<Promocao[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [erros, setErros] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    try {
      const c = document.cookie.split(";").map((x) => x.trim()).find((x) => x.startsWith("auth-user="));
      const user = c ? JSON.parse(decodeURIComponent(c.substring("auth-user=".length))) : null;
      setAutorizado(!!user && ["admin", "atendente", "dev"].includes(user.role));
    } catch { setAutorizado(false); }
  }, []);

  const carregar = () => {
    fetch("/api/cardapio", { cache: "no-store" }).then((r) => r.json()).then((menu) => {
      setCatalogo(catalogoDoMenu(menu));
      setEsgotados(Array.isArray(menu.esgotados) ? menu.esgotados : []);
    }).catch(() => {});
    fetch("/api/admin/promocoes-cardapio", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then((d) => { if (Array.isArray(d)) setPromos(d); }).catch(() => {});
  };
  useEffect(() => { if (autorizado) carregar(); }, [autorizado]);

  const nomeEsgotado = (productName: string) => esgotados.some((e) => e.toLowerCase() === productName.toLowerCase());
  const prod = (id: string) => catalogo.find((p) => p.productId === id) || null;

  const previewPreco = useMemo(() => {
    if (!form) return null;
    const main = prod(form.mainProductId);
    if (!main) return null;
    if (form.type === "buy_get_free") return main.price * form.mainQuantity;
    const v = parseFloat(form.promotionalPrice.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }, [form, catalogo]);

  function montarPromocao(f: Form, ativa: boolean): Partial<Promocao> {
    const main = prod(f.mainProductId);
    const free = prod(f.freeProductId);
    const preco = parseFloat(f.promotionalPrice.replace(",", "."));
    return {
      active: ativa,
      featured: f.featured,
      badge: f.badge.trim(),
      title: f.title.trim(),
      description: f.description.trim(),
      buttonText: f.buttonText.trim() || "Pedir essa promoção →",
      type: f.type,
      mainItems: main ? [{ productId: main.productId, productName: main.productName, category: main.category, quantity: f.mainQuantity, ...(main.category === "pizza" ? { sizeRequired: main.productId.split(":")[1], customerMustChooseFlavor: true } : {}) }] : [],
      freeItems: free ? [{ productId: free.productId, productName: free.productName, category: free.category, quantity: f.freeQuantity, priceImpact: 0 as const }] : [],
      ...(f.type === "buy_get_free" ? {} : { promotionalPrice: Number.isFinite(preco) ? preco : undefined }),
      ...(f.type === "product_discount" && main ? { originalPrice: main.price * f.mainQuantity } : {}),
      includedText: f.includedText.trim(),
      maxUsesPerOrder: f.maxUsesPerOrder.trim() ? parseInt(f.maxUsesPerOrder, 10) : undefined,
    };
  }

  async function salvar(ativa: boolean) {
    if (!form) return;
    setSalvando(true); setErros([]); setAviso("");
    const body = montarPromocao(form, ativa);
    const r = form.id
      ? await fetch(`/api/admin/promocoes-cardapio/${form.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/admin/promocoes-cardapio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (r.ok && d.ok) { setForm(null); setAviso("Promoção salva!"); carregar(); }
    else if (Array.isArray(d.erros)) setErros(d.erros);
    else setErros(["Não consegui salvar. Tente de novo."]);
  }

  async function alternarAtiva(p: Promocao) {
    setAviso("");
    const r = await fetch(`/api/admin/promocoes-cardapio/${p.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !p.active }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) carregar();
    else setAviso(Array.isArray(d.erros) ? `Não deu para ativar: ${d.erros[0]}` : "Não consegui atualizar.");
  }

  function editar(p: Promocao) {
    setErros([]); setAviso("");
    setForm({
      id: p.id, active: p.active, featured: p.featured, badge: p.badge, title: p.title, description: p.description,
      buttonText: p.buttonText, type: p.type,
      mainProductId: p.mainItems[0]?.productId || "", mainQuantity: p.mainItems[0]?.quantity || 1,
      freeProductId: p.freeItems[0]?.productId || "", freeQuantity: p.freeItems[0]?.quantity || 1,
      promotionalPrice: typeof p.promotionalPrice === "number" ? String(p.promotionalPrice) : "",
      includedText: p.includedText || "", maxUsesPerOrder: p.maxUsesPerOrder ? String(p.maxUsesPerOrder) : "",
    });
  }

  if (autorizado === null) return <div style={{ minHeight: "100vh", background: "var(--background)" }} />;
  if (!autorizado) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--background)", color: "var(--foreground)", fontFamily: "system-ui" }}>
      <p>Acesso restrito à equipe.</p>
      <a href="/login?callbackUrl=/cardapio/promocoes" style={{ color: "var(--brand-text)" }}>Fazer login</a>
    </div>
  );

  const selectProduto = (value: string, onChange: (v: string) => void, permitirVazio: boolean) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      {permitirVazio && <option value="">— nenhum —</option>}
      {!permitirVazio && <option value="">Escolha um produto…</option>}
      {catalogo.map((p) => (
        <option key={p.productId} value={p.productId}>
          {p.productName} · {money(p.price)}{nomeEsgotado(p.productName) ? " (ESGOTADO)" : ""}
        </option>
      ))}
    </select>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", fontFamily: "system-ui", padding: "16px 16px 60px", maxWidth: 560, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <a href="/cardapio" style={{ color: "var(--foreground-secondary)", textDecoration: "none", fontSize: 13 }}>← Cardápio</a>
        <h1 style={{ flex: 1, fontSize: 19, fontWeight: 900, margin: 0 }}>🏷️ Promoções</h1>
        <button onClick={() => { setForm({ ...FORM_VAZIO }); setErros([]); setAviso(""); }} style={{ border: "none", borderRadius: 10, background: "var(--primary)", color: 'var(--primary-foreground)', fontSize: 13, fontWeight: 800, padding: "9px 13px", cursor: "pointer" }}>+ Nova promoção</button>
      </div>

      {aviso && <div style={{ background: "color-mix(in srgb, var(--success) 15%, transparent)", border: "1px solid var(--success)", borderRadius: 10, padding: "9px 12px", fontSize: 13, marginBottom: 12 }}>{aviso}</div>}

      {/* Lista */}
      {!form && (promos.length === 0
        ? <p style={{ color: "var(--foreground-secondary)", fontSize: 14 }}>Nenhuma promoção ainda. Crie a primeira com o botão acima.</p>
        : promos.map((p) => (
          <div key={p.id} style={{ background: "var(--surface)", border: `1px solid ${p.active ? "color-mix(in srgb, var(--primary) 40%, transparent)" : "var(--surface-elevated)"}`, borderRadius: 14, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{p.title || "(sem título)"} {p.featured && <span title="Destaque">⭐</span>}</div>
                <div style={{ fontSize: 12.5, color: "var(--foreground-secondary)", marginTop: 2 }}>
                  {p.mainItems.map((m) => m.productName).join(" + ") || "sem produto"}
                  {p.freeItems.length > 0 && ` + ${p.freeItems.map((f) => f.productName).join(" + ")} grátis`}
                  {typeof p.promotionalPrice === "number" && ` · ${money(p.promotionalPrice)}`}
                </div>
              </div>
              <button onClick={() => alternarAtiva(p)} style={{ border: "none", borderRadius: 999, padding: "7px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", background: p.active ? "color-mix(in srgb, var(--success) 20%, transparent)" : "var(--surface)", color: p.active ? "var(--success)" : "var(--foreground-secondary)" }}>{p.active ? "Ativa" : "Inativa"}</button>
              <button onClick={() => editar(p)} style={{ border: "1px solid var(--surface-elevated)", borderRadius: 10, background: "transparent", color: "var(--foreground-secondary)", fontSize: 12, fontWeight: 700, padding: "7px 11px", cursor: "pointer" }}>Editar</button>
            </div>
          </div>
        )))}

      {/* Formulário */}
      {form && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--surface-elevated)", borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 15 }}>{form.id ? "Editar promoção" : "Nova promoção"}</strong>
            <button onClick={() => setForm(null)} style={{ background: "none", border: "none", color: "var(--foreground-secondary)", fontSize: 13, cursor: "pointer" }}>Cancelar</button>
          </div>

          <label style={labelStyle}>Tipo da promoção</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PromoTipo })} style={inputStyle}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <label style={labelStyle}>Nome da promoção</label>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Pizza G + Guaraná 1L grátis" style={inputStyle} />

          <label style={labelStyle}>Descrição curta</label>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Uma escolha fácil pra pedir sem pensar muito." style={inputStyle} />

          <label style={labelStyle}>Selo</label>
          <input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} style={inputStyle} />

          <label style={labelStyle}>Texto do botão</label>
          <input value={form.buttonText} onChange={(e) => setForm({ ...form, buttonText: e.target.value })} style={inputStyle} />

          <label style={labelStyle}>Produto principal (do cardápio)</label>
          {selectProduto(form.mainProductId, (v) => setForm({ ...form, mainProductId: v }), false)}
          {form.mainProductId && nomeEsgotado(prod(form.mainProductId)?.productName || "") && (
            <div style={{ color: "var(--brand-text)", fontSize: 12, marginTop: 4 }}>⚠️ Este produto está esgotado — a promoção ficará oculta no cardápio enquanto isso.</div>
          )}
          <label style={labelStyle}>Quantidade</label>
          <input type="number" min={1} value={form.mainQuantity} onChange={(e) => setForm({ ...form, mainQuantity: Math.max(1, parseInt(e.target.value || "1", 10)) })} style={inputStyle} />
          {prod(form.mainProductId)?.category === "pizza" && <div style={{ color: "var(--foreground-secondary)", fontSize: 12, marginTop: 4 }}>Cliente escolhe o sabor na hora, com os sabores reais do cardápio.</div>}

          <label style={labelStyle}>Item grátis (brinde)</label>
          {selectProduto(form.freeProductId, (v) => setForm({ ...form, freeProductId: v }), true)}
          {form.freeProductId && nomeEsgotado(prod(form.freeProductId)?.productName || "") && (
            <div style={{ color: "var(--brand-text)", fontSize: 12, marginTop: 4 }}>⚠️ Brinde esgotado — a promoção ficará oculta enquanto isso.</div>
          )}
          {form.freeProductId && (<><label style={labelStyle}>Quantidade do brinde</label>
            <input type="number" min={1} value={form.freeQuantity} onChange={(e) => setForm({ ...form, freeQuantity: Math.max(1, parseInt(e.target.value || "1", 10)) })} style={inputStyle} /></>)}

          {form.type !== "buy_get_free" && (<>
            <label style={labelStyle}>Preço promocional (R$)</label>
            <input value={form.promotionalPrice} onChange={(e) => setForm({ ...form, promotionalPrice: e.target.value })} inputMode="decimal" placeholder="Ex: 49,90" style={inputStyle} />
          </>)}
          {form.type === "buy_get_free" && prod(form.mainProductId) && (
            <div style={{ color: "var(--foreground-secondary)", fontSize: 12.5, marginTop: 8 }}>Preço cobrado: valor normal do produto principal ({money(prod(form.mainProductId)!.price * form.mainQuantity)}). O brinde sai por R$ 0,00.</div>
          )}

          <label style={labelStyle}>Texto do que está incluso (opcional)</label>
          <input value={form.includedText} onChange={(e) => setForm({ ...form, includedText: e.target.value })} placeholder="Ex: Acompanha Guaraná 1L gelado" style={inputStyle} />

          <label style={labelStyle}>Limite por pedido (opcional)</label>
          <input type="number" min={1} value={form.maxUsesPerOrder} onChange={(e) => setForm({ ...form, maxUsesPerOrder: e.target.value })} placeholder="Ex: 1" style={inputStyle} />

          <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Destaque no cardápio
          </label>

          {/* Prévia */}
          <div style={{ margin: "16px 0 4px", fontSize: 11, fontWeight: 800, color: "var(--foreground-secondary)", textTransform: "uppercase", letterSpacing: ".5px" }}>Prévia do card no cardápio</div>
          {/* Prévia é sempre um "poster" escuro (navy/graphite), independente do
              tema da tela de admin — texto usa valores fixos claros. */}
          <div style={{ background: "linear-gradient(145deg,rgba(44,47,56,.9),rgba(25,34,48,.98) 58%,#192230)", border: "1px solid color-mix(in srgb, var(--primary) 28%, transparent)", borderRadius: 18, padding: 16 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#ffda3d", letterSpacing: "1px", marginBottom: 6 }}>{form.badge || "PROMO DE HOJE"}</div>
            <div style={{ fontSize: 20, fontWeight: 850, color: "#f8fafc", marginBottom: 5 }}>{form.title || "Nome da promoção"}</div>
            <div style={{ fontSize: 13, color: "#d1d5db", marginBottom: 10 }}>{form.description || "Descrição curta"}{previewPreco !== null ? ` · ${money(previewPreco)}` : ""}</div>
            <div style={{ display: "inline-block", background: "var(--primary)", color: 'var(--primary-foreground)', borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 800 }}>{form.buttonText || "Pedir essa promoção →"}</div>
          </div>

          {erros.length > 0 && (
            <div style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)", borderRadius: 10, padding: "10px 12px", marginTop: 12 }}>
              {erros.map((e, i) => <div key={i} style={{ color: "var(--danger)", fontSize: 13 }}>• {e}</div>)}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button disabled={salvando} onClick={() => salvar(false)} style={{ flex: 1, border: "1px solid var(--surface-elevated)", borderRadius: 12, background: "transparent", color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 800, padding: "12px 0", cursor: "pointer" }}>Salvar rascunho</button>
            <button disabled={salvando} onClick={() => salvar(true)} style={{ flex: 1.4, border: "none", borderRadius: 12, background: "var(--primary)", color: 'var(--primary-foreground)', fontSize: 14, fontWeight: 900, padding: "12px 0", cursor: "pointer", opacity: salvando ? 0.6 : 1 }}>{salvando ? "Salvando…" : "Salvar e ativar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
