import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { autenticarEntregador } from "@/lib/entregadorAuth";
import type {
  LocalizacaoEntregador,
  LocalizacaoPublica,
  PedidoEntregador,
} from "@/types/entregador";

type PedidoMain = {
  id: string;
  status: string;
  entregador?: { id: string };
};

function coordenadaValida(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function pedidoIdValido(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await autenticarEntregador(req);
    if (!auth) {
      return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const pedidoId = body?.pedidoId;
    const lat = body?.lat;
    const lng = body?.lng;
    if (
      !pedidoIdValido(pedidoId) ||
      !coordenadaValida(lat, -90, 90) ||
      !coordenadaValida(lng, -180, 180)
    ) {
      return NextResponse.json({ ok: false, error: "Localização inválida" }, { status: 400 });
    }

    const filaKey = `entregador:pedidos:${auth.entregador.id}`;
    const [fila, principais] = await Promise.all([
      redis.get<PedidoEntregador[]>(filaKey),
      redis.get<PedidoMain[]>("pedidos"),
    ]);
    const pedidoFila = (fila ?? []).find((pedido) => pedido.pedidoId === pedidoId);
    const pedidoMain = (principais ?? []).find((pedido) => pedido.id === pedidoId);

    if (pedidoMain?.entregador?.id && pedidoMain.entregador.id !== auth.entregador.id) {
      return NextResponse.json({ ok: false, error: "Pedido não autorizado" }, { status: 403 });
    }
    if (!pedidoFila || !pedidoMain) {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    if (pedidoMain.entregador?.id !== auth.entregador.id) {
      return NextResponse.json({ ok: false, error: "Pedido não autorizado" }, { status: 403 });
    }
    if (pedidoFila.status !== "em_rota" || pedidoMain.status !== "saiu_entrega") {
      return NextResponse.json({ ok: false, error: "Pedido não está em rota" }, { status: 409 });
    }

    const rateKey = `entregador:rate:localizacao:${auth.entregador.id}:${pedidoId}`;
    const permitido = await redis.set(rateKey, "1", { nx: true, ex: 3 });
    if (!permitido) {
      return NextResponse.json({ ok: false, error: "Atualizações muito frequentes" }, { status: 429 });
    }

    const localizacao: LocalizacaoEntregador = {
      entregadorId: auth.entregador.id,
      pedidoId,
      lat,
      lng,
      timestamp: Date.now(),
    };
    await redis.set(`loc:${pedidoId}`, localizacao, { ex: 7200 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar a localização" }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const pedidoId = req.nextUrl.searchParams.get("pedidoId");
    if (!pedidoIdValido(pedidoId)) {
      return NextResponse.json({ ok: false, error: "pedidoId obrigatório" }, { status: 400 });
    }

    const localizacao = await redis.get<LocalizacaoEntregador>(`loc:${pedidoId}`);
    if (!localizacao) {
      return NextResponse.json({ ok: false, error: "Localização não encontrada" }, { status: 404 });
    }
    const publica: LocalizacaoPublica = {
      pedidoId: localizacao.pedidoId,
      lat: localizacao.lat,
      lng: localizacao.lng,
      timestamp: localizacao.timestamp,
    };
    return NextResponse.json(publica);
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível carregar a localização" }, { status: 503 });
  }
}
