// Leitura segura e sem efeito colateral do estado de conexão do WhatsApp
// para o painel de infraestrutura. Reaproveita só a MESMA chamada de
// leitura (GET /instance/connectionState) já usada em
// src/app/api/dev/whatsapp/canary/route.ts — nunca chama /instance/connect,
// nunca gera QR, nunca dispara auto-heal/reset/restart. Se essa leitura
// falhar, devolve "unknown" e nunca lança.

import { obterConfigEvolution } from "@/lib/evolutionApi";

export type WhatsappConnectionState = "connected" | "disconnected" | "unknown";

export type WhatsappStatusResult = {
  connectionState: WhatsappConnectionState;
  checkedAt: number;
  limitation?: string;
};

const FETCH_TIMEOUT_MS = 4000;

async function fetchComTimeout(url: string, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { apikey: apiKey }, cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mapEstadoBruto(estado: unknown): WhatsappConnectionState {
  const s = typeof estado === "string" ? estado.toLowerCase() : "";
  if (s === "open") return "connected";
  if (s === "close" || s === "closed" || s === "connecting") return "disconnected";
  return "unknown";
}

export async function readWhatsappConnectionStateSafe(): Promise<WhatsappStatusResult> {
  const config = obterConfigEvolution();
  if (!config) {
    return { connectionState: "unknown", checkedAt: Date.now(), limitation: "Evolution API não configurada." };
  }

  const data = await fetchComTimeout(`${config.baseUrl}/instance/connectionState/${config.instanceName}`, config.apiKey);
  const estado = (data as { instance?: { state?: string } } | null)?.instance?.state;
  return { connectionState: mapEstadoBruto(estado), checkedAt: Date.now() };
}
