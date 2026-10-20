import { ranking3, ranking3Ativo } from "@/lib/ranking3/server";
import { obterElegibilidadeRankingNoCorte } from "@/lib/consentimentoRanking";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "@/lib/vercelProjeto";
import { recuperarVinculosRanking3 } from "@/lib/ranking3/pedido";
import { reconciliarAvisosPendentes } from "@/lib/ranking3/notifications";

export const maxDuration = 60;
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.VERCEL_ENV !== "production" || process.env.VERCEL_PROJECT_ID !== VERCEL_PROJECT_CHEFEBOT_OFICIAL || !ranking3Ativo()) return Response.json({ skipped: true });
  try {
    const vinculos = await recuperarVinculosRanking3();
    return Response.json({ ...await ranking3().recuperar(Date.now(), obterElegibilidadeRankingNoCorte), vinculos, avisos: await reconciliarAvisosPendentes() });
  } catch {
    console.error("[ranking3] fechamento pendente; dados preservados para recuperação");
    return Response.json({ error: "fechamento_pendente" }, { status: 503 });
  }
}
