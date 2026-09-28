import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { recordPublicBehaviorEvent } from "@/lib/behaviorAnalytics";

function requestSameOrigin(req: NextRequest): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = req.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === req.nextUrl.origin;
  } catch {
    return false;
  }
}

// Endpoint de comportamento observado.
//
// Contrato deliberadamente "best effort":
// - nunca recebe preço/pagamento como fato;
// - nunca aceita clienteId/telefone/nome do navegador;
// - autenticação é resolvida no servidor quando existir;
// - qualquer campo fora da allowlist é descartado;
// - falha/flag desligada não pode quebrar a experiência do cliente.
export async function POST(req: NextRequest) {
  if (!requestSameOrigin(req)) {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const input = body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};

  let clienteId: string | null = null;
  try {
    const session = await lerSessaoCliente(req);
    clienteId = session?.clienteId ?? null;
  } catch {
    // A telemetria comportamental nunca transforma falha de sessão em erro
    // do produto. O evento, se válido, pode seguir anônimo.
  }

  const result = await recordPublicBehaviorEvent({
    eventId: input.eventId,
    sessionId: input.sessionId,
    type: input.type,
    data: input.data,
    clienteId,
  });

  if (!result.recorded && !result.duplicate && result.reason === "session_owner_conflict") {
    return new NextResponse(null, {
      status: 409,
      headers: {
        "Cache-Control": "no-store",
        "X-ChefeBot-Behavior-Reset-Session": "1",
      },
    });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-ChefeBot-Behavior": result.recorded ? "recorded" : result.duplicate ? "duplicate" : "ignored",
    },
  });
}
