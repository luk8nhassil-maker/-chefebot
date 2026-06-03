"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";

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
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const isDark = currentPage === "dashboard";

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

  const bg = isDark ? "rgba(255,255,255,0.05)" : "white";
  const border = isDark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #f0f0f0";
  const textColor = isDark ? "rgba(255,255,255,0.9)" : "#1f2937";
  const subColor = isDark ? "rgba(255,255,255,0.4)" : "#9ca3af";
  const activeColor = isDark ? "#fb923c" : "#16a34a";
  const inactiveColor = isDark ? "rgba(255,255,255,0.5)" : "#6b7280";

  const linkStyle = (page: string) => ({
    color: currentPage === page ? activeColor : inactiveColor,
    fontWeight: currentPage === page ? 600 : 400,
    textDecoration: "none",
    fontSize: "14px",
    borderBottom: currentPage === page ? `2px solid ${activeColor}` : "2px solid transparent",
    paddingBottom: "2px",
    transition: "color 0.2s",
  });

  return (
    <>
      <header style={{
        position: "fixed",
        top: 0, left: 0, right: 0,
        zIndex: 50,
        background: isDark ? "rgba(26,10,0,0.8)" : "white",
        backdropFilter: isDark ? "blur(20px)" : "none",
        borderBottom: border,
        boxShadow: isDark ? "none" : "0 1px 3px rgba(0,0,0,0.05)",
      }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px" }}>🍕</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: textColor, lineHeight: 1 }}>ChefBot</div>
              <div style={{ fontSize: "10px", color: subColor, lineHeight: 1 }}>Chefe da Pizza</div>
            </div>
          </div>

          <nav style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            <Link href="/" style={linkStyle("dashboard")}>Dashboard</Link>
            <Link href="/simulador" style={linkStyle("simulador")}>Simulador</Link>
            {user && (user.role === "admin" || user.role === "atendente") && (
              <Link href="/pedidos" style={linkStyle("pedidos")}>Pedidos</Link>
            )}
            {user?.role === "admin" && (
              <Link href="/relatorios" style={linkStyle("relatorios")}>Relatórios</Link>
            )}
            {user ? (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingLeft: "12px", borderLeft: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "#e5e7eb"}` }}>
                <div className="hidden sm:block" style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: textColor }}>{user.name}</div>
                  <div style={{ fontSize: "10px", color: subColor }}>{roleLabel[user.role]}</div>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  style={{
                    fontSize: "12px",
                    background: isDark ? "rgba(255,255,255,0.1)" : "#f3f4f6",
                    color: isDark ? "rgba(255,255,255,0.7)" : "#6b7280",
                    border: "none",
                    padding: "6px 14px",
                    borderRadius: "20px",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  Sair
                </button>
              </div>
            ) : (
              <Link href="/login" style={{
                fontSize: "12px",
                background: "linear-gradient(135deg, #dc2626, #b91c1c)",
                color: "white",
                padding: "6px 14px",
                borderRadius: "20px",
                textDecoration: "none",
                fontWeight: 600,
              }}>
                Entrar
              </Link>
            )}
          </nav>
        </div>
      </header>
      <div style={{ height: "57px" }} />
    </>
  );
}