import type { ReactNode } from "react";
import SalaoOperacaoNav from "@/components/SalaoOperacaoNav";
import SalaoSessionGate from "@/components/SalaoSessionGate";

export default function SalaoLayout({ children }: { children: ReactNode }) {
  return (
    <SalaoSessionGate>
      {children}
      <SalaoOperacaoNav />
    </SalaoSessionGate>
  );
}
