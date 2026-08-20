"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReceiptText } from "lucide-react";

export default function PedidosSalaoNav() {
  const pathname = usePathname();
  if (pathname !== "/pedidos" && pathname !== "/pedidos/salao") return null;
  if (pathname === "/pedidos/salao") return null;

  return (
    <Link
      href="/pedidos/salao"
      style={{
        position: "fixed",
        right: 18,
        bottom: "calc(18px + env(safe-area-inset-bottom))",
        zIndex: 70,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        minHeight: 42,
        padding: "0 13px",
        borderRadius: 12,
        background: "var(--surface)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        boxShadow: "0 10px 28px rgba(0,0,0,.16)",
        textDecoration: "none",
        fontSize: 12.5,
        fontWeight: 900,
      }}
    >
      <ReceiptText size={16} /> Caixa do Salão
    </Link>
  );
}
