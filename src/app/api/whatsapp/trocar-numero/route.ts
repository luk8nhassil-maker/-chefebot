import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { garantirWebhookEvolution } from "@/lib/evolutionWebhook";
import { limparQrAtual } from "@/lib/whatsappQrCache";

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

async function aguardarFechar(
  baseUrl: string,
  instanceName: string,
  apiKey: string,
  tentativas = 12,
  intervaloMs = 500,
): Promise<string | null> {
  let estado = await lerEstado(baseUrl, instanceName, apiKey);
  if (estado !== "open") return estado;

  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    await new Promise(resolve => setTimeout(resolve, intervaloMs));
    estado = await lerEstado(baseUrl, instanceName, apiKey);
    if (estado !== "open") return estado;
  }

  return estado;
}

async function solicitarLogout(baseUrl: string, instanceName: string, apiKey: string): Promise<Response> {
  return fetch(`${baseUrl}/instance/logout/${instanceName}`, {
    method: "DELETE",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
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

    let logoutRes = await solicitarLogout(config.baseUrl, config.instanceName, config.apiKey);

    if (logoutRes.status === 401 || logoutRes.status === 403) {
      return NextResponse.json({ ok: false, error: "Credencial da Evolution API inválida." }, { status: 502 });
    }

    // O logout da Evolution/Baileys é assíncrono em algumas versões: o HTTP
    // pode responder antes de connectionState sair de "open" e há versões
    // conhecidas que chegam a devolver 500 mesmo quando a sessão fecha logo
    // depois. Por isso a fonte de verdade é o estado observado, com uma janela
    // realista de convergência — nunca apenas os primeiros 750 ms.
    let estadoAposLogout = await aguardarFechar(config.baseUrl, config.instanceName, config.apiKey, 8, 500);

    // Se o primeiro logout foi aceito mas o estado ainda não convergiu, faz
    // UMA repetição idempotente da mesma ação e aguarda de novo. Não apaga nem
    // recria a instância.
    if (estadoAposLogout === "open") {
      logoutRes = await solicitarLogout(config.baseUrl, config.instanceName, config.apiKey);
      if (logoutRes.status === 401 || logoutRes.status === 403) {
        return NextResponse.json({ ok: false, error: "Credencial da Evolution API inválida." }, { status: 502 });
      }
      estadoAposLogout = await aguardarFechar(config.baseUrl, config.instanceName, config.apiKey, 8, 500);
    }

    if (estadoAposLogout === "open") {
      console.error("[WA_TROCA_NUMERO] logout permaneceu open após duas tentativas");
      return NextResponse.json(
        { ok: false, estado: "still_connected", error: "Não foi possível desconectar o WhatsApp atual." },
        { status: 502 },
      );
    }

    await salvarStatusConexao("disconnected");

    // Webhook é confirmado em melhor esforço aqui e também na rota de QR.
    // Uma falha momentânea de webhook não deve transformar um logout já
    // concluído em "falha de desconexão" nem reconectar o número errado.
    const webhookResultado = await garantirWebhookEvolution(config).catch(() => null);
    if (!webhookResultado?.ok) {
      console.error("[WA_TROCA_NUMERO] webhook pendente após logout");
    }

    // Não chama /instance/connect na mesma requisição do logout. Em versões
    // recentes da Evolution há uma janela de estabilização após logout; o
    // painel solicita o QR em seguida pela rota dedicada, que já possui lock,
    // cache e retry próprios.
    return NextResponse.json({
      ok: true,
      estado: "disconnected",
      qr: "pending",
      webhook: webhookResultado?.ok ? "synced" : "pending",
    });
  } catch (e) {
    console.error("[WA_TROCA_NUMERO] erro inesperado:", e instanceof Error ? e.name : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Falha ao trocar a conexão do WhatsApp." }, { status: 502 });
  }
}
