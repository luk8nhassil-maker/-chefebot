import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import PanelShell from "@/components/PanelShell";
import FormularioFiscalCompartilhado from "../FormularioFiscalCompartilhado";

export const dynamic = "force-dynamic";
export default async function DadosFiscais() {
  const token = (await cookies()).get("auth-token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) redirect("/login?callbackUrl=/configuracoes/nota-fiscal/dados");
  if (user.role !== "admin") redirect("/configuracoes");
  return <PanelShell showGestaoNav><FormularioFiscalCompartilhado modo="dono" /></PanelShell>;
}
