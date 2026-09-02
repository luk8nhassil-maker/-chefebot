import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";
import { obterConfigEvolution, extrairQrBase64 } from "@/lib/evolutionApi";
import { garantirWebhookEvolution } from "@/lib/evolutionWebhook";
import { limparQrAtual, persistirQrAtual } from "@/lib/whatsappQrCache";

async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200 };
}

async function lerEstado(baseUrl: string, instanceName: string, apiKey: string): Promise<string | null> {
  const res = await fetch(`${baseUrl}/instance/connectionState/${instanceName}`, {
    headers: { apikey: apiKey },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return (data as { instance?: { state?: string } })?.instance?.state ?? null;
}

async function aguardarFechar(baseUrl: string, instanceName: string, apiKey: string): Promise<string | null> {
  let estado = await lerEstado(baseUrl, instanceName, apiKey);
  if (estado !== "open") return estado;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    estado = await lerEstado(baseUrl, instanceName, apiKey);
    if (estado !== "open") return estado;
  }
  return estado;
}

/**
 * Troca intencional do número conectado.
 *
 * Faz logout da sessão WhatsApp na instância EXISTENTE, preservando a
 * configuração da instância e o histórico da Evolution. Em seguida solicita
 * um novo QR para parear o número correto. Nunca chama /instance/delete.
 *
 * Restrito a admin/dev porque esta ação derruba o WhatsApp operacional.
 */
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  const config = obterConfigEvolution();
  if (!config) {
    return NextResponse.json(
      { ok: false, estado: "provider_not_configured", error: "Evolution API não configurada." },
      { status: 503 },
    );
  }

  try {
    await limparQrAtual(config.instanceName);

    const logoutRes = await fetch(`${config.baseUrl}/instance/logout/${config.instanceName}`, {
      method: "DELETE",
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });

    if (logoutRes.status === 401 || logoutRes.status === 403) {
      return NextResponse.json({ ok: false, error: "Credencial da Evolution API inválida." }, { status: 502 });
    }

    // Algumas versões da Evolution podem devolver erro mesmo depois de fechar
    // a sessão. A fonte de verdade aqui é o estado observado após o logout:
    // só seguimos se a instância realmente não estiver mais "open".
    const estadoAposLogout = await aguardarFechar(config.baseUrl, config.instanceName, config.apiKey);
    if (estadoAposLogout === "open") {
      console.error("[WA_TROCA_NUMERO] logout não fechou a instância");
      return NextResponse.json(
        { ok: false, estado: "still_connected", error: "Não foi possível desconectar o WhatsApp atual." },
        { status: 502 },
      );
    }

    await salvarStatusConexao("disconnected");

    const webhookResultado = await garantirWebhookEvolution(config).catch(() => null);
    if (!webhookResultado?.ok) {
      console.error("[WA_TROCA_NUMERO] falha ao sincronizar webhook");
      return NextResponse.json(
        { ok: false, estado: "disconnected", error: "WhatsApp desconectado, mas o webhook não pôde ser confirmado." },
        { status: 502 },
      );
    }

    const connectRes = await fetch(`${config.baseUrl}/instance/connect/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const connectData = await connectRes.json().catch(() => ({}));
    const base64 = extrairQrBase64(connectData);

    if (connectRes.status === 401 || connectRes.status === 403) {
      return NextResponse.json({ ok: false, estado: "disconnected", error: "Credencial da Evolution API inválida." }, { status: 502 });
    }

    if (!connectRes.ok || !base64) {
      console.error("[WA_TROCA_NUMERO] novo QR não gerado, status:", connectRes.status);
      return NextResponse.json(
        { ok: false, estado: "disconnected", error: "WhatsApp foi desconectado, mas o novo QR ainda não ficou disponível." },
        { status: 502 },
      );
    }

    const registro = await persistirQrAtual(config.instanceName, base64);
    await salvarStatusConexao("connecting");

    return NextResponse.json({
      ok: true,
      estado: "qr_required",
      qrcode: {
        base64,
        generatedAt: registro.generatedAt,
        expiresAt: registro.expiresAt,
        generationId: registro.generationId,
      },
    });
  } catch (e) {
    console.error("[WA_TROCA_NUMERO] erro inesperado:", e instanceof Error ? e.name : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Falha ao trocar a conexão do WhatsApp." }, { status: 502 });
  }
}
