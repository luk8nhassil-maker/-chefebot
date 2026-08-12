"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLiveMenu } from "@/app/cardapio/liveMenu";
import type { MenuType } from "@/app/cardapio/page";
import {
  extrairPagamentoComposto,
  montarPagamentoComposto,
  pagamentoAindaValido,
} from "@/lib/pagamentoComposto";
import { nextFlavorSelection } from "@/lib/pizzaSabores";

type ItemApp = {
  kind: "pizza" | "simple" | "promo";
  name: string;
  detail?: string;
  price: number;
  qty: number;
  promoId?: string;
};

type TipoEntrega = "delivery" | "retirada" | "dine_in";

type IniciarResposta = {
  ok: boolean;
  error?: string;
  editSessionId?: string;
  revision?: number;
  editExpiresAt?: string;
  pedido?: {
    id: string;
    numero?: number;
    cliente: string;
    telefone: string;
    itens: string[];
    itensDetalhados: ItemApp[] | null;
    total: number;
    tipoEntrega?: TipoEntrega;
    bairro?: string;
    rua?: string;
    enderecoNumero?: string;
    referencia?: string;
    endereco: string;
    pagamento?: string;
    troco?: string;
    observacao?: string;
  };
};

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

function norm(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function computeTaxa(tipoEntrega: TipoEntrega | undefined, bairro: string | undefined, neighborhoods: MenuType["neighborhoods"]): number {
  if (tipoEntrega !== "delivery" || !bairro) return 0;
  const b = neighborhoods.find((n) => n.name.toLowerCase().trim() === bairro.toLowerCase().trim());
  return b?.fee ?? 0;
}

const btnBase: React.CSSProperties = {
  height: 44,
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 800,
  cursor: "pointer",
};

export default function EditarPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { menu } = useLiveMenu();
  const [id, setId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [carregando, setCarregando] = useState(true);
  const [erroInicio, setErroInicio] = useState<string | null>(null);
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [revision, setRevision] = useState<number>(1);
  const [editExpiresAt, setEditExpiresAt] = useState<string | null>(null);
  const [numero, setNumero] = useState<number | undefined>(undefined);
  const [cliente, setCliente] = useState("");
  const [telefone, setTelefone] = useState("");

  const [itens, setItens] = useState<ItemApp[]>([]);
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega>("retirada");
  const [bairro, setBairro] = useState("");
  const [rua, setRua] = useState("");
  const [numeroEndereco, setNumeroEndereco] = useState("");
  const [referencia, setReferencia] = useState("");
  const [pagamento, setPagamento] = useState<string>("Pix");
  const [troco, setTroco] = useState("");
  const [trocoOpcao, setTrocoOpcao] = useState<"nao" | "sim">("nao");
  const [mistoPix, setMistoPix] = useState("");
  const [mistoDinheiro, setMistoDinheiro] = useState("");
  const [observacao, setObservacao] = useState("");

  const [addModalAberto, setAddModalAberto] = useState(false);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<{ total: number } | null>(null);
  const [tempoRestanteMs, setTempoRestanteMs] = useState<number | null>(null);
  const [erroFatal, setErroFatal] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setId(p.id));
    try {
      const sp = new URLSearchParams(window.location.search);
      setToken(sp.get("token"));
    } catch {}
  }, [params]);

  useEffect(() => {
    if (!id || token === null) return;
    if (!token) {
      setErroInicio("Link inválido. Volte para o acompanhamento do pedido e toque em Editar pedido de novo.");
      setCarregando(false);
      return;
    }
    let ativo = true;
    (async () => {
      try {
        const r = await fetch(`/api/pedido-app/${id}/editar/iniciar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusToken: token }),
        });
        const data = (await r.json()) as IniciarResposta;
        if (!ativo) return;
        if (!r.ok || !data.ok || !data.pedido) {
          setErroInicio(data.error || "Não foi possível iniciar a edição.");
          setCarregando(false);
          return;
        }
        const p = data.pedido;
        setEditSessionId(data.editSessionId || null);
        setRevision(data.revision ?? 1);
        setEditExpiresAt(data.editExpiresAt || null);
        setNumero(p.numero);
        setCliente(p.cliente);
        setTelefone(p.telefone);
        setItens(Array.isArray(p.itensDetalhados) && p.itensDetalhados.length > 0 ? p.itensDetalhados : []);
        setTipoEntrega((p.tipoEntrega === "delivery" || p.tipoEntrega === "dine_in" ? p.tipoEntrega : "retirada"));
        setBairro(p.bairro || "");
        setRua(p.rua || "");
        setNumeroEndereco(p.enderecoNumero || "");
        setReferencia(p.referencia || "");
        const pag = p.pagamento || "Pix";
        setPagamento(pag);
        const hibrido = extrairPagamentoComposto(pag);
        if (hibrido) {
          setMistoPix(hibrido.pix.toFixed(2).replace(".", ","));
          setMistoDinheiro(hibrido.dinheiro.toFixed(2).replace(".", ","));
        }
        setTroco(p.troco || "");
        setTrocoOpcao(p.troco && !/sem\s*troco/i.test(p.troco) ? "sim" : "nao");
        setObservacao(p.observacao || "");
        setCarregando(false);
      } catch {
        if (ativo) {
          setErroInicio("Erro de conexão. Tente novamente.");
          setCarregando(false);
        }
      }
    })();
    return () => { ativo = false; };
  }, [id, token]);

  // Contagem regressiva — só de exibição; a fonte da verdade é o servidor.
  useEffect(() => {
    if (!editExpiresAt) return;
    const tick = () => {
      const rest = new Date(editExpiresAt).getTime() - Date.now();
      setTempoRestanteMs(rest);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [editExpiresAt]);

  const expirado = tempoRestanteMs !== null && tempoRestanteMs <= 0;

  const neighborhoods = menu?.neighborhoods || [];
  const taxa = useMemo(() => computeTaxa(tipoEntrega, bairro, neighborhoods), [tipoEntrega, bairro, neighborhoods]);
  const subtotal = useMemo(() => itens.reduce((s, it) => s + it.price * it.qty, 0), [itens]);
  const totalEstimado = subtotal + taxa;

  function atualizarQty(idx: number, delta: number) {
    setItens((prev) => {
      const novo = [...prev];
      const q = novo[idx].qty + delta;
      if (q <= 0) return novo.filter((_, i) => i !== idx);
      novo[idx] = { ...novo[idx], qty: q };
      return novo;
    });
  }
  function removerItem(idx: number) {
    setItens((prev) => prev.filter((_, i) => i !== idx));
  }

  // A string canônica do pagamento misto nunca é montada aqui: quem valida e
  // formata é montarPagamentoComposto (src/lib/pagamentoComposto.ts). Antes
  // esta tela gravava "R$ 30.00" com ponto decimal, que os helpers do servidor
  // leem como separador de milhar — R$ 3.000 na cobrança Pix e no troco.
  const compostoEditado = useMemo(
    () => (pagamento === "Misto" ? montarPagamentoComposto(mistoPix, mistoDinheiro, totalEstimado) : null),
    [pagamento, mistoPix, mistoDinheiro, totalEstimado]
  );

  function pagamentoFinal(): string {
    if (pagamento === "Misto") return compostoEditado?.ok ? compostoEditado.valor : pagamento;
    return pagamento;
  }

  function temDinheiro(pag: string): boolean {
    return /dinheiro/i.test(pag);
  }

  // Revalidação contra o total ATUAL, recalculado a cada mudança de item: um
  // pagamento misto que fechava na criação pode deixar de fechar aqui. O
  // servidor rejeita de qualquer forma (fonte da verdade), mas o cliente
  // precisa saber ANTES de tocar em salvar, e com a instrução do que ajustar.
  const erroPagamento =
    pagamento === "Misto"
      ? compostoEditado && !compostoEditado.ok
        ? compostoEditado.erro
        : null
      : !pagamentoAindaValido(pagamento, totalEstimado)
        ? "A divisão entre Pix e dinheiro não fecha com o total atual. Toque em “Misto” e ajuste os valores."
        : null;

  const podeSalvar =
    !carregando && !expirado && !salvando && itens.length > 0 &&
    (tipoEntrega !== "delivery" || (bairro.trim() && rua.trim() && numeroEndereco.trim())) &&
    !erroPagamento &&
    (!temDinheiro(pagamentoFinal()) || (trocoOpcao === "nao" || troco.trim()));

  async function salvar() {
    if (!id || !token || !editSessionId || salvando) return;
    setSalvando(true);
    setErroSalvar(null);
    try {
      const body = {
        statusToken: token,
        editSessionId,
        revision,
        itens,
        tipoEntrega,
        bairro: tipoEntrega === "delivery" ? bairro : undefined,
        rua: tipoEntrega === "delivery" ? rua : undefined,
        numero: tipoEntrega === "delivery" ? numeroEndereco : undefined,
        referencia: tipoEntrega === "delivery" ? referencia : undefined,
        pagamento: pagamentoFinal(),
        troco: temDinheiro(pagamentoFinal()) ? (trocoOpcao === "nao" ? "Sem troco" : troco.trim()) : undefined,
        observacao: observacao.trim() || undefined,
      };
      const r = await fetch(`/api/pedido-app/${id}/editar/salvar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        if (r.status === 410) {
          setErroFatal("O tempo para editar terminou. Seu pedido original foi mantido.");
        } else {
          setErroSalvar(data.error || "Não foi possível salvar as alterações.");
        }
        setSalvando(false);
        return;
      }
      setSalvo({ total: data.total });
      setSalvando(false);
    } catch {
      setErroSalvar("Erro de conexão. Tente novamente.");
      setSalvando(false);
    }
  }

  async function descartar() {
    if (!id || !token || !editSessionId || descartando) return;
    setDescartando(true);
    try {
      await fetch(`/api/pedido-app/${id}/editar/descartar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusToken: token, editSessionId }),
      });
    } catch {}
    setDescartando(false);
    voltarParaAcompanhamento();
  }

  function voltarParaAcompanhamento() {
    if (!id) return;
    router.push(`/rastrear/${id}${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  }

  if (carregando) {
    return (
      <div style={pageWrap}>
        <p style={{ color: "var(--foreground-secondary)", fontSize: 14, fontWeight: 700 }}>Carregando pedido…</p>
      </div>
    );
  }

  if (erroInicio) {
    return (
      <div style={pageWrap}>
        <div style={cardStyle}>
          <p style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Não foi possível editar</p>
          <p style={{ fontSize: 14, color: "var(--foreground-secondary)", margin: "8px 0 16px" }}>{erroInicio}</p>
          <button style={{ ...btnBase, ...primaryBtn }} onClick={voltarParaAcompanhamento}>Voltar ao acompanhamento</button>
        </div>
      </div>
    );
  }

  if (erroFatal) {
    return (
      <div style={pageWrap}>
        <div style={cardStyle}>
          <p style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Tempo esgotado</p>
          <p style={{ fontSize: 14, color: "var(--foreground-secondary)", margin: "8px 0 16px" }}>{erroFatal}</p>
          <button style={{ ...btnBase, ...primaryBtn }} onClick={voltarParaAcompanhamento}>Voltar ao acompanhamento</button>
        </div>
      </div>
    );
  }

  if (salvo) {
    return (
      <div style={pageWrap}>
        <div style={cardStyle}>
          <p style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Alterações salvas</p>
          <p style={{ fontSize: 14, color: "var(--foreground-secondary)", margin: "8px 0 4px" }}>Seu pedido foi atualizado e enviado novamente para confirmação da loja.</p>
          <p style={{ fontSize: 15, fontWeight: 800, margin: "8px 0 16px" }}>Novo total: {money(salvo.total)}</p>
          <button style={{ ...btnBase, ...primaryBtn }} onClick={voltarParaAcompanhamento}>Ver meu pedido</button>
        </div>
      </div>
    );
  }

  const minsRestantes = tempoRestanteMs !== null ? Math.max(0, Math.ceil(tempoRestanteMs / 60000)) : null;

  return (
    <div style={{ ...pageWrap, alignItems: "stretch", paddingBottom: 120 }}>
      <div style={{ maxWidth: 480, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <p style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Editar pedido {numero != null ? `#${numero}` : ""}</p>
          <p style={{ fontSize: 13, color: "var(--foreground-secondary)", margin: "4px 0 0" }}>
            {expirado ? "O tempo para editar terminou." : `Conclua suas alterações em até 5 minutos.${minsRestantes !== null ? ` (${minsRestantes} min restantes)` : ""}`}
          </p>
        </div>

        {/* Itens */}
        <section style={cardStyle}>
          <p style={sectionTitle}>Itens do pedido</p>
          {itens.length === 0 && <p style={{ fontSize: 13, color: "var(--foreground-secondary)" }}>Nenhum item — adicione ao menos um item para salvar.</p>}
          {itens.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: i > 0 ? "1px solid var(--surface-secondary)" : "none" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{it.name}</div>
                {it.detail && <div style={{ fontSize: 12, color: "var(--foreground-secondary)" }}>{it.detail}</div>}
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground-muted)" }}>{money(it.price)} un.</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button style={qtyBtn} onClick={() => atualizarQty(i, -1)} aria-label="Diminuir">−</button>
                <span style={{ fontSize: 14, fontWeight: 900, minWidth: 18, textAlign: "center" }}>{it.qty}</span>
                <button style={qtyBtn} onClick={() => atualizarQty(i, 1)} aria-label="Aumentar">+</button>
                <button style={{ ...qtyBtn, color: "var(--danger)" }} onClick={() => removerItem(i)} aria-label="Remover">✕</button>
              </div>
            </div>
          ))}
          <button style={{ ...btnBase, width: "100%", marginTop: 10, border: "1px dashed var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }} onClick={() => setAddModalAberto(true)}>
            + Adicionar item
          </button>
        </section>

        {/* Entrega */}
        <section style={cardStyle}>
          <p style={sectionTitle}>Entrega</p>
          <div style={{ display: "flex", gap: 8, marginBottom: tipoEntrega === "delivery" ? 10 : 0 }}>
            {(["delivery", "retirada", "dine_in"] as const).map((t) => (
              <button key={t} onClick={() => setTipoEntrega(t)} style={{ ...btnBase, flex: 1, border: `1px solid ${tipoEntrega === t ? "var(--primary)" : "var(--surface-secondary)"}`, background: tipoEntrega === t ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", color: "var(--foreground)" }}>
                {t === "delivery" ? "Entrega" : t === "dine_in" ? "No local" : "Retirada"}
              </button>
            ))}
          </div>
          {tipoEntrega === "delivery" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select value={bairro} onChange={(e) => setBairro(e.target.value)} style={inputStyle}>
                <option value="">Selecione o bairro</option>
                {neighborhoods.map((b, i) => <option key={i} value={b.name}>{b.name} — {money(b.fee)}</option>)}
              </select>
              <input style={inputStyle} placeholder="Rua" value={rua} onChange={(e) => setRua(e.target.value)} />
              <input style={inputStyle} placeholder="Número" value={numeroEndereco} onChange={(e) => setNumeroEndereco(e.target.value)} />
              <input style={inputStyle} placeholder="Complemento / referência" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>
          )}
        </section>

        {/* Pagamento */}
        <section style={cardStyle}>
          <p style={sectionTitle}>Pagamento</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {["Pix", "Dinheiro", "Cartao", "Misto"].map((p) => (
              <button key={p} onClick={() => setPagamento(p)} style={{ ...btnBase, padding: "0 14px", border: `1px solid ${pagamento === p || (p === "Misto" && extrairPagamentoComposto(pagamento)) ? "var(--primary)" : "var(--surface-secondary)"}`, background: pagamento === p ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent", color: "var(--foreground)" }}>
                {p === "Cartao" ? "Cartão" : p}
              </button>
            ))}
          </div>
          {pagamento === "Misto" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input style={inputStyle} placeholder="Valor no Pix" value={mistoPix} onChange={(e) => setMistoPix(e.target.value)} inputMode="decimal" />
              <input style={inputStyle} placeholder="Valor em dinheiro" value={mistoDinheiro} onChange={(e) => setMistoDinheiro(e.target.value)} inputMode="decimal" />
            </div>
          )}
          {erroPagamento && (
            <p role="status" aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--attention-text)", margin: "0 0 10px" }}>
              {erroPagamento}
            </p>
          )}
          {temDinheiro(pagamentoFinal()) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...btnBase, flex: 1, border: `1px solid ${trocoOpcao === "nao" ? "var(--primary)" : "var(--surface-secondary)"}`, background: trocoOpcao === "nao" ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }} onClick={() => setTrocoOpcao("nao")}>Sem troco</button>
                <button style={{ ...btnBase, flex: 1, border: `1px solid ${trocoOpcao === "sim" ? "var(--primary)" : "var(--surface-secondary)"}`, background: trocoOpcao === "sim" ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }} onClick={() => setTrocoOpcao("sim")}>Preciso de troco</button>
              </div>
              {trocoOpcao === "sim" && <input style={inputStyle} placeholder="Troco para quanto?" value={troco} onChange={(e) => setTroco(e.target.value)} inputMode="decimal" />}
            </div>
          )}
        </section>

        {/* Observação */}
        <section style={cardStyle}>
          <p style={sectionTitle}>Observação</p>
          <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Sem cebola, bem passado..." />
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--foreground-secondary)" }}>
            <span>Subtotal</span><span>{money(subtotal)}</span>
          </div>
          {taxa > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--foreground-secondary)" }}>
              <span>Taxa de entrega</span><span>{money(taxa)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900, marginTop: 6 }}>
            <span>Total estimado</span><span>{money(totalEstimado)}</span>
          </div>
          <p style={{ fontSize: 11, color: "var(--foreground-muted)", marginTop: 4 }}>O valor final é recalculado pela loja ao salvar.</p>
        </section>

        {erroSalvar && (
          <div style={{ background: "var(--attention-surface)", border: "1px solid var(--attention-border)", borderRadius: 12, padding: "10px 12px" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--attention-text)" }}>{erroSalvar}</span>
          </div>
        )}
      </div>

      {/* Barra de ações fixa */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "var(--surface)", borderTop: "1px solid var(--surface-secondary)", padding: "12px 16px calc(12px + env(safe-area-inset-bottom))", display: "flex", gap: 10 }}>
        <button style={{ ...btnBase, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground-secondary)" }} onClick={() => setConfirmarDescarte(true)} disabled={descartando}>
          Descartar alterações
        </button>
        <button style={{ ...btnBase, flex: 2, ...primaryBtn, opacity: podeSalvar ? 1 : 0.5 }} disabled={!podeSalvar} onClick={salvar}>
          {salvando ? "Salvando…" : "Salvar alterações"}
        </button>
      </div>

      {confirmarDescarte && (
        <div style={overlayStyle}>
          <div style={{ ...cardStyle, maxWidth: 340 }}>
            <p style={{ fontSize: 17, fontWeight: 900, margin: 0 }}>Descartar as mudanças?</p>
            <p style={{ fontSize: 13, color: "var(--foreground-secondary)", margin: "8px 0 16px" }}>Seu pedido original será mantido.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button style={{ ...btnBase, border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => setConfirmarDescarte(false)}>Continuar editando</button>
              <button style={{ ...btnBase, border: "none", background: "var(--danger)", color: "#fff" }} onClick={descartar} disabled={descartando}>{descartando ? "Descartando…" : "Descartar alterações"}</button>
            </div>
          </div>
        </div>
      )}

      {addModalAberto && menu && (
        <AdicionarItemModal
          menu={menu}
          onFechar={() => setAddModalAberto(false)}
          onAdicionar={(item) => { setItens((prev) => [...prev, item]); setAddModalAberto(false); }}
        />
      )}
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  minHeight: "100dvh",
  background: "var(--background)",
  color: "var(--foreground)",
  fontFamily: "Archivo, sans-serif",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};
const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--surface-secondary)",
  borderRadius: 16,
  padding: 16,
};
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--foreground-muted)", margin: "0 0 10px" };
const inputStyle: React.CSSProperties = { height: 44, borderRadius: 10, border: "1px solid var(--surface-secondary)", background: "var(--background)", color: "var(--foreground)", padding: "0 12px", fontSize: 14, width: "100%", boxSizing: "border-box" };
const qtyBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: "1px solid var(--surface-secondary)", background: "transparent", color: "var(--foreground)", fontSize: 14, fontWeight: 900, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { border: "none", background: "var(--primary)", color: "var(--primary-foreground)" };
const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 };

function AdicionarItemModal({ menu, onFechar, onAdicionar }: { menu: MenuType; onFechar: () => void; onAdicionar: (item: ItemApp) => void }) {
  const [aba, setAba] = useState<"pizza" | "lanche" | "macarronada" | "bebida" | "suco" | "calzone">("pizza");
  const [size, setSize] = useState<string>(menu.sizes[0]?.code || "");
  const [f1, setF1] = useState<string | null>(null);
  const [f2, setF2] = useState<string | null>(null);
  const [border, setBorder] = useState<string | null>(null);
  const flavors = [...menu.saltyFlavors, ...menu.sweetFlavors];
  const calzoneItem = menu.lanches.find((l) => norm(l.name) === "calzone");
  // Lista efetiva de sabores do Calzone (aba "calzone" abaixo): com o
  // catálogo oficial presente, é SEMPRE `produto.flavors` (já calculada por
  // buildSimpleCatalog conforme flavorsMode via resolverFlavorsModeEfetivo —
  // mesma fonte que o Cardápio Público usa) — nunca `flavors` (lista cheia
  // da pizza, usada pela aba "pizza" acima, sem relação com flavorsMode).
  // HARDENING (auditoria independente, ciclo de autoauditoria pós-9ª
  // rodada): esta tela de edição de pedido tinha a MESMA lacuna do Cardápio
  // Público e do Pedido Manual/Salão (já corrigidas) — a aba calzone sempre
  // mostrava `flavors` incondicionalmente, nunca refletindo o modo "own". O
  // servidor (officialUnitPrice, em POST /api/pedido-app/[id]/editar/salvar)
  // já recusava a escolha errada — aqui só corrige o que É mostrado.
  //
  // HARDENING (auditoria independente, 2º ciclo de autoauditoria): a
  // condição decidia pelo RESULTADO do `.find` (produto encontrado ou não),
  // não pela presença genuína de `menu.catalog` — com o catálogo presente
  // mas sem o Calzone nele, caía de volta para `flavors` (lista legada da
  // pizza), que o servidor sempre recusaria de qualquer forma. Agora
  // `menu.catalog` ausente é o ÚNICO caso que autoriza `flavors`.
  const calzoneFlavorNames = menu.catalog
    ? menu.catalog.lanches.find((l) => l.name === calzoneItem?.name)?.flavors?.map((f) => f.name) ?? []
    : flavors;
  const macarronadas = menu.lanches.filter((l) => norm(l.name).includes("macarronada") && l.sizes?.length);
  const simplesLanches = menu.lanches.filter((l) => norm(l.name) !== "calzone" && !norm(l.name).includes("macarronada"));
  const [macarronadaSel, setMacarronadaSel] = useState<{ name: string; price: number; sizes?: { code: string; price: number }[] } | null>(null);
  const [sucoSel, setSucoSel] = useState<{ name: string; price: number } | null>(null);

  // Mesma regra do Cardápio Público, literalmente a mesma função
  // (@/lib/pizzaSabores): até 2 sabores, tocar num sabor já escolhido
  // desmarca, e com o limite atingido o 3º toque não muda nada (antes esta
  // tela tinha uma cópia própria que, no 3º toque, apagava OS DOIS sabores e
  // ficava só com o novo).
  function pickFlavor(f: string) {
    const next = nextFlavorSelection({ f1, f2 }, f, false);
    setF1(next.f1);
    setF2(next.f2);
  }

  function confirmarPizza() {
    const sizeInfo = menu.sizes.find((s) => s.code === size);
    if (!sizeInfo || !f1) return;
    const mam = !!f2;
    const flavorText = mam ? `${f1} / ${f2}` : f1;
    const borderInfo = border ? menu.borders.find((b) => b.label === border) : null;
    const isPM = size === "P" || size === "M";
    const borderPrice = borderInfo ? (isPM ? borderInfo.priceSmall : borderInfo.priceLarge) : 0;
    onAdicionar({
      kind: "pizza",
      name: `Pizza ${size}${mam ? " (meio a meio)" : ""}`,
      detail: `${flavorText}${border ? ` · borda ${border}` : ""}`,
      price: sizeInfo.price + borderPrice,
      qty: 1,
    });
  }

  return (
    <div style={overlayStyle} onClick={onFechar}>
      <div style={{ ...cardStyle, maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <p style={{ fontSize: 17, fontWeight: 900, margin: "0 0 10px" }}>Adicionar item</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {([
            ["pizza", "Pizza"],
            ["lanche", "Lanches"],
            ["macarronada", "Macarronada"],
            ["bebida", "Bebidas"],
            ["suco", "Sucos"],
            ["calzone", "Calzone"],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setAba(k)} style={{ ...btnBase, padding: "0 10px", height: 32, fontSize: 12, border: `1px solid ${aba === k ? "var(--primary)" : "var(--surface-secondary)"}`, background: aba === k ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }}>
              {label}
            </button>
          ))}
        </div>

        {aba === "pizza" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {menu.sizes.map((s) => (
                <button key={s.code} onClick={() => setSize(s.code)} style={{ ...btnBase, padding: "0 12px", height: 34, fontSize: 12, border: `1px solid ${size === s.code ? "var(--primary)" : "var(--surface-secondary)"}`, background: size === s.code ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }}>
                  {s.label} · {money(s.price)}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--foreground-secondary)", margin: 0 }}>Escolha até 2 sabores (meio a meio):</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 160, overflowY: "auto" }}>
              {flavors.map((f) => {
                const sel = f1 === f || f2 === f;
                return (
                  <button key={f} onClick={() => pickFlavor(f)} style={{ ...btnBase, padding: "0 10px", height: 30, fontSize: 11, border: `1px solid ${sel ? "var(--primary)" : "var(--surface-secondary)"}`, background: sel ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "transparent" }}>
                    {f}
                  </button>
                );
              })}
            </div>
            {menu.borders.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: "var(--foreground-secondary)", margin: 0 }}>Borda (opcional):</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button onClick={() => setBorder(null)} style={{ ...btnBase, padding: "0 10px", height: 30, fontSize: 11, border: `1px solid ${!border ? "var(--primary)" : "var(--surface-secondary)"}` }}>Sem borda</button>
                  {menu.borders.map((b) => (
                    <button key={b.label} onClick={() => setBorder(b.label)} style={{ ...btnBase, padding: "0 10px", height: 30, fontSize: 11, border: `1px solid ${border === b.label ? "var(--primary)" : "var(--surface-secondary)"}` }}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button style={{ ...btnBase, ...primaryBtn, opacity: f1 ? 1 : 0.5 }} disabled={!f1} onClick={confirmarPizza}>Adicionar pizza</button>
          </div>
        )}

        {aba === "lanche" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {simplesLanches.map((l) => (
              <button key={l.name} style={{ ...btnBase, justifyContent: "space-between", display: "flex", border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => onAdicionar({ kind: "simple", name: l.name, detail: "", price: l.price, qty: 1 })}>
                <span>{l.name}</span><span>{money(l.price)}</span>
              </button>
            ))}
          </div>
        )}

        {aba === "macarronada" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!macarronadaSel && macarronadas.map((m) => (
              <button key={m.name} style={{ ...btnBase, border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => setMacarronadaSel(m)}>{m.name}</button>
            ))}
            {macarronadaSel && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ fontSize: 13, fontWeight: 800, margin: 0 }}>{macarronadaSel.name}</p>
                {(macarronadaSel.sizes || []).map((s) => (
                  <button key={s.code} style={{ ...btnBase, justifyContent: "space-between", display: "flex", border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => { onAdicionar({ kind: "simple", name: macarronadaSel.name, detail: `Tamanho ${s.code}`, price: s.price, qty: 1 }); setMacarronadaSel(null); }}>
                    <span>Tamanho {s.code}</span><span>{money(s.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {aba === "bebida" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {menu.bebidas.map((b) => (
              <button key={b.name} style={{ ...btnBase, justifyContent: "space-between", display: "flex", border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => onAdicionar({ kind: "simple", name: b.name, detail: "", price: b.price, qty: 1 })}>
                <span>{b.name}</span><span>{money(b.price)}</span>
              </button>
            ))}
          </div>
        )}

        {aba === "suco" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {!sucoSel && menu.sucos.map((s) => (
              <button key={s.name} style={{ ...btnBase, border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => setSucoSel(s)}>{s.name}</button>
            ))}
            {sucoSel && (
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...btnBase, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => { onAdicionar({ kind: "simple", name: sucoSel.name, detail: "Sem leite", price: sucoSel.price, qty: 1 }); setSucoSel(null); }}>Sem leite</button>
                <button style={{ ...btnBase, flex: 1, border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => { onAdicionar({ kind: "simple", name: sucoSel.name, detail: "Com leite", price: sucoSel.price + 1, qty: 1 }); setSucoSel(null); }}>Com leite (+{money(1)})</button>
              </div>
            )}
          </div>
        )}

        {aba === "calzone" && calzoneItem && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ fontSize: 12, color: "var(--foreground-secondary)", margin: 0 }}>Escolha 1 sabor:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 200, overflowY: "auto" }}>
              {calzoneFlavorNames.map((f) => (
                <button key={f} style={{ ...btnBase, padding: "0 10px", height: 30, fontSize: 11, border: "1px solid var(--surface-secondary)", background: "transparent" }} onClick={() => onAdicionar({ kind: "simple", name: calzoneItem.name, detail: `Sabor: ${f}`, price: calzoneItem.price, qty: 1 })}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        <button style={{ ...btnBase, width: "100%", marginTop: 14, border: "none", background: "transparent", color: "var(--foreground-secondary)" }} onClick={onFechar}>Cancelar</button>
      </div>
    </div>
  );
}
