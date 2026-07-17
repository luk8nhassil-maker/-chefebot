import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { redis } from "@/lib/redis";
import { lerDiagnosticoWhatsapp } from "@/lib/whatsappDiag";
import { iniciarCanario, lerCanarioAtual, obterTelefoneCanario } from "@/lib/whatsappCanary";
import { maskPhone } from "@/lib/sanitizeLog";

// Canário permanente de baixo custo (Etapa G): teste real ponta-a-ponta do
// WhatsApp, disparado só sob demanda por um admin/dev autenticado — nunca
// por polling/cron. POST inicia um novo teste; GET devolve diagnóstico
// completo (config, connectionState real, webhook configurado, sinais de
// saúde e o último/atual teste de canário) para o painel /dev/whatsapp.

async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200 };
}

const FETCH_TIMEOUT_MS = 4000;

async function fetchComTimeout(url: string, apiKey: string): Promise<{ status: number; data: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { apikey: apiKey }, cache: "no-store", signal: controller.signal });
    const data = await res.json().catch(() => undefined);
    return { status: res.status, data };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  const resultado = await iniciarCanario();
  if (!resultado.ok) {
    if (resultado.motivo === "provider_not_configured") {
      return NextResponse.json(
        { ok: false, error: "WHATSAPP_CANARY_PHONE não configurado." },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "Aguarde antes de iniciar outro teste.", retryAfterSeconds: resultado.retryAfterSeconds },
      { status: 429 }
    );
  }
  return NextResponse.json({ ok: true, canary: resultado.record });
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  const config = obterConfigEvolution();
  const destino = obterTelefoneCanario();

  const [diag, canary, botAtivo] = await Promise.all([
    lerDiagnosticoWhatsapp(),
    lerCanarioAtual(),
    redis.get<boolean>("bot_ativo").catch(() => null),
  ]);

  const manualConversation = destino.configured
    ? await redis.get<boolean>(`manual:${destino.phone}`).catch(() => null)
    : null;

  let connectionState: { erro?: string; estado?: unknown } = { erro: "provider_not_configured" };
  let webhookConfigured: { erro?: string; urlConfigurada?: string; apontaParaProducao?: boolean; eventosOk?: boolean } = {
    erro: "provider_not_configured",
  };

  if (config) {
    const stateRes = await fetchComTimeout(`${config.baseUrl}/instance/connectionState/${config.instanceName}`, config.apiKey);
    connectionState = stateRes
      ? { estado: (stateRes.data as { instance?: { state?: string } })?.instance?.state ?? stateRes.data }
      : { erro: "falha_ao_consultar" };

    const webhookRes = await fetchComTimeout(`${config.baseUrl}/webhook/find/${config.instanceName}`, config.apiKey);
    if (webhookRes && webhookRes.status >= 200 && webhookRes.status < 300) {
      const w = webhookRes.data as { url?: string; enabled?: boolean; events?: string[] } | undefined;
      const urlConfigurada = w?.url ?? "";
      webhookConfigured = {
        urlConfigurada,
        apontaParaProducao: urlConfigurada === config.webhookUrl,
        eventosOk:
          Array.isArray(w?.events) &&
          w!.events!.includes("MESSAGES_UPSERT") &&
          w!.events!.includes("CONNECTION_UPDATE"),
      };
    } else {
      webhookConfigured = { erro: "falha_ao_consultar" };
    }
  }

  return NextResponse.json({
    providerConfigured: !!config,
    providerConnectionState: connectionState,
    webhookConfigured,
    inboundLastSeenAt: diag.inboundLastSeenAt,
    outboundLastSuccessAt: diag.outboundLastSuccessAt,
    botGlobalEnabled: botAtivo !== false,
    canaryPhoneConfigured: destino.configured,
    canaryPhoneMascarado: destino.configured ? maskPhone(destino.phone) : null,
    manualConversation: manualConversation === true,
    canary,
  });
}
