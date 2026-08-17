import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { abrirComanda, comRodadasNormalizadas, listarComandas, totalParcialComanda } from "@/lib/comandas";
import { redis } from "@/lib/redis";
import { ehStatusPedidoSalao } from "@/lib/salaoOperacao";

export const dynamic = "force-dynamic";

type PedidoOperacionalSalao = {
  id?: string;
  status?: unknown;
  statusAtualizadoEm?: unknown;
};

async function mapaPedidosOperacionaisSalao(): Promise<Map<string, { status: string; statusAtualizadoEm?: string }>> {
  // Esta leitura é somente de acompanhamento. Se a chave de pedidos falhar,
  // a listagem de comandas continua funcionando e a UI mostra explicitamente
  // "Atualização pendente" em vez de inventar um estágio da cozinha.
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

// Lista de comandas: o próprio Salão consulta (para saber quais mesas estão
// abertas) e o painel administrativo também consulta (visão de comandas
// integrada só onde necessário) — duas sessões diferentes, mesmo dado.
export async function GET(req: NextRequest) {
  const [sessaoSalao, sessaoAdmin] = await Promise.all([lerSessaoSalao(req), lerSessaoAdministrativa(req)]);
  if (!sessaoSalao && !sessaoAdmin) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const [todas, pedidosOperacionais] = await Promise.all([listarComandas(), mapaPedidosOperacionaisSalao()]);
  const filtradas = status ? todas.filter((c) => c.status === status) : todas;
  // Normaliza rodadas na resposta — nunca grava aqui (leitura não escreve,
  // ver comRodadasNormalizadas). Além da estrutura da comanda, anexamos SOMENTE
  // o status operacional mínimo do pedido oficial já criado. Nenhum preço,
  // pagamento ou dado comercial passa a ter uma segunda fonte de verdade.
  const comandas = filtradas.map((c) => {
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
    return { ...normalizada, rodadas, totalParcial: totalParcialComanda(normalizada) };
  });
  return NextResponse.json({ ok: true, comandas });
}

// Abrir uma comanda é uma ação exclusiva do terminal do Salão.
export async function POST(req: NextRequest) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
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
