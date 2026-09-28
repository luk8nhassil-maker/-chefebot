import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import {
  behaviorAnalyticsEnabled,
  consumirLimiteIngestaoComportamental,
  registrarEventosClienteComportamento,
  validarEventoClienteComportamento,
  validarVinculoCookieComportamento,
} from "@/lib/behaviorAnalytics";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_REQUEST = 20;

async function lerJsonComLimite(req: NextRequest): Promise<
  { ok: true; value: unknown } | { ok: false; status: 400 | 413 }
> {
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, status: 400 };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set("behavior-link-v1", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/comportamento",
    maxAge: 0,
  });
  return response;
}

export async function POST(req: NextRequest) {
  if (!behaviorAnalyticsEnabled()) {
    return NextResponse.json(
      { ok: false, disabled: true },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "payload_muito_grande" },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = await lerJsonComLimite(req);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.status === 413 ? "payload_muito_grande" : "json_invalido",
      },
      { status: parsed.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawEvents = (parsed.value as { events?: unknown } | null)?.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json(
      { ok: false, error: "eventos_invalidos" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const primeiroEvento = rawEvents[0] as { sessionId?: unknown } | undefined;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rateIdentity = forwarded || (typeof primeiroEvento?.sessionId === "string" ? "session:" + primeiroEvento.sessionId : "unknown");
  const dentroDoLimite = await consumirLimiteIngestaoComportamental(rateIdentity).catch(() => false);
  if (!dentroDoLimite) {
    return NextResponse.json(
      { ok: false, error: "limite_temporario" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }

  const agora = Date.now();
  const events = rawEvents
    .map((item) => validarEventoClienteComportamento(item, agora))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (events.length !== rawEvents.length) {
    return NextResponse.json(
      { ok: false, error: "evento_fora_do_contrato" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Identidade nunca vem do body. Se houver sessão válida, associa o lote ao
  // cliente no servidor; caso contrário, a sessão comportamental permanece
  // anônima e ainda pode ser ligada futuramente por sessionId quando houver
  // um fato oficial (ex.: pedido criado).
  // A identidade nunca vem do body. Sessão autenticada vence; sem ela, aceita-se somente o pseudônimo do cookie assinado criado após validar o link oficial do WhatsApp.
  const sessao = await lerSessaoCliente(req).catch(() => null);
  const actorHashVerificado = sessao?.clienteId ? null : validarVinculoCookieComportamento(req.cookies.get("behavior-link-v1")?.value, agora);
  const resultado = await registrarEventosClienteComportamento({
    clienteId: sessao?.clienteId ?? null,
    actorHashVerificado,
    events,
    agoraMs: agora,
  });

  return NextResponse.json(
    { ok: true, ...resultado },
    {
      status: 202,
      headers: {
        "Cache-Control": "no-store",
        "X-ChefeBot-Analytics": "behavior-v1",
      },
    },
  );
}
