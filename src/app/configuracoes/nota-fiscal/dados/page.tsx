import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import CadastroFiscalForm from "../CadastroFiscalForm";

export const dynamic = "force-dynamic";

export default async function DadosFiscais() {
  const token = (await cookies()).get("auth-token")?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) redirect("/login?callbackUrl=/configuracoes/nota-fiscal/dados");
  if (user.role !== "admin") redirect("/configuracoes");
  return <CadastroFiscalForm />;
}
