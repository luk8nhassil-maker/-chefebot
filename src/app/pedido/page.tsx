"use client";
import { useState, useEffect } from "react";
import { PublicCardapio, type MenuType } from "@/app/cardapio/page";

export default function PedidoPage() {
  const [menu, setMenu] = useState<MenuType | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    fetch("/api/cardapio")
      .then((r) => { if (!r.ok) throw new Error("api error"); return r.json(); })
      .then((data) => {
        if (data && typeof data === "object") setMenu(data);
        else setErro(true);
      })
      .catch(() => setErro(true));
  }, []);

  if (erro) return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "#060606", color: "#f5f2ee", fontFamily: "system-ui", padding: 24 }}>
      <div style={{ fontSize: 40 }}>🍕</div>
      <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Não foi possível carregar o cardápio.</p>
      <button onClick={() => { setErro(false); fetch("/api/cardapio").then(r => r.json()).then(setMenu).catch(() => setErro(true)); }} style={{ border: "1px solid #333", background: "transparent", color: "#f5f2ee", padding: "10px 20px", borderRadius: 10, cursor: "pointer", fontSize: 14 }}>Tentar de novo</button>
    </div>
  );

  if (!menu) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#060606", color: "#f5f2ee", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 36, marginBottom: 12 }}>🍕</div><p>Carregando cardápio…</p></div>
    </div>
  );

  return <PublicCardapio menu={menu} />;
}
