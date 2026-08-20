import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { abrirComanda, comRodadasNormalizadas, listarComandas, totalParcialComanda } from "@/lib/comandas";
import { redis } from "@/lib/redis";
import { ehStatusPedidoSalao } from "@/lib/salaoConta";
import { lerEstadoContaSalao } from "@/lib/salaoConta.server";
import { ERRO_ESCRITA_SALAO_PREVIEW, escritaSalaoBloqueadaNoPreview } from "@/lib/salaoAmbiente";

export const dynamic = "force-dynamic";

type PedidoOperacionalSalao = {
  id?: string;
  status?: unknown;
  statusAtualizadoEm?: unknown;
};

async function mapaPedidosOperacionaisSalao(): Promise<Map<string, { status: string; statusAtualizadoEm?: string }>> {
  const pedidos = await redis.get<PedidoOperacionalSalao[]>("pedidos").catch(() => null);
  const mapa = new Map<string, { status: string; statusAtualizadoEm?: string }>();
  if (!Array.isArray(pedidos)) return mapa;
  for (const pedido of pedidos) {
    if (!pedido || typeof pedido.id !== "string" || !ehStatusPedidoSalao(pedido.status)) continue;
    mapa.set(pedido.id, {
      status: pedido.status,
      ...(typeof pedido.statusAtualizadoEm === "string" ? { statusAtualizadoEm: pedido.statusAtualizadoEm } : {}),
    });
  }
  return mapa;
}

// Lista de comandas: Salão e painel administrativo leem a MESMA comanda.
// O status da cozinha é anexado a partir do pedido oficial, nunca inferido.
export async function GET(req: NextRequest) {
  const [sessaoSalao, sessaoAdmin] = await Promise.all([lerSessaoSalao(req), lerSessaoAdministrativa(req)]);
  if (!sessaoSalao && !sessaoAdmin) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const [todas, pedidosOperacionais] = await Promise.all([listarComandas(), mapaPedidosOperacionaisSalao()]);
  const filtradas = status ? todas.filter((c) => c.status === status) : todas;
  const comandas = await Promise.all(filtradas.map(async (c) => {
    const normalizada = comRodadasNormalizadas(c);
    const rodadas = normalizada.rodadas!.map((rodada) => {
      if (rodada.status !== "enviada" || !rodada.pedidoId) return rodada;
      const pedido = pedidosOperacionais.get(rodada.pedidoId);
      if (!pedido) return rodada;
      return {
        ...rodada,
        pedidoStatus: pedido.status,
        ...(pedido.statusAtualizadoEm ? { pedidoStatusAtualizadoEm: pedido.statusAtualizadoEm } : {}),
      };
    });
    return {
      ...normalizada,
      rodadas,
      totalParcial: totalParcialComanda(normalizada),
      conta: await lerEstadoContaSalao(normalizada.id),
    };
  }));
  return NextResponse.json({ ok: true, comandas }, { headers: { "Cache-Control": "no-store" } });
}

// Abrir uma comanda é uma ação exclusiva do terminal do Salão.
export async function POST(req: NextRequest) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  if (escritaSalaoBloqueadaNoPreview()) {
    return NextResponse.json({ ok: false, error: ERRO_ESCRITA_SALAO_PREVIEW }, { status: 403 });
  }

  let body: { cliente?: string; mesa?: string; complemento?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const cliente = (body.cliente || "").trim();
  if (!cliente) {
    return NextResponse.json({ ok: false, error: "Informe o nome do cliente" }, { status: 400 });
  }

  const resultado = await abrirComanda({ cliente, mesa: body.mesa, complemento: body.complemento });
  if (resultado === "mesa_ocupada") {
    return NextResponse.json({ ok: false, error: "Esta mesa já tem uma comanda aberta" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, comanda: resultado });
}
