import { NextResponse } from "next/server";
import { processarPodioWhatsapp18h, ehHorarioDisparoPodioWhatsapp } from "@/lib/rankingPodioWhatsapp";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "@/lib/vercelProjeto";

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
  // Vercel Cron usa UTC. O vercel.json chama 21:00 UTC (=18:00 no fuso
  // operacional atual), mas a rota também valida a hora local para impedir
  // disparo acidental/manual fora da janela.
  if (!ehHorarioDisparoPodioWhatsapp(agoraMs)) {
    return NextResponse.json({ ok: true, skipped: true, motivo: "fora_horario_18h" });
  }

  try {
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
