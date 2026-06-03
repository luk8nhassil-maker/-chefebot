"use client";

import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const cookie = document.cookie.split(";").find(c => c.trim().startsWith("auth-user="));
    if (cookie) {
      try {
        const raw = cookie.split("=").slice(1).join("=");
        const user = JSON.parse(decodeURIComponent(decodeURIComponent(raw)));
        if (user.role === "admin") setIsAdmin(true);
      } catch {}
    }

    fetch("/api/orders")
      .then(r => {
        if (r.status === 401) return null;
        return r.json();
      })
      .then(data => {
        if (data) setPedidos(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const hoje = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const pedidosHoje = pedidos.length;
  const faturamento = pedidos
    .filter(p => p.status !== "cancelado")
    .reduce((sum, p) => sum + p.total, 0);
  const ativos = pedidos.filter(p => !["entregue", "cancelado"].includes(p.status)).length;

  const saboresCount: Record<string, number> = {};
  pedidos.forEach(p => {
    p.itens.forEach(item => {
      const sabor = item.replace(/Pizza\s+/, "").replace(/\s+[PMGF]$/, "").replace(/\s+\+.*$/, "").trim();
      saboresCount[sabor] = (saboresCount[sabor] || 0) + 1;
    });
  });
  const saboresMais = Object.entries(saboresCount).sort((a, b) => b[1] - a[1]);
  const topSabor = saboresMais[0]?.[0] || "—";

  const tempoMedio = ativos > 0 ? "35 min" : "—";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar currentPage="dashboard" />

      <main className="flex-1 max-w-7xl mx-auto px-4 py-12 w-full">
        <div className="text-center mb-12">
          <div className="text-6xl mb-4">🍕</div>
          <h2 className="text-4xl font-bold text-gray-800 mb-3">Sistema ChefBot</h2>
          <p className="text-gray-500 text-lg max-w-xl mx-auto">
            Plataforma de atendimento automático via WhatsApp para a{" "}
            <strong>Chefe da Pizza</strong>
          </p>
        </div>

        {/* Métricas reais */}
        <div className="mt-0 mb-10 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
            <div className="text-2xl mb-1">📦</div>
            <div className="text-xl font-bold text-gray-800">
              {loading ? "..." : pedidosHoje}
            </div>
            <div className="text-xs text-gray-400 mt-1">Pedidos hoje</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
            <div className="text-2xl mb-1">💰</div>
            <div className="text-xl font-bold text-gray-800">
              {loading ? "..." : `R$ ${faturamento.toFixed(2)}`}
            </div>
            <div className="text-xs text-gray-400 mt-1">Faturamento</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
            <div className="text-2xl mb-1">⭐</div>
            <div className="text-xl font-bold text-gray-800" style={{ fontSize: topSabor.length > 10 ? "13px" : undefined }}>
              {loading ? "..." : topSabor}
            </div>
            <div className="text-xs text-gray-400 mt-1">Sabor mais pedido</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
            <div className="text-2xl mb-1">🔥</div>
            <div className="text-xl font-bold text-gray-800">
              {loading ? "..." : ativos}
            </div>
            <div className="text-xs text-gray-400 mt-1">Pedidos ativos</div>
          </div>
        </div>

        {/* Cards de navegação */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Link href="/simulador">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md hover:border-green-200 transition cursor-pointer group">
              <div className="text-4xl mb-3">💬</div>
              <h3 className="font-bold text-gray-800 text-lg mb-2 group-hover:text-green-700 transition">
                Simulador de Bot
              </h3>
              <p className="text-gray-500 text-sm">
                Simule conversas com o ChefBot e teste o fluxo completo de pedidos via WhatsApp.
              </p>
              <div className="mt-4 inline-flex items-center text-green-600 text-sm font-medium gap-1">
                Abrir simulador
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>

          <Link href="/pedidos">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md hover:border-blue-200 transition cursor-pointer group">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="font-bold text-gray-800 text-lg mb-2 group-hover:text-blue-700 transition">
                Gestão de Pedidos
              </h3>
              <p className="text-gray-500 text-sm">
                Painel com todos os pedidos em tempo real, status e histórico.
              </p>
              <div className="mt-4 inline-flex items-center text-blue-600 text-sm font-medium gap-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Atendente ou Admin
              </div>
            </div>
          </Link>

          {isAdmin && (
            <Link href="/relatorios">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md hover:border-purple-200 transition cursor-pointer group">
                <div className="text-4xl mb-3">📊</div>
                <h3 className="font-bold text-gray-800 text-lg mb-2 group-hover:text-purple-700 transition">
                  Relatórios
                </h3>
                <p className="text-gray-500 text-sm">
                  Análise de vendas, sabores mais pedidos, horários de pico e faturamento.
                </p>
                <div className="mt-4 inline-flex items-center text-purple-600 text-sm font-medium gap-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Somente Admin
                </div>
              </div>
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}