// Entrada EXCLUSIVA do pedido manual administrativo (painel — ver
// src/app/pedidos/NovoPedidoManual.tsx). Reaproveita o MESMO motor de
// validação/preço/persistência de POST /api/pedido-app (processarPedidoApp,
// exportado por aquele módulo) — nenhum segundo motor de pedido, nenhuma
// regra de catálogo/preço/estoque/idempotência duplicada.
//
// A única diferença desta rota é o contexto: aqui, e só aqui,
// processarPedidoApp é autorizada a ler a sessão administrativa real do
// cookie `auth-token` (sessaoAdministrativaPermitida: true) — o que ativa
// origem "painel", exige clientRequestId e permite honrar
// `semTelefonePainel`. Sem sessão administrativa válida, processarPedidoApp
// já rejeita com 401 antes de qualquer outra validação (ver o próprio
// arquivo). POST /api/pedido-app (cardápio público, Salão) nunca chama esta
// rota nem chega a ler o cookie de painel — ver o comentário de arquitetura
// em src/app/api/pedido-app/route.ts.
import { NextRequest, NextResponse } from "next/server";
import { processarPedidoApp } from "@/app/api/pedido-app/route";

// Mesmo maxDuration de POST /api/pedido-app (route.ts) — processarPedidoApp
// é o mesmo motor rodando aqui, com o mesmo tempo de execução esperado.
export const maxDuration = 20;

export async function POST(req: NextRequest): Promise<NextResponse> {
  return processarPedidoApp(req, { sessaoAdministrativaPermitida: true });
}
