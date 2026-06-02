"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AuthUser {
  name: string;
  role: "admin" | "atendente";
}

function getAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)auth-user=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

const roleLabel: Record<string, string> = {
  admin: "Admin",
  atendente: "Atendente",
};

interface NavBarProps {
  currentPage: "dashboard" | "simulador" | "pedidos" | "relatorios";
}

export function NavBar({ currentPage }: NavBarProps) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setUser(getAuthUser());
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
    router.refresh();
  }

  const linkClass = (page: string) =>
    currentPage === page
      ? "text-green-700 font-semibold border-b-2 border-green-600"
      : "text-gray-500 hover:text-gray-700 transition";

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🍕</span>
          <div>
            <h1 className="font-bold text-gray-800 text-lg leading-none">ChefBot</h1>
            <p className="text-gray-400 text-xs">Chefe da Pizza</p>
          </div>
        </div>

        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className={linkClass("dashboard")}>
            Dashboard
          </Link>
          <Link href="/simulador" className={linkClass("simulador")}>
            Simulador
          </Link>
          {user && (user.role === "admin" || user.role === "atendente") && (
            <Link href="/pedidos" className={linkClass("pedidos")}>
              Pedidos
            </Link>
          )}
          {user?.role === "admin" && (
            <Link href="/relatorios" className={linkClass("relatorios")}>
              Relatórios
            </Link>
          )}

          {user ? (
            <div className="flex items-center gap-2 ml-2 pl-3 border-l border-gray-200">
              <div className="text-right hidden sm:block">
                <div className="text-xs font-semibold text-gray-700">{user.name}</div>
                <div className="text-[10px] text-gray-400">{roleLabel[user.role]}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                style={{ touchAction: "manipulation" }}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-full transition disabled:opacity-50"
              >
                Sair
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="ml-2 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-full transition"
            >
              Entrar
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
