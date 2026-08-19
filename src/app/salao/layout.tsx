import type { ReactNode } from "react";
import SalaoOperacaoNav from "@/components/SalaoOperacaoNav";

export default function SalaoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SalaoOperacaoNav />
    </>
  );
}
