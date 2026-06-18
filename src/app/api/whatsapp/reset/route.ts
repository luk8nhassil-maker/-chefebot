import { NextResponse } from "next/server";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";

const _baseUrl    = process.env.EVOLUTION_API_URL ?? "evolution-api-production-8f99.up.railway.app";
const BASE        = _baseUrl.startsWith("http") ? _baseUrl : `https://${_baseUrl}`;
const KEY         = process.env.EVOLUTION_API_KEY!;
const INSTANCE    = "chefebot";
const WEBHOOK_URL = "https://chefebot-pjif.vercel.app/api/whatsapp";

export async function POST() {
  try {
    // 1) Logout (ignora erro — pode já estar desconectada)
    const logoutRes = await fetch(`${BASE}/instance/logout/${INSTANCE}`, {
      method: "DELETE",
      headers: { apikey: KEY },
      cache: "no-store",
    }).catch(() => null);
    console.log("[RESET] logout:", logoutRes?.status ?? "network-error");

    // 2) Deletar instância completamente
    const deleteRes = await fetch(`${BASE}/instance/delete/${INSTANCE}`, {
      method: "DELETE",
      headers: { apikey: KEY },
      cache: "no-store",
    }).catch(() => null);
    const deleteText = await deleteRes?.text().catch(() => "");
    console.log("[RESET] delete:", deleteRes?.status ?? "network-error", deleteText?.slice(0, 200));

    // 3) Pausa o bot imediatamente
    await salvarStatusConexao("disconnected");

    // 4) Criar nova instância limpa
    const createRes = await fetch(`${BASE}/instance/create`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ instanceName: INSTANCE, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
      cache: "no-store",
    });
    const createData = await createRes.json().catch(() => ({}));
    console.log("[RESET] create:", createRes.status, JSON.stringify(createData).slice(0, 200));

    if (!createRes.ok) {
      console.error("[RESET] create failed:", JSON.stringify(createData));
      return NextResponse.json({ ok: false, error: "Falha ao criar instância", detail: createData }, { status: 502 });
    }

    // 5) Configurar webhook na nova instância
    const webhookRes = await fetch(`${BASE}/webhook/set/${INSTANCE}`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: WEBHOOK_URL,
          webhookByEvents: false,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE", "CALL"],
        },
      }),
      cache: "no-store",
    }).catch(() => null);
    console.log("[RESET] webhook:", webhookRes?.status ?? "network-error");

    // 6) Conectar para obter QR code
    const connRes = await fetch(`${BASE}/instance/connect/${INSTANCE}`, {
      headers: { apikey: KEY },
      cache: "no-store",
    });
    const qrData = await connRes.json().catch(() => ({}));
    console.log("[RESET] connect:", connRes.status, "has base64:", !!qrData?.base64, "keys:", Object.keys(qrData || {}).join(","));

    const base64 = qrData?.base64 || qrData?.qrcode?.base64 || null;
    if (!base64) {
      console.error("[RESET] QR não gerado:", JSON.stringify(qrData).slice(0, 300));
      return NextResponse.json({ ok: false, error: "QR code não gerado pela Evolution API", detail: qrData }, { status: 502 });
    }

    await salvarStatusConexao("connecting");

    return NextResponse.json({
      ok: true,
      qrcode: { base64, code: qrData?.code ?? null, pairingCode: qrData?.pairingCode ?? null },
    });
  } catch (e) {
    console.error("[RESET] Erro inesperado:", e);
    return NextResponse.json({ ok: false, error: "Falha ao resetar conexão", detail: String(e) }, { status: 502 });
  }
}
