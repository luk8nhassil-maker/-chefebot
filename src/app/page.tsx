"use client";

import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { useEffect, useState } from "react";

type Status = "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";

type Pedido = {
  id: string;
  cliente: string;
  telefone: string;
  itens: string[];
  total: number;
  status: Status;
  horario: string;
  endereco: string;
};

export default function HomePage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const cookie = document.cookie.split(";").find(c => c.trim().startsWith("auth-user="));
    if (cookie) {
      try {
        const raw = cookie.split("=").slice(1).join("=");
        const user = JSON.parse(decodeURIComponent(decodeURIComponent(raw)));
        if (user.role === "admin") setIsAdmin(true);
        setIsLoggedIn(true);
      } catch {}
    }

    fetch("/api/orders")
      .then(r => { if (r.status === 401) { setLoading(false); return null; } return r.json(); })
      .then(data => { if (data) setPedidos(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const pedidosHoje = pedidos.length;
  const faturamento = pedidos.filter(p => p.status !== "cancelado").reduce((sum, p) => sum + p.total, 0);
  const ativos = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status)).length;

  const saboresCount: Record<string, number> = {};
  pedidos.forEach(p => {
    p.itens.forEach(item => {
      const sabor = item.replace(/^Pizza\s+/, "").replace(/\s+[PMGF](\s+|$)/, " ").replace(/\s+\+.*$/, "").trim();
      saboresCount[sabor] = (saboresCount[sabor] || 0) + 1;
    });
  });
  const topSabor = Object.entries(saboresCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  const stats = [
    { label: "Pedidos hoje", value: loading ? "..." : String(pedidosHoje), icon: "📦", color: "#f97316" },
    { label: "Faturamento", value: loading ? "..." : `R$ ${faturamento.toFixed(2)}`, icon: "💰", color: "#22c55e" },
    { label: "Sabor mais pedido", value: loading ? "..." : topSabor, icon: "⭐", color: "#eab308" },
    { label: "Pedidos ativos", value: loading ? "..." : String(ativos), icon: "🔥", color: "#ef4444" },
  ];

  const cards = [
    { href: "/simulador", icon: "💬", title: "Simulador de Bot", desc: "Simule conversas com o ChefBot e teste o fluxo completo de pedidos via WhatsApp.", label: "Abrir simulador", color: "#22c55e" },
    { href: "/pedidos", icon: "📋", title: "Gestão de Pedidos", desc: "Painel com todos os pedidos em tempo real, status e histórico.", label: "Atendente ou Admin", color: "#3b82f6" },
    ...(isAdmin ? [{ href: "/relatorios", icon: "📊", title: "Relatórios", desc: "Análise de vendas, sabores mais pedidos, horários de pico e faturamento.", label: "Somente Admin", color: "#a855f7" }] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #1a0a00 0%, #2d1200 40%, #1a0505 100%)", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <NavBar currentPage="dashboard" />

      <div style={{ position: "fixed", inset: 0, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(220,38,38,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(251,146,60,0.06) 0%, transparent 50%)", pointerEvents: "none", zIndex: 0 }} />

      <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "48px 24px", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: "48px" }}>
          <div style={{ width: "80px", height: "80px", background: "linear-gradient(135deg, #dc2626, #ea580c)", borderRadius: "24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "40px", margin: "0 auto 20px", boxShadow: "0 8px 32px rgba(220,38,38,0.4)" }}>🍕</div>
          <h1 style={{ color: "white", fontSize: "36px", fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.5px" }}>Sistema ChefBot</h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "15px", margin: 0 }}>
            Plataforma de atendimento automático via WhatsApp para a <span style={{ color: "rgba(251,146,60,0.8)" }}>Chefe da Pizza</span>
          </p>
        </div>

        {isLoggedIn && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "40px" }}>
            {stats.map((stat) => (
              <div key={stat.label} style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "24px 16px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>{stat.icon}</div>
                <div style={{ color: stat.color, fontSize: "22px", fontWeight: 700, marginBottom: "4px", wordBreak: "break-word" }}>{stat.value}</div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px" }}>
          {cards.map((card) => (
            <Link href={card.href} key={card.href} style={{ textDecoration: "none" }}>
              <div
                style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "24px", padding: "28px", cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.08)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.05)"; }}
              >
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>{card.icon}</div>
                <h3 style={{ color: "white", fontSize: "18px", fontWeight: 700, margin: "0 0 8px" }}>{card.title}</h3>
                <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "13px", margin: "0 0 20px", lineHeight: "1.6" }}>{card.desc}</p>
                <div style={{ color: card.color, fontSize: "13px", fontWeight: 600 }}>{card.label} →</div>
              </div>
            </Link>
          ))}
        </div>

        {!isLoggedIn && (
          <div style={{ textAlign: "center", marginTop: "40px" }}>
            <Link href="/login" style={{ display: "inline-block", background: "linear-gradient(135deg, #dc2626, #b91c1c)", color: "white", padding: "14px 32px", borderRadius: "12px", textDecoration: "none", fontWeight: 600, fontSize: "15px", boxShadow: "0 4px 16px rgba(220,38,38,0.4)" }}>
              Fazer login
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}