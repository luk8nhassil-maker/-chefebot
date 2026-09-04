// GET /api/diagnostico/whatsapp — sonda SOMENTE-LEITURA da integração com a
// Evolution API.
//
// Por que existe: um teste real (mensagem enviada de um número comum para o
// WhatsApp da pizzaria) pode não ser respondido por causas bem diferentes —
// webhook não registrado na Evolution, webhook apontando para outro deploy,
// instância desconectada, ou o evento nem chegando ao nosso servidor. Sem
// acesso ao painel da Evolution/Vercel não há como distinguir essas causas.
// Esta rota responde exatamente isso, sem exigir login.
//
// Garantias:
// - Só LÊ. Nunca chama /instance/connect, /instance/create, /instance/delete,
//   /instance/logout nem /webhook/set — nenhuma ação que mude a instância.
// - Nunca devolve API key, token ou conteúdo de conversa. `inboundLastSeenAt`
//   e `outboundLastSuccessAt` são só timestamps (nenhum telefone/texto).
// - Estrangulada em memória (uma sonda real à Evolution a cada JANELA_SONDA_MS
//   por instância quente) para nunca virar um amplificador de tráfego.

import { NextResponse } from "next/server";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { redis } from "@/lib/redis";
import { lerDiagnosticoWhatsapp } from "@/lib/whatsappDiag";

export const dynamic = "force-dynamic";

const JANELA_SONDA_MS = 15_000;
const FETCH_TIMEOUT_MS = 4000;

type Veredito = {
  providerConfigured: boolean;
  providerConnectionState: string | null;
  webhookRegistrado: boolean | null;
  webhookApontaParaProducao: boolean | null;
  webhookEventosOk: boolean | null;
  botGlobalEnabled: boolean;
  inboundLastSeenAt: number | null;
  outboundLastSuccessAt: number | null;
  verificadoEm: string;
};

let ultimoVeredito: Veredito | null = null;
let ultimaSondaEm = 0;

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

async function sondar(): Promise<Veredito> {
  const config = obterConfigEvolution();
  const [diag, botAtivo] = await Promise.all([
    lerDiagnosticoWhatsapp(),
    redis.get<boolean>("bot_ativo").catch(() => null),
  ]);

  const base: Veredito = {
    providerConfigured: !!config,
    providerConnectionState: null,
    webhookRegistrado: null,
    webhookApontaParaProducao: null,
    webhookEventosOk: null,
    botGlobalEnabled: botAtivo !== false,
    inboundLastSeenAt: diag.inboundLastSeenAt,
    outboundLastSuccessAt: diag.outboundLastSuccessAt,
    verificadoEm: new Date().toISOString(),
  };

  if (!config) return base;

  const [stateRes, webhookRes] = await Promise.all([
    fetchComTimeout(`${config.baseUrl}/instance/connectionState/${config.instanceName}`, config.apiKey),
    fetchComTimeout(`${config.baseUrl}/webhook/find/${config.instanceName}`, config.apiKey),
  ]);

  if (stateRes && stateRes.status >= 200 && stateRes.status < 300) {
    const estado = (stateRes.data as { instance?: { state?: unknown } })?.instance?.state;
    base.providerConnectionState = typeof estado === "string" ? estado : null;
  }

  if (webhookRes && webhookRes.status >= 200 && webhookRes.status < 300) {
    const w = webhookRes.data as { url?: string; enabled?: boolean; events?: string[] } | undefined;
    base.webhookRegistrado = w?.enabled === true;
    base.webhookApontaParaProducao = w?.url === config.webhookUrl;
    base.webhookEventosOk =
      Array.isArray(w?.events) && w!.events!.includes("MESSAGES_UPSERT") && w!.events!.includes("CONNECTION_UPDATE");
  }

  return base;
}

export async function GET() {
  const agora = Date.now();
  const podeSondar = ultimoVeredito === null || agora - ultimaSondaEm >= JANELA_SONDA_MS;

  if (podeSondar) {
    ultimaSondaEm = agora;
    ultimoVeredito = await sondar();
  }

  return NextResponse.json(
    { ...ultimoVeredito!, emCache: !podeSondar },
    { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
