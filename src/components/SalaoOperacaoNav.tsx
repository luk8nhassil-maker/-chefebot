"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, UtensilsCrossed } from "lucide-react";

export default function SalaoOperacaoNav() {
  const pathname = usePathname();
  if (pathname === "/salao/login" || pathname.startsWith("/salao/comanda/")) return null;
  if (pathname !== "/salao" && pathname !== "/salao/operacao") return null;

  const operacao = pathname === "/salao/operacao";
  return (
    <Link
      href={operacao ? "/salao" : "/salao/operacao"}
      style={{
        position: "fixed",
        right: 16,
        top: "calc(12px + env(safe-area-inset-top))",
        zIndex: 80,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minHeight: 40,
        padding: "0 12px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--foreground)",
        boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        textDecoration: "none",
        fontSize: 12.5,
        fontWeight: 900,
      }}
    >
      {operacao ? <UtensilsCrossed size={16} /> : <ClipboardList size={16} />}
      {operacao ? "Fazer pedido" : "Operação"}
    </Link>
  );
}
