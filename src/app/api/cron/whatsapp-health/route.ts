import { NextResponse } from "next/server";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { verificarInstancia } from "@/lib/evolutionConnect";
import { registrarResultadoVerificacao, lerEstadoProvider, salvarEstadoProvider } from "@/lib/whatsappProviderState";

const LIMIAR_ALERTA_FALHAS = 2;

type AlertaPayload = {
  ambiente: string;
  estado: string;
  etapa: string | null;
  horario: string;
  quantidadeFalhas: number;
};

/** Envia só os 5 campos documentados — nunca chave, cookie, telefone, QR ou corpo bruto. */
async function enviarAlerta(payload: AlertaPayload): Promise<void> {
  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[CRON whatsapp-health] falha ao enviar alerta (ignorada):", e instanceof Error ? e.message : "erro desconhecido");
  }
}

// GET /api/cron/whatsapp-health — checagem periódica do provider de
// WhatsApp. Protegida por CRON_SECRET (mesmo padrão dos outros crons do
// projeto). Idealmente chamada a cada 5 minutos — no plano Hobby da Vercel
// os crons nativos rodam no máximo 1x/dia, então até a infraestrutura ter
// um scheduler externo (ex.: o próprio Uptime Kuma da infra/evolution, ou
// um serviço de cron externo) chamando este endpoint com o header
// Authorization correto, a cadência real fica limitada pelo plano —
// documentado em docs/WHATSAPP_RUNBOOK.md.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = obterConfigEvolution();
  const resultado = config
    ? await verificarInstancia(config)
    : { ok: false as const, estado: "provider_not_configured" as const, error: "EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados.", step: "config" };

  const antes = await lerEstadoProvider();
  const persistido = await registrarResultadoVerificacao(resultado.estado, {
    etapaFalha: resultado.ok ? null : resultado.step,
  });

  const falhouAgora = persistido.falhasConsecutivas > 0;
  const jaAlertouFalha = antes.ultimoAlertaEnviado === "falha";

  if (falhouAgora && persistido.falhasConsecutivas >= LIMIAR_ALERTA_FALHAS && !jaAlertouFalha) {
    await enviarAlerta({
      ambiente: process.env.VERCEL_ENV || "production",
      estado: resultado.estado,
      etapa: resultado.ok ? null : resultado.step,
      horario: persistido.ultimaVerificacao || new Date().toISOString(),
      quantidadeFalhas: persistido.falhasConsecutivas,
    });
    await salvarEstadoProvider({ ultimoAlertaEnviado: "falha" });
  } else if (!falhouAgora && jaAlertouFalha) {
    await enviarAlerta({
      ambiente: process.env.VERCEL_ENV || "production",
      estado: resultado.estado,
      etapa: null,
      horario: persistido.ultimaVerificacao || new Date().toISOString(),
      quantidadeFalhas: 0,
    });
    await salvarEstadoProvider({ ultimoAlertaEnviado: "recuperacao" });
  }

  return NextResponse.json({
    ok: resultado.ok,
    estado: resultado.estado,
    falhasConsecutivas: persistido.falhasConsecutivas,
  });
}
