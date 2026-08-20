import type { ReactNode } from "react";
import SalaoOperacaoNav from "@/components/SalaoOperacaoNav";
import SalaoSessionGate from "@/components/SalaoSessionGate";

export default function SalaoLayout({ children }: { children: ReactNode }) {
  return (
    <SalaoSessionGate>
      <style>{`.sal-shell a[href^="/pedidos/"][href$="/imprimir"]{display:none!important}`}</style>
      {children}
      <SalaoOperacaoNav />
    </SalaoSessionGate>
  );
}
