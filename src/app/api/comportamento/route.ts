import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import {
  behaviorAnalyticsEnabled,
  registrarEventosClienteComportamento,
  validarEventoClienteComportamento,
} from "@/lib/behaviorAnalytics";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_REQUEST = 20;

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "json_invalido" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawEvents = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json(
      { ok: false, error: "eventos_invalidos" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
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
  const sessao = await lerSessaoCliente(req).catch(() => null);
  const resultado = await registrarEventosClienteComportamento({
    clienteId: sessao?.clienteId ?? null,
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
