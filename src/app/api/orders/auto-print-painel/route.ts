import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { reivindicarImpressaoAutomatica } from "@/lib/impressaoAutomatica";
import {
  ehOrigemAdministrativa,
  lerSessaoAdministrativa,
} from "@/lib/sessaoAdministrativa";

type PedidoPainel = {
  id?: string;
  origem?: unknown;
  pagamento?: string;
  pixConfirmado?: boolean;
  pix?: { status?: string };
  status?: string;
  isArchived?: boolean;
};

function pagamentoTemPix(pagamento: unknown): boolean {
  return typeof pagamento === "string" && /\bpix\b/i.test(pagamento);
}

function pixEstaConfirmado(pedido: PedidoPainel): boolean {
  return pedido.pixConfirmado === true || pedido.pix?.status === "confirmado";
}

export async function POST(req: NextRequest) {
  const sessao = await lerSessaoAdministrativa(req);
  if (!sessao) {
    return NextResponse.json({ ok: false, error: "Nao autorizado" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "Pedido invalido" }, { status: 400 });
  }

  const pedidos = (await redis.get<PedidoPainel[]>("pedidos")) || [];
  const pedido = pedidos.find((item) => item?.id === id);
  if (!pedido) {
    return NextResponse.json({ ok: false, error: "Pedido nao encontrado" }, { status: 404 });
  }

  // Regra exclusiva do Novo Pedido do painel. A origem e definida no servidor
  // a partir da sessao administrativa na criacao; nunca confiamos em um campo
  // enviado pelo navegador para liberar a impressao.
  if (!ehOrigemAdministrativa(pedido.origem)) {
    return NextResponse.json({
      ok: true,
      podeImprimirAutomaticamente: false,
      motivo: "origem_nao_painel",
    });
  }

  if (pedido.isArchived || pedido.status === "cancelado" || pedido.status === "entregue") {
    return NextResponse.json({
      ok: true,
      podeImprimirAutomaticamente: false,
      motivo: "pedido_finalizado",
    });
  }

  // Pix puro ou misto aguarda confirmacao. Enquanto estiver pendente o claim
  // nao e consumido, permitindo a unica impressao automatica quando confirmar.
  if (pagamentoTemPix(pedido.pagamento) && !pixEstaConfirmado(pedido)) {
    return NextResponse.json({
      ok: true,
      podeImprimirAutomaticamente: false,
      motivo: "pix_pendente",
    });
  }

  const podeImprimirAutomaticamente = await reivindicarImpressaoAutomatica(id);
  return NextResponse.json({
    ok: true,
    podeImprimirAutomaticamente,
    ...(!podeImprimirAutomaticamente ? { motivo: "ja_reivindicado" } : {}),
  });
}
