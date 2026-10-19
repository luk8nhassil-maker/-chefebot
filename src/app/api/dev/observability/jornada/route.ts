import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { lerMonitorWhatsapp } from "@/lib/whatsappMonitoramento";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const disabled = () => NextResponse.json({ error: "servico_indisponivel" }, { status: 503, headers });

/** Identidade técnica exclusiva para leitura de dados agregados; não compartilha
 * cookie DEV, CRON_SECRET, credencial Evolution, QStash ou chave do Redis.
 * No Preview não consultar Redis ou Evolution de produção.
 */
export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV === "preview") return disabled();
  const secret = process.env.CHEFEBOT_JORNADA_MONITOR_TOKEN;
  if (!secret || Buffer.byteLength(secret) < 32) return disabled();
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ") || auth.length > 256) {
    return NextResponse.json({ error: "nao_autorizado" }, { status: 401, headers });
  }
  const candidate = auth.slice(7);
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!timingSafeEqual(a, b)) return NextResponse.json({ error: "nao_autorizado" }, { status: 401, headers });
  try {
    const data = await lerMonitorWhatsapp();
    // Somente allowlist de métricas e status: NÃO vazar incidentes, telefones,
    // identificadores de jobs, mensagens, dados de clientes ou recomendações.
    return NextResponse.json({
      checkedAt: data.checkedAt,
      metrics: data.metrics,
      health: {
        redis: data.health.redis,
        evolution: data.health.evolution,
        qstash: data.health.qstash,
        qstashScheduleVerified: data.health.qstashScheduleVerified,
        lastSignedWorkerSuccessAt: data.health.lastSignedWorkerSuccessAt,
      },
      canary: { state: data.canary.state, testedAt: data.canary.testedAt },
      diagnostics: {
        acceptedCounter: data.diagnostics.acceptedCounter,
        canaryOutbox: data.diagnostics.canaryOutbox,
      },
    }, { headers });
  } catch {
    return NextResponse.json({ error: "monitor_indisponivel" }, { status: 503, headers });
  }
}
