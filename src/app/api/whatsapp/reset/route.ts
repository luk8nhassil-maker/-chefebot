import { NextRequest, NextResponse } from "next/server";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";
import { verifyToken } from "@/lib/auth";
import { obterConfigEvolution, extrairQrBase64 } from "@/lib/evolutionApi";

// Sem cookie ou token invalido/expirado -> 401 (sem sessao).
// Sessao valida mas papel sem permissao -> 403.
// Papel autorizado -> segue normalmente.
async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200 };
}

// Reconecta com segurança — NUNCA faz logout/delete de uma instância já
// conectada. Se a instância existir mas estiver desconectada, reconecta; se
// não existir, cria e conecta. Restrito a admin/dev.
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  const config = obterConfigEvolution();
  if (!config) {
    return NextResponse.json(
      { ok: false, estado: "provider_not_configured", error: "EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados." },
      { status: 503 }
    );
  }

  try {
    // 1) Verifica o estado atual — nunca apaga uma instância já conectada.
    const stateRes = await fetch(`${config.baseUrl}/instance/connectionState/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const stateData = await stateRes.json().catch(() => ({}));
    const estadoAtual = (stateData as { instance?: { state?: string } })?.instance?.state;
    console.log("[RESET] etapa: connectionState, status:", stateRes.status, "estado:", estadoAtual ?? "desconhecido");

    if (stateRes.ok && estadoAtual === "open") {
      await salvarStatusConexao("connected");
      return NextResponse.json({ ok: true, estado: "connected" });
    }

    if (stateRes.status === 401 || stateRes.status === 403) {
      return NextResponse.json({ ok: false, error: "Credencial inválida (EVOLUTION_API_KEY)." }, { status: 502 });
    }

    const instanciaExiste = stateRes.status !== 404;

    if (!instanciaExiste) {
      // 2) Instância não existe: cria (nunca faz logout/delete de nada).
      const createRes = await fetch(`${config.baseUrl}/instance/create`, {
        method: "POST",
        headers: { apikey: config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ instanceName: config.instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
        cache: "no-store",
      });
      const createData = await createRes.json().catch(() => ({}));
      const base64DoCreate = extrairQrBase64(createData);
      console.log("[RESET] etapa: create, status:", createRes.status, "has qr:", !!base64DoCreate);

      if (createRes.status === 401 || createRes.status === 403) {
        return NextResponse.json({ ok: false, error: "Credencial inválida (EVOLUTION_API_KEY)." }, { status: 502 });
      }

      const jaExiste = createRes.status === 409;
      if (!createRes.ok && !jaExiste) {
        console.error("[RESET] etapa: create, falhou, status:", createRes.status);
        return NextResponse.json({ ok: false, error: "Falha ao criar instância" }, { status: 502 });
      }

      // 3) Configura o webhook na instância (nova ou já existente)
      const webhookRes = await fetch(`${config.baseUrl}/webhook/set/${config.instanceName}`, {
        method: "POST",
        headers: { apikey: config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: config.webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE", "CALL"],
          },
        }),
        cache: "no-store",
      }).catch(() => null);
      console.log("[RESET] etapa: webhook, status:", webhookRes?.status ?? "network-error");

      if (base64DoCreate) {
        await salvarStatusConexao("connecting");
        return NextResponse.json({
          ok: true,
          estado: "qr_required",
          qrcode: {
            base64: base64DoCreate,
            code: (createData as Record<string, unknown>)?.code as string | undefined ?? null,
            pairingCode: null,
          },
        });
      }
    }

    // 4) Instância existe mas está desconectada (ou acabou de ser criada sem
    // QR direto na resposta) — conecta para obter o QR. Nunca faz logout/delete.
    const connRes = await fetch(`${config.baseUrl}/instance/connect/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const qrData = await connRes.json().catch(() => ({}));
    const base64 = extrairQrBase64(qrData);
    console.log("[RESET] etapa: connect, status:", connRes.status, "has qr:", !!base64);

    if (connRes.status === 401 || connRes.status === 403) {
      return NextResponse.json({ ok: false, error: "Credencial inválida (EVOLUTION_API_KEY)." }, { status: 502 });
    }

    if (!base64) {
      console.error("[RESET] etapa: connect, QR não gerado, status:", connRes.status);
      return NextResponse.json({ ok: false, error: "QR code não gerado pela Evolution API" }, { status: 502 });
    }

    await salvarStatusConexao("connecting");

    return NextResponse.json({
      ok: true,
      estado: "qr_required",
      qrcode: {
        base64,
        code: (qrData as Record<string, unknown>)?.code as string | undefined ?? null,
        pairingCode: (qrData as Record<string, unknown>)?.pairingCode as string | undefined ?? null,
      },
    });
  } catch (e) {
    console.error("[RESET] etapa: inesperada, erro:", e instanceof Error ? e.name : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Falha ao resetar conexão" }, { status: 502 });
  }
}
