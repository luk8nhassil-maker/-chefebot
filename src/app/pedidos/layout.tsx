import type { ReactNode } from "react";
import PedidosSalaoNav from "@/components/PedidosSalaoNav";

export default function PedidosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PedidosSalaoNav />
    </>
  );
}
