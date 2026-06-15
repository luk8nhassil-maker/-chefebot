"use client";
import { useState, useEffect, useRef } from "react";

type MenuType = {
  sizes: { code: string; label: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  lanches: { name: string; price: number }[];
  bebidas: { name: string; price: number }[];
  sucos: { name: string; price: number }[];
  borders: { label: string; priceSmall: number; priceLarge: number }[];
  neighborhoods: { name: string; fee: number }[];
  payments: string[];
};

type CartItem = {
  emoji: string;
  kind: "pizza" | "simple";
  name: string;
  detail: string;
  price: number;
  qty: number;
};

const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
const bigBorder = (sz: string) => !(sz === "P" || sz === "M");

export default function CardapioApp() {
  const [menu, setMenu] = useState<MenuType | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [screen, setScreen] = useState("sc-start");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sending, setSending] = useState(false);

  // build da pizza atual
  const [size, setSize] = useState<string | null>(null);
  const [sizePrice, setSizePrice] = useState(0);
  const [mam, setMam] = useState(false);
  const [f1, setF1] = useState<string | null>(null);
  const [f2, setF2] = useState<string | null>(null);
  const [border, setBorder] = useState<string | null>(null);
  const [borderPrice, setBorderPrice] = useState(0);

  // plano de múltiplas pizzas
  const [plan, setPlan] = useState<{ total: number; current: number; openEnded: boolean }>({ total: 0, current: 0, openEnded: false });

  // lista simples atual
  const [listCat, setListCat] = useState<"lanche" | "bebida" | "suco">("lanche");

  // entrega/pagamento
  const [delType, setDelType] = useState<"delivery" | "retirada" | null>(null);
  const [bairroIdx, setBairroIdx] = useState<string>("");
  const [rua, setRua] = useState("");
  const [nome, setNome] = useState("");
  const [payment, setPayment] = useState<string | null>(null);
  const [troco, setTroco] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<any>(null);

  useEffect(() => {
    fetch("/api/cardapio")
      .then((r) => r.json())
      .then(setMenu)
      .catch(() => setMenu(null));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function showToast(m: string) {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1700);
  }

  function go(s: string) {
    setScreen(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ===== PIZZA =====
  function resetBuild() {
    setSize(null); setSizePrice(0); setMam(false); setF1(null); setF2(null); setBorder(null); setBorderPrice(0);
  }
  function goPizza() { go("sc-qty"); }
  function setPizzaQty(q: number) {
    setPlan(q === 0 ? { total: 0, current: 1, openEnded: true } : { total: q, current: 1, openEnded: false });
    resetBuild();
    go("sc-build");
  }
  function pizzasNoCarrinho() { return cart.filter((c) => c.kind === "pizza").length; }

  function pickSize(code: string) {
    const s = menu!.sizes.find((x) => x.code === code)!;
    setSize(code); setSizePrice(s.price);
  }
  function toggleMam() {
    setMam(!mam); setF1(null); setF2(null);
  }
  function pickFlavor(f: string) {
    if (!mam) { setF1(f); return; }
    if (f1 === f) { setF1(f2); setF2(null); }
    else if (f2 === f) { setF2(null); }
    else if (!f1) setF1(f);
    else if (!f2) setF2(f);
    else setF2(f);
  }
  const flavorOk = mam ? !!(f1 && f2) : !!f1;
  const buildOk = !!size && flavorOk;

  function pickBorder(idx: string) {
    if (idx === "") { setBorder(null); setBorderPrice(0); }
    else { const b = menu!.borders[+idx]; setBorder(b.label); setBorderPrice(bigBorder(size!) ? b.priceLarge : b.priceSmall); }
  }
  function addPizza() {
    const flavor = mam ? `${f1} / ${f2}` : f1;
    const newItem: CartItem = {
      emoji: "🍕", kind: "pizza",
      name: `Pizza ${size}${mam ? " (meio a meio)" : ""}`,
      detail: `${flavor}${border ? ` · borda ${border}` : ""}`,
      price: sizePrice + borderPrice, qty: 1,
    };
    const newCart = [...cart, newItem];
    setCart(newCart);
    const feitas = newCart.filter((c) => c.kind === "pizza").length;
    if (!plan.openEnded && plan.current < plan.total) {
      setPlan({ ...plan, current: plan.current + 1 });
      showToast(`Pizza pronta! Bora a ${plan.current + 1} 🍕`);
      resetBuild();
      go("sc-build");
    } else if (plan.openEnded) {
      showToast("Pizza adicionada! 🍕");
      go("sc-another");
    } else {
      showToast("Tudo pronto! 🍕");
      go("sc-cart");
    }
  }
  function addAnother() {
    setPlan({ total: 0, current: pizzasNoCarrinho() + 1, openEnded: true });
    resetBuild();
    go("sc-build");
  }

  // ===== SIMPLES =====
  function goCat(cat: "lanche" | "bebida" | "suco") { setListCat(cat); go("sc-list"); }
  function addSimple(it: { name: string; price: number }, emoji: string) {
    const ex = cart.find((c) => c.kind === "simple" && c.name === it.name);
    if (ex) {
      setCart(cart.map((c) => (c === ex ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      setCart([...cart, { emoji, kind: "simple", name: it.name, detail: "", price: it.price, qty: 1 }]);
    }
    showToast(`${it.name} adicionado!`);
  }

  // ===== CARRINHO =====
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  function chQty(idx: number, d: number) {
    setCart(cart.map((c, i) => (i === idx ? { ...c, qty: Math.max(1, c.qty + d) } : c)));
  }
  function rmItem(idx: number) {
    const nc = cart.filter((_, i) => i !== idx);
    setCart(nc);
    if (nc.length === 0) go("sc-start");
  }

  // ===== ENTREGA =====
  const fee = delType === "delivery" && bairroIdx !== "" ? menu!.neighborhoods[+bairroIdx].fee : 0;
  const delOk = delType === "retirada" || (delType === "delivery" && bairroIdx !== "");
  const payOk = !!nome.trim() && !!payment;

  // ===== ENVIAR =====
  async function finish() {
    if (sending) return;
    setSending(true);
    const payload = {
      cliente: nome.trim(),
      itens: cart.map((c) => ({ kind: c.kind, name: c.name, detail: c.detail, price: c.price, qty: c.qty })),
      tipoEntrega: delType,
      bairro: delType === "delivery" ? menu!.neighborhoods[+bairroIdx].name : undefined,
      endereco: delType === "delivery" ? rua : undefined,
      taxaEntrega: fee,
      pagamento: payment,
      troco: payment === "Dinheiro" && troco ? troco : undefined,
    };
    try {
      const r = await fetch("/api/pedido-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data.ok) { go("sc-done"); }
      else { showToast("Erro ao enviar. Tente de novo."); }
    } catch {
      showToast("Sem conexão. Tente de novo.");
    } finally {
      setSending(false);
    }
  }
  function resetAll() {
    setCart([]); resetBuild(); setDelType(null); setBairroIdx(""); setRua(""); setNome(""); setPayment(null); setTroco("");
    go("sc-start");
  }

  // ===== STEPPER =====
  const stepMap: Record<string, number> = { "sc-start": 0, "sc-qty": 0, "sc-build": 0, "sc-border": 0, "sc-another": 0, "sc-list": 0, "sc-cart": 0, "sc-delivery": 1, "sc-pay": 2, "sc-done": 2 };
  const stepIdx = stepMap[screen] ?? 0;
  const STEPS = ["Itens", "Entrega", "Pagar"];

  // contexto pizza
  const feitas = pizzasNoCarrinho();
  let ctxBadge = "", ctxTxt = "", ctxDots: { cls: string }[] = [];
  if (plan.openEnded) {
    ctxBadge = `Pizza ${feitas + 1}`;
    ctxTxt = feitas === 0 ? "Sua 1ª pizza" : `${feitas} já no carrinho`;
  } else if (plan.total > 0) {
    ctxBadge = `Pizza ${plan.current} de ${plan.total}`;
    ctxTxt = `Montando a pizza ${plan.current}`;
    for (let i = 1; i <= plan.total; i++) ctxDots.push({ cls: i < plan.current ? "done" : i === plan.current ? "cur" : "" });
  }

  if (!menu) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#171210", color: "#f6efe7", fontFamily: "system-ui" }}>
        Carregando cardápio… 🍕
      </div>
    );
  }

  const PizzaCtx = () =>
    (ctxBadge ? (
      <div className="pizza-ctx">
        <span className="pc-badge">{ctxBadge}</span>
        <span className="pc-txt" dangerouslySetInnerHTML={{ __html: ctxTxt }} />
        {ctxDots.length > 0 && <span className="pizza-dots">{ctxDots.map((d, i) => <span key={i} className={`pd ${d.cls}`} />)}</span>}
      </div>
    ) : null);

  return (
    <>
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="head-row">
            <div className="logo"><div className="logo-mark">🍕</div><div><h1>Chefe da Pizza</h1><p>Alto Alegre do MA</p></div></div>
            <button className="theme-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Trocar tema">{theme === "dark" ? "🌙" : "☀️"}</button>
          </div>
          <div className="status"><span className="dot" /> Aberto · entrega 40–60 min</div>
        </header>

        <div className="steps">
          {STEPS.map((s, i) => (
            <span key={s} style={{ display: "contents" }}>
              <div className={`step-chip ${i === stepIdx ? "active" : i < stepIdx ? "done" : ""}`}>
                <span className="num">{i < stepIdx ? "✓" : i + 1}</span>{s}
              </div>
              {i < STEPS.length - 1 && <div className={`step-line ${i < stepIdx ? "done" : ""}`} />}
            </span>
          ))}
        </div>

        <main>
          {/* INÍCIO */}
          {screen === "sc-start" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Bora montar</div><h2>O que vai ser hoje?</h2><p>Escolha por onde começar.</p></div>
              <div className="opt" onClick={goPizza}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">Pizza</div><div className="opt-desc">{menu.saltyFlavors.length} salgadas, {menu.sweetFlavors.length} doces · meio a meio</div></div><div className="opt-price">{money(menu.sizes[0].price)}+</div></div>
              <div className="opt" onClick={() => goCat("lanche")}><div className="opt-emoji">🥪</div><div className="opt-body"><div className="opt-title">Lanches & Porções</div><div className="opt-desc">Calzone, X-burguer, batata…</div></div></div>
              <div className="opt" onClick={() => goCat("bebida")}><div className="opt-emoji">🥤</div><div className="opt-body"><div className="opt-title">Bebidas</div><div className="opt-desc">Refri, guaraná, água, cerveja</div></div></div>
              <div className="opt" onClick={() => goCat("suco")}><div className="opt-emoji">🧃</div><div className="opt-body"><div className="opt-title">Sucos naturais</div><div className="opt-desc">Cajá, caju, maracujá…</div></div></div>
            </section>
          )}

          {/* QUANTAS */}
          {screen === "sc-qty" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Pizza</div><h2>Quantas pizzas?</h2><p>Pode mudar depois, fica tranquilo.</p></div>
              <div className="grid2">
                <div className="opt" onClick={() => setPizzaQty(1)}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">1 pizza</div></div></div>
                <div className="opt" onClick={() => setPizzaQty(2)}><div className="opt-emoji">🍕🍕</div><div className="opt-body"><div className="opt-title">2 pizzas</div></div></div>
                <div className="opt" onClick={() => setPizzaQty(3)}><div className="opt-emoji">🍕🍕🍕</div><div className="opt-body"><div className="opt-title">3 pizzas</div></div></div>
                <div className="opt" onClick={() => setPizzaQty(0)}><div className="opt-emoji">➕</div><div className="opt-body"><div className="opt-title">Vou adicionando</div></div></div>
              </div>
              <div className="btn-row"><button className="btn btn-ghost btn-sm" onClick={() => go("sc-start")}>Voltar</button></div>
            </section>
          )}

          {/* MONTAR */}
          {screen === "sc-build" && (
            <section className="screen active">
              <PizzaCtx />
              <div className="screen-head"><div className="eyebrow">Monte sua pizza</div><h2>Tamanho e sabor</h2></div>
              <div className="section-label">📏 Tamanho</div>
              <div className="grid2">
                {menu.sizes.map((s) => (
                  <div key={s.code} className={`opt ${size === s.code ? "sel" : ""}`} onClick={() => pickSize(s.code)}>
                    <div className="opt-check" />
                    <div className="opt-emoji">🍕</div>
                    <div className="opt-body"><div className="opt-title">{s.label}</div><div className="opt-desc">{money(s.price)}</div></div>
                  </div>
                ))}
              </div>
              <div className="section-label">🍕 Sabor</div>
              <div className={`mam ${mam ? "on" : ""}`} onClick={toggleMam}>
                <div className="mam-txt"><strong>Meio a meio</strong><p>Dois sabores numa pizza</p></div>
                <div className="switch" />
              </div>
              {mam && <div className="half-hint show">{!f1 ? "Toque na 1ª metade" : !f2 ? `1ª: ${f1} — agora a 2ª` : `✓ ${f1} / ${f2}`}</div>}
              <div className="section-label">Salgadas</div>
              {menu.saltyFlavors.map((f) => (
                <div key={f} className={`opt ${f === f1 || f === f2 ? "sel" : ""}`} onClick={() => pickFlavor(f)}>
                  <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div></div><div className="opt-check" />
                </div>
              ))}
              <div className="section-label">Doces</div>
              {menu.sweetFlavors.map((f) => (
                <div key={f} className={`opt ${f === f1 || f === f2 ? "sel" : ""}`} onClick={() => pickFlavor(f)}>
                  <div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">{f}</div></div><div className="opt-check" />
                </div>
              ))}
              <div className="btn-row">
                <button className="btn btn-ghost btn-back" onClick={() => go("sc-qty")}>←</button>
                <button className="btn btn-sm" disabled={!buildOk} onClick={() => go("sc-border")}>Escolher borda</button>
              </div>
            </section>
          )}

          {/* BORDA */}
          {screen === "sc-border" && (
            <section className="screen active">
              <PizzaCtx />
              <div className="screen-head"><div className="eyebrow">Quase pronta</div><h2>Borda recheada?</h2><p>Opcional.</p></div>
              <div className={`opt ${border === null ? "sel" : ""}`} onClick={() => pickBorder("")}>
                <div className="opt-emoji">⭕</div><div className="opt-body"><div className="opt-title">Sem borda</div><div className="opt-desc">Tradicional</div></div><div className="opt-price">Grátis</div><div className="opt-check" />
              </div>
              {menu.borders.map((b, i) => {
                const p = bigBorder(size!) ? b.priceLarge : b.priceSmall;
                return (
                  <div key={i} className={`opt ${border === b.label ? "sel" : ""}`} onClick={() => pickBorder(String(i))}>
                    <div className="opt-emoji">🧀</div><div className="opt-body"><div className="opt-title">{b.label}</div></div><div className="opt-price">+{money(p)}</div><div className="opt-check" />
                  </div>
                );
              })}
              <div className="btn-row">
                <button className="btn btn-ghost btn-back" onClick={() => go("sc-build")}>←</button>
                <button className="btn btn-sm" onClick={addPizza}>Adicionar ao pedido</button>
              </div>
            </section>
          )}

          {/* OUTRA */}
          {screen === "sc-another" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Pizza adicionada ✓</div><h2>Mais uma pizza?</h2><p>{pizzasNoCarrinho()} pizza{pizzasNoCarrinho() > 1 ? "s" : ""} no pedido</p></div>
              <div className="opt" onClick={addAnother}><div className="opt-emoji">🍕</div><div className="opt-body"><div className="opt-title">Montar outra pizza</div></div></div>
              <div className="opt" onClick={() => go("sc-start")}><div className="opt-emoji">🥤</div><div className="opt-body"><div className="opt-title">Adicionar bebida ou lanche</div></div></div>
              <div className="opt" onClick={() => go("sc-cart")}><div className="opt-emoji">✅</div><div className="opt-body"><div className="opt-title">Pronto, ver meu pedido</div></div></div>
            </section>
          )}

          {/* LISTA SIMPLES */}
          {screen === "sc-list" && (
            <section className="screen active">
              {(() => {
                const cfg = {
                  lanche: { eb: "Lanches & Porções", t: "Escolha seu lanche", data: menu.lanches, emoji: "🍽️" },
                  bebida: { eb: "Bebidas", t: "Bebidas geladas", data: menu.bebidas, emoji: "🥤" },
                  suco: { eb: "Sucos naturais", t: "Sucos da casa", data: menu.sucos, emoji: "🧃" },
                }[listCat];
                return (
                  <>
                    <div className="screen-head"><div className="eyebrow">{cfg.eb}</div><h2>{cfg.t}</h2><p>Toque para adicionar.</p></div>
                    {cfg.data.map((it, i) => (
                      <div key={i} className="opt" onClick={() => addSimple(it, cfg.emoji)}>
                        <div className="opt-emoji">{cfg.emoji}</div><div className="opt-body"><div className="opt-title">{it.name}</div></div><div className="opt-price">{money(it.price)}</div>
                      </div>
                    ))}
                    <div className="btn-row"><button className="btn btn-ghost btn-sm" onClick={() => go("sc-start")}>Voltar ao início</button></div>
                  </>
                );
              })()}
            </section>
          )}

          {/* CARRINHO */}
          {screen === "sc-cart" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Seu pedido</div><h2>Confira tudo</h2></div>
              {cart.length === 0 ? (
                <div className="empty"><div className="big">🛒</div><div>Seu pedido está vazio.</div></div>
              ) : (
                <>
                  {(() => { let pn = 0; return cart.map((it, i) => {
                    let tag = null;
                    if (it.kind === "pizza") { pn++; tag = <span className="ci-tag">Pizza {pn}</span>; }
                    const nm = it.kind === "pizza" ? it.name.replace(/^Pizza /, "") : it.name;
                    return (
                      <div key={i} className="cart-item">
                        <div className="ci-emoji">{it.emoji}</div>
                        <div className="ci-body">
                          <div className="ci-name">{tag}{nm}{it.qty > 1 ? ` ×${it.qty}` : ""}</div>
                          {it.detail && <div className="ci-detail">{it.detail}</div>}
                          <div className="ci-price">{money(it.price * it.qty)}</div>
                          {it.kind === "simple" && (
                            <div className="qty-pill"><button onClick={() => chQty(i, -1)}>−</button><span>{it.qty}</span><button onClick={() => chQty(i, 1)}>+</button></div>
                          )}
                        </div>
                        <button className="ci-remove" onClick={() => rmItem(i)}>✕</button>
                      </div>
                    );
                  }); })()}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 4px 4px", fontFamily: "Fraunces,serif", fontWeight: 900, fontSize: 20 }}>
                    <span>Subtotal</span><span>{money(cartTotal)}</span>
                  </div>
                </>
              )}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => go("sc-start")}>+ Adicionar mais</button>
              {cart.length > 0 && <button className="btn" style={{ marginTop: 11 }} onClick={() => go("sc-delivery")}>Ir para entrega</button>}
            </section>
          )}

          {/* ENTREGA */}
          {screen === "sc-delivery" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Entrega</div><h2>Como prefere receber?</h2></div>
              <div className={`opt ${delType === "delivery" ? "sel" : ""}`} onClick={() => setDelType("delivery")}><div className="opt-emoji">🛵</div><div className="opt-body"><div className="opt-title">Entrega (delivery)</div><div className="opt-desc">Levamos até você</div></div><div className="opt-check" /></div>
              <div className={`opt ${delType === "retirada" ? "sel" : ""}`} onClick={() => { setDelType("retirada"); setBairroIdx(""); }}><div className="opt-emoji">🏪</div><div className="opt-body"><div className="opt-title">Buscar na loja</div><div className="opt-desc">Sem taxa de entrega</div></div><div className="opt-check" /></div>
              {delType === "delivery" && (
                <div>
                  <div className="section-label">Endereço</div>
                  <div className="field"><label>Bairro</label>
                    <select value={bairroIdx} onChange={(e) => setBairroIdx(e.target.value)}>
                      <option value="">Selecione o bairro…</option>
                      {menu.neighborhoods.map((b, i) => <option key={i} value={i}>{b.name} — {money(b.fee)}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Rua, número e referência</label><input value={rua} onChange={(e) => setRua(e.target.value)} placeholder="Rua das Flores, 123 — perto do mercado" /></div>
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn-ghost btn-back" onClick={() => go("sc-cart")}>←</button>
                <button className="btn btn-sm" disabled={!delOk} onClick={() => go("sc-pay")}>Continuar</button>
              </div>
            </section>
          )}

          {/* PAGAMENTO */}
          {screen === "sc-pay" && (
            <section className="screen active">
              <div className="screen-head"><div className="eyebrow">Pagamento</div><h2>Quase lá!</h2></div>
              <div className="field"><label>Seu nome</label><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como te chamamos?" /></div>
              <div className="section-label">Forma de pagamento</div>
              {menu.payments.map((p) => {
                const e: Record<string, string> = { Pix: "⚡", Dinheiro: "💵", Cartao: "💳" };
                return (
                  <div key={p} className={`opt ${payment === p ? "sel" : ""}`} onClick={() => setPayment(p)}>
                    <div className="opt-emoji">{e[p] || "💰"}</div><div className="opt-body"><div className="opt-title">{p === "Cartao" ? "Cartão" : p}</div></div><div className="opt-check" />
                  </div>
                );
              })}
              {payment === "Dinheiro" && <div className="field" style={{ marginTop: 8 }}><label>Troco para quanto?</label><input value={troco} onChange={(e) => setTroco(e.target.value)} inputMode="numeric" placeholder="Ex: 50" /></div>}
              <div className="btn-row">
                <button className="btn btn-ghost btn-back" onClick={() => go("sc-delivery")}>←</button>
                <button className="btn btn-sm" disabled={!payOk || sending} onClick={finish}>{sending ? "Enviando…" : "Enviar pedido"}</button>
              </div>
            </section>
          )}

          {/* SUCESSO */}
          {screen === "sc-done" && (
            <section className="screen active">
              <div className="success">
                <div className="check">✓</div>
                <h2>Pedido enviado!</h2>
                <p>Valeu, {nome.split(" ")[0]}! 🍕</p>
                <p>A pizzaria já recebeu e vai preparar.</p>
                <button className="btn" style={{ marginTop: 22 }} onClick={resetAll}>Fazer outro pedido</button>
              </div>
            </section>
          )}
        </main>
      </div>

      {cartCount > 0 && screen !== "sc-done" && (
        <div className="cartbar show">
          <div className="cartbar-inner">
            <div className="cartbar-info"><div className="cartbar-count">{cartCount} {cartCount === 1 ? "item" : "itens"}</div><div className="cartbar-total">{money(cartTotal)}</div></div>
            <button className="btn" onClick={() => go("sc-cart")}>Ver pedido</button>
          </div>
        </div>
      )}
      {toast && <div className="toast show">{toast}</div>}
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,900&family=DM+Sans:wght@400;500;600;700&display=swap');
:root[data-theme="dark"]{--bg:#171210;--surface:#221b18;--surface2:#2c2320;--text:#f6efe7;--text-sub:#a89a8b;--text-faint:#6f655c;--brand:#f0512f;--brand-press:#d2421f;--brand-soft:rgba(240,81,47,.13);--gold:#edb24a;--green:#62a256;--green-soft:rgba(98,162,86,.16);--line:rgba(246,239,231,.08);--line-strong:rgba(246,239,231,.16);--shadow-sm:0 2px 10px rgba(0,0,0,.25);}
:root[data-theme="light"]{--bg:#f7f2ea;--surface:#fff;--surface2:#fbf6ee;--text:#2a1d16;--text-sub:#8a7a6c;--text-faint:#b3a596;--brand:#e8472b;--brand-press:#c2371f;--brand-soft:rgba(232,71,43,.09);--gold:#c98a17;--green:#4f8a43;--green-soft:rgba(79,138,67,.12);--line:rgba(42,29,22,.08);--line-strong:rgba(42,29,22,.14);--shadow-sm:0 2px 12px rgba(120,80,40,.08);}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;overflow-x:hidden;padding-bottom:104px;transition:background .35s,color .35s}
.wrap{max-width:540px;margin:0 auto;min-height:100vh;position:relative}
header{background:var(--surface);padding:18px 20px;position:sticky;top:0;z-index:40;border-bottom:1px solid var(--line);transition:background .35s}
.head-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.logo{display:flex;align-items:center;gap:11px}
.logo-mark{width:42px;height:42px;border-radius:13px;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:0 4px 14px var(--brand-soft)}
.logo h1{font-family:'Fraunces',serif;font-weight:900;font-size:21px;letter-spacing:-.5px;line-height:1}
.logo p{font-size:12px;color:var(--text-sub);margin-top:2px}
.theme-btn{width:40px;height:40px;border-radius:12px;border:1px solid var(--line-strong);background:var(--surface2);color:var(--text);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s}
.theme-btn:active{transform:scale(.92)}
.status{display:inline-flex;align-items:center;gap:7px;margin-top:13px;background:var(--green-soft);color:var(--green);padding:5px 11px;border-radius:20px;font-size:12px;font-weight:600}
.status .dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 var(--green-soft)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.steps{display:flex;gap:8px;padding:16px 20px 2px;align-items:center}
.step-chip{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--text-faint)}
.step-chip .num{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line-strong);display:flex;align-items:center;justify-content:center;font-size:11px;transition:.25s}
.step-chip.active{color:var(--text)}
.step-chip.active .num{background:var(--brand);border-color:var(--brand);color:#fff}
.step-chip.done{color:var(--green)}
.step-chip.done .num{background:var(--green);border-color:var(--green);color:#fff}
.step-line{flex:1;height:1.5px;background:var(--line);border-radius:2px}
.step-line.done{background:var(--green)}
main{padding:6px 20px 20px}
.screen.active{display:block;animation:slide .4s cubic-bezier(.2,.8,.2,1)}
@keyframes slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
.screen-head{margin:16px 0 18px}
.eyebrow{font-size:11.5px;font-weight:700;color:var(--brand);text-transform:uppercase;letter-spacing:1.2px}
.screen-head h2{font-family:'Fraunces',serif;font-weight:600;font-size:25px;letter-spacing:-.4px;margin-top:5px;line-height:1.15}
.screen-head p{font-size:14px;color:var(--text-sub);margin-top:6px}
.pizza-ctx{display:flex;align-items:center;gap:11px;background:var(--brand-soft);border-radius:14px;padding:12px 15px;margin:16px 0 2px}
.pc-badge{background:var(--brand);color:#fff;font-weight:700;font-size:12px;padding:5px 11px;border-radius:20px;white-space:nowrap}
.pc-txt{font-size:13px;color:var(--text-sub);flex:1}
.pc-txt strong{color:var(--text);font-weight:600}
.pizza-dots{display:flex;gap:5px}
.pd{width:7px;height:7px;border-radius:50%;background:var(--line-strong)}
.pd.done{background:var(--green)}.pd.cur{background:var(--brand);transform:scale(1.3)}
.opt{background:var(--surface);border:1.5px solid var(--line);border-radius:16px;padding:16px;margin-bottom:11px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:transform .14s,border-color .14s,background .14s;box-shadow:var(--shadow-sm)}
.opt:active{transform:scale(.98)}
.opt.sel{border-color:var(--brand);background:var(--brand-soft)}
.opt-emoji{font-size:27px;flex:0 0 auto;width:32px;text-align:center}
.opt-body{flex:1;min-width:0}
.opt-title{font-weight:600;font-size:15.5px}
.opt-desc{font-size:12.5px;color:var(--text-sub);margin-top:2px;line-height:1.35}
.opt-price{font-weight:700;font-size:14.5px;color:var(--gold);white-space:nowrap}
.opt-check{width:23px;height:23px;border-radius:50%;border:2px solid var(--line-strong);flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;transition:.16s}
.opt.sel .opt-check{background:var(--brand);border-color:var(--brand)}
.opt.sel .opt-check::after{content:"✓"}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.grid2 .opt{flex-direction:column;align-items:flex-start;gap:7px;padding:17px;position:relative}
.grid2 .opt-check{position:absolute;top:13px;right:13px;width:20px;height:20px}
.grid2 .opt-emoji{width:auto}
.section-label{font-size:12px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:.8px;margin:20px 0 10px;display:flex;align-items:center;gap:7px}
.mam{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1.5px solid var(--line);border-radius:16px;padding:15px 16px;margin-bottom:14px;cursor:pointer;box-shadow:var(--shadow-sm)}
.mam.on{border-color:var(--brand);background:var(--brand-soft)}
.mam-txt strong{font-weight:600;font-size:15px}
.mam-txt p{font-size:12px;color:var(--text-sub);margin-top:1px}
.switch{width:48px;height:28px;border-radius:20px;background:var(--line-strong);position:relative;flex:0 0 auto;transition:.22s}
.switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.22s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.mam.on .switch{background:var(--brand)}
.mam.on .switch::after{left:23px}
.half-hint{font-size:13px;color:var(--gold);margin:-4px 0 12px;font-weight:600;padding-left:2px}
.btn{width:100%;background:var(--brand);color:#fff;border:none;border-radius:15px;padding:17px;font-family:'DM Sans';font-size:15.5px;font-weight:700;cursor:pointer;transition:transform .14s,background .14s;box-shadow:0 6px 18px var(--brand-soft)}
.btn:active{transform:scale(.98);background:var(--brand-press)}
.btn:disabled{opacity:.35;box-shadow:none;cursor:not-allowed}
.btn-ghost{background:transparent;border:1.5px solid var(--line-strong);color:var(--text);box-shadow:none}
.btn-row{display:flex;gap:11px;margin-top:16px}
.btn-row .btn{margin:0}
.btn-sm{padding:15px;font-size:14.5px}
.btn-back{flex:0 0 auto;width:54px;padding:15px 0}
.cart-item{background:var(--surface);border:1px solid var(--line);border-radius:15px;padding:14px 15px;margin-bottom:10px;display:flex;gap:12px;align-items:flex-start;box-shadow:var(--shadow-sm)}
.ci-emoji{font-size:23px}
.ci-body{flex:1;min-width:0}
.ci-tag{background:var(--brand-soft);color:var(--brand);font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;margin-right:7px}
.ci-name{font-weight:600;font-size:14.5px}
.ci-detail{font-size:12.5px;color:var(--text-sub);margin-top:3px}
.ci-price{font-weight:700;color:var(--gold);font-size:14px;margin-top:5px}
.ci-remove{background:none;border:none;color:var(--text-faint);font-size:18px;cursor:pointer;padding:2px 4px;line-height:1}
.qty-pill{display:inline-flex;align-items:center;gap:14px;background:var(--surface2);border:1px solid var(--line);border-radius:30px;padding:5px 7px;margin-top:9px}
.qty-pill button{width:30px;height:30px;border-radius:50%;border:none;background:var(--brand);color:#fff;font-size:18px;cursor:pointer;font-weight:700}
.qty-pill span{font-weight:700;min-width:20px;text-align:center}
.field{margin-bottom:14px}
.field label{display:block;font-size:13px;font-weight:600;margin-bottom:7px}
.field input,.field select{width:100%;background:var(--surface);border:1.5px solid var(--line-strong);border-radius:13px;padding:14px;color:var(--text);font-family:'DM Sans';font-size:15px;transition:.16s}
.field input:focus,.field select:focus{outline:none;border-color:var(--brand)}
.cartbar{position:fixed;bottom:0;left:0;right:0;z-index:50;background:var(--surface);border-top:1px solid var(--line);padding:14px 20px;box-shadow:0 -6px 24px rgba(0,0,0,.12)}
.cartbar-inner{max-width:540px;margin:0 auto;display:flex;align-items:center;gap:14px}
.cartbar-info{flex:1}
.cartbar-count{font-size:12px;color:var(--text-sub);font-weight:600}
.cartbar-total{font-family:'Fraunces',serif;font-weight:900;font-size:22px;line-height:1.1}
.cartbar .btn{margin:0;width:auto;padding:15px 24px}
.empty{text-align:center;padding:54px 20px;color:var(--text-sub)}
.empty .big{font-size:56px;margin-bottom:14px;opacity:.4}
.success{text-align:center;padding:34px 8px}
.success .check{width:80px;height:80px;border-radius:50%;background:var(--green);margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:42px;color:#fff;animation:pop .55s cubic-bezier(.2,1.4,.4,1)}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
.success h2{font-family:'Fraunces',serif;font-weight:600;font-size:27px;margin-bottom:9px}
.success p{color:var(--text-sub);font-size:14.5px;margin-bottom:5px}
.toast{position:fixed;bottom:116px;left:50%;transform:translateX(-50%);background:var(--green);color:#fff;padding:12px 22px;border-radius:30px;font-size:13.5px;font-weight:600;z-index:60;white-space:nowrap}
`;
