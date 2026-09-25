// POST /api/cliente/ranking/evento — telemetria best-effort da experiência de
// retenção do Ranking do Chefe. Autenticado só para confirmar que quem chama
// é um cliente de verdade (evita poluir métricas com tráfego anônimo/bot);
// o clienteId NUNCA é persistido — o evento gravado é agregado e anônimo
// (ver src/lib/rankingRetencaoTelemetria.ts).
import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import {
  eventoRankingRetencaoValido,
  registrarEventoRankingRetencao,
} from "@/lib/rankingRetencaoTelemetria";

const TENANT_PADRAO = "default";

export async function POST(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const tipo = body.tipo;
  if (!eventoRankingRetencaoValido(tipo)) return new NextResponse(null, { status: 204 });

  await registrarEventoRankingRetencao(TENANT_PADRAO, tipo, body.detalhe);
  return new NextResponse(null, { status: 204 });
}
