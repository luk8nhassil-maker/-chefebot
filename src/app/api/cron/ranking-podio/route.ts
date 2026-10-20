import { NextResponse } from "next/server";
import { processarPodioWhatsapp18h, ehHorarioDisparoPodioWhatsapp } from "@/lib/rankingPodioWhatsapp";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "@/lib/vercelProjeto";
import { processarAvisosRanking3 } from "@/lib/ranking3/notifications";
import { ranking3, ranking3Ativo } from "@/lib/ranking3/server";
import { obterElegibilidadeRankingNoCorte } from "@/lib/consentimentoRanking";

export const maxDuration = 30;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mensagem proativa real: fail-closed em qualquer ambiente que não seja
  // exatamente a produção oficial do ChefeBot.
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: true, skipped: true, motivo: "ambiente_nao_producao" });
  }
  if (process.env.VERCEL_PROJECT_ID !== VERCEL_PROJECT_CHEFEBOT_OFICIAL) {
    return NextResponse.json({ ok: true, skipped: true, motivo: "projeto_nao_oficial" });
  }

  const agoraMs = Date.now();
  try {
    if (ranking3Ativo()) {
      // A rota roda de hora em hora; o motor só enfileira dentro do horário
      // real configurado da pizzaria e revalida novamente no worker.
      const recuperacao = await ranking3().recuperar(agoraMs, obterElegibilidadeRankingNoCorte, 1);
      return NextResponse.json({ recuperacao, ...await processarAvisosRanking3(agoraMs) });
    }
    // O Ranking antigo preserva sua cadência original de 18h.
    if (!ehHorarioDisparoPodioWhatsapp(agoraMs)) {
      return NextResponse.json({ ok: true, skipped: true, motivo: "fora_horario_18h" });
    }
    const resultado = await processarPodioWhatsapp18h({ tenantId: "default", agoraMs });
    // Contadores sem destinatário, texto ou credencial: permitem auditar a
    // execução mesmo quando a plataforma não retém o corpo da resposta.
    console.info("[ranking-podio-whatsapp] resultado", {
      horaUtc: new Date(agoraMs).toISOString(),
      participantesTop3: resultado.participantesTop3,
      tentativasEnvio: resultado.tentativasEnvio,
      requisicoesProvider: resultado.requisicoesProvider,
      enviados: resultado.enviados,
      suprimidos: resultado.suprimidos,
      falhas: resultado.falhas,
      motivos: resultado.motivos,
    });
    return NextResponse.json(resultado);
  } catch (err) {
    console.error("[ranking-podio-whatsapp] cron falhou fechado", {
      erro: err instanceof Error ? err.name : "erro_inesperado",
    });
    return NextResponse.json({ ok: false, error: "falha_processamento_podio" }, { status: 500 });
  }
}
