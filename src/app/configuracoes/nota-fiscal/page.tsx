import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import CadastroFiscalForm from "./CadastroFiscalForm";

export const dynamic = "force-dynamic";

export default async function NotaFiscalConfiguracoes() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) redirect("/login?callbackUrl=/configuracoes/nota-fiscal");
  if (user.role !== "admin") redirect("/configuracoes");
  // O acesso é validado PELO SERVIDOR; auth-user do navegador não é confiável.
  return <CadastroFiscalForm />;
}
