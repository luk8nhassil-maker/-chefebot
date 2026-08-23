import type { ReactNode } from "react";
import PedidosSalaoNav from "@/components/PedidosSalaoNav";
import SalaoCozinhaAutomatica from "@/components/SalaoCozinhaAutomatica";
import { cozinhaAutomaticaSalaoAtiva } from "@/lib/salaoCozinhaAutomatica";
import PixManualReloadGuard from "./PixManualReloadGuard";

export default function PedidosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PixManualReloadGuard />
      {children}
      <PedidosSalaoNav />
      <SalaoCozinhaAutomatica enabled={cozinhaAutomaticaSalaoAtiva(process.env.VERCEL_ENV)} />
    </>
  );
}
