import { NextRequest, NextResponse } from "next/server";
import { GET as obterPedidosBase } from "@/app/api/orders/route";
import { pedidosVisiveisNoPainel } from "@/lib/pedidosPainelOperacional";

type PedidoPainel = {
  id?: string;
  status?: string;
  horario?: string;
  criadoEm?: string;
  expedienteOperacional?: string;
  pix?: { criadoEm?: string; confirmadoEm?: string } | null;
  [key: string]: unknown;
};

/**
 * Projeção de LEITURA exclusiva da tela /pedidos. Reutiliza autenticação,
 * limpeza de locks e sanitização da rota oficial, depois aplica somente o
 * recorte do expediente operacional. Nenhuma regra de escrita é duplicada.
 */
export async function GET(req: NextRequest) {
  const respostaBase = await obterPedidosBase(req);
  if (!respostaBase.ok) return respostaBase;

  const payload: unknown = await respostaBase.json();
  if (!Array.isArray(payload)) {
    return NextResponse.json(payload, { status: respostaBase.status });
  }

  const visiveis = pedidosVisiveisNoPainel(payload as PedidoPainel[], Date.now());
  return NextResponse.json(visiveis, { status: respostaBase.status });
}
