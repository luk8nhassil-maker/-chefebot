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
import { maskPhone } from "@/lib/sanitizeLog";
import { lerDiagnosticoWhatsapp, type DiagnosticoWhatsapp } from "@/lib/whatsappDiag";

export const dynamic = "force-dynamic";

const JANELA_SONDA_MS = 15_000;
const FETCH_TIMEOUT_MS = 4000;

type Veredito = DiagnosticoWhatsapp & {
  // Qual commit está de fato servindo esta resposta — sem isso não dá para
  // afirmar que um deploy chegou ao domínio oficial sem acesso ao painel.
  commitServindo: string | null;
  providerConfigured: boolean;
  providerConnectionState: string | null;
  providerVersao: string | null;
  instanciaConnectionStatus: string | null;
  instanciaNumeroPareadoMascarado: string | null;
  instanciaDesconectadaEm: string | null;
  instanciaMotivoDesconexao: number | null;
  webhookRegistrado: boolean | null;
  webhookApontaParaProducao: boolean | null;
  webhookEventosOk: boolean | null;
  botGlobalEnabled: boolean;
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

/** Achata os formatos de instância vistos na v1 (`{instance:{...}}`) e v2 (plano). */
function extrairInstancia(data: unknown, instanceName: string): Record<string, unknown> | null {
  const lista = Array.isArray(data)
    ? data
    : Array.isArray((data as { instances?: unknown } | null)?.instances)
      ? ((data as { instances: unknown[] }).instances)
      : [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const aninhada = obj.instance && typeof obj.instance === "object" ? (obj.instance as Record<string, unknown>) : null;
    const nome = obj.instanceName ?? obj.name ?? aninhada?.instanceName ?? aninhada?.name;
    if (nome === instanceName) return aninhada ? { ...aninhada, ...obj } : obj;
  }
  return null;
}

async function sondar(): Promise<Veredito> {
  const config = obterConfigEvolution();
  const [diag, botAtivo] = await Promise.all([
    lerDiagnosticoWhatsapp(),
    redis.get<boolean>("bot_ativo").catch(() => null),
  ]);

  const base: Veredito = {
    ...diag,
    commitServindo: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    providerConfigured: !!config,
    providerConnectionState: null,
    providerVersao: null,
    instanciaConnectionStatus: null,
    instanciaNumeroPareadoMascarado: null,
    instanciaDesconectadaEm: null,
    instanciaMotivoDesconexao: null,
    webhookRegistrado: null,
    webhookApontaParaProducao: null,
    webhookEventosOk: null,
    botGlobalEnabled: botAtivo !== false,
    verificadoEm: new Date().toISOString(),
  };

  if (!config) return base;

  const [stateRes, webhookRes, versaoRes, instanciasRes] = await Promise.all([
    fetchComTimeout(`${config.baseUrl}/instance/connectionState/${config.instanceName}`, config.apiKey),
    fetchComTimeout(`${config.baseUrl}/webhook/find/${config.instanceName}`, config.apiKey),
    // Raiz da Evolution: devolve a versão instalada. Sem ela não dá para
    // afirmar qual contrato de logout/delete/connect vale nesta instalação.
    fetchComTimeout(`${config.baseUrl}/`, config.apiKey),
    fetchComTimeout(
      `${config.baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(config.instanceName)}`,
      config.apiKey,
    ),
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

  if (versaoRes && versaoRes.status >= 200 && versaoRes.status < 300) {
    const versao = (versaoRes.data as { version?: unknown } | undefined)?.version;
    base.providerVersao = typeof versao === "string" ? versao.slice(0, 40) : null;
  }

  if (instanciasRes && instanciasRes.status >= 200 && instanciasRes.status < 300) {
    const inst = extrairInstancia(instanciasRes.data, config.instanceName);
    if (inst) {
      const status = inst.connectionStatus ?? inst.status ?? inst.state;
      base.instanciaConnectionStatus = typeof status === "string" ? status : null;
      // ownerJid é o telefone pareado — PII. Só o formato mascarado sai daqui.
      const owner = inst.ownerJid;
      base.instanciaNumeroPareadoMascarado =
        typeof owner === "string" && owner ? maskPhone(owner.split("@")[0]) : null;
      const desconexao = inst.disconnectionAt;
      base.instanciaDesconectadaEm = typeof desconexao === "string" ? desconexao : null;
      const motivo = inst.disconnectionReasonCode;
      base.instanciaMotivoDesconexao = typeof motivo === "number" ? motivo : null;
    }
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
