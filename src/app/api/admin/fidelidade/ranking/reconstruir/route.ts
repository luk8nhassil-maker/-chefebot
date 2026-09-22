// POST /api/admin/fidelidade/ranking/reconstruir
// Rebuild idempotente da projeção de ranking a partir do histórico analítico
// e do ledger canônico de Estrelas. Não cria pedidos nem altera a fidelidade.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterExtratoPontos } from "@/lib/fidelidade";
import { consultarEventosPorPeriodo } from "@/lib/historicoAnalitico";
import { obterTemporadaAtiva } from "@/lib/temporadas";
import { atualizarScoreRanking, calcularScoreDaTemporada } from "@/lib/rankingClientes";

const TENANT_PADRAO = "default";
const TAMANHO_LOTE = 25;

async function autorizado(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return false;
  const payload = await verifyToken(token);
  return !!payload && ["admin", "dev"].includes(payload.role as string);
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const tenantId = (req.nextUrl.searchParams.get("tenantId") ?? TENANT_PADRAO).trim() || TENANT_PADRAO;
  const temporada = await obterTemporadaAtiva(tenantId);
  if (!temporada?.ativadaEm) {
    return NextResponse.json({ ok: false, error: "Nenhuma temporada ativa para reconstruir" }, { status: 409 });
  }

  const inicioMs = new Date(temporada.ativadaEm).getTime();
  const fimConfigurado = temporada.fimEm ? new Date(temporada.fimEm).getTime() : Date.now();
  const fimMs = Math.min(fimConfigurado, Date.now());
  if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs) || inicioMs > fimMs) {
    return NextResponse.json({ ok: false, error: "Janela da temporada inválida" }, { status: 409 });
  }

  const eventos = await consultarEventosPorPeriodo(tenantId, inicioMs, fimMs);
  const clientes = [...new Set(eventos.filter((evento) => evento.statusAnalitico === "entregue").map((evento) => evento.clienteId))];
  for (let i = 0; i < clientes.length; i += TAMANHO_LOTE) {
    await Promise.all(clientes.slice(i, i + TAMANHO_LOTE).map(async (clienteId) => {
      const resultado = calcularScoreDaTemporada(await obterExtratoPontos(clienteId), inicioMs, fimMs);
      await atualizarScoreRanking(tenantId, temporada.temporadaId, clienteId, resultado.score, resultado.primeiroAtingidoEm ?? fimMs);
    }));
  }

  return NextResponse.json({
    ok: true,
    temporadaId: temporada.temporadaId,
    clientesProcessados: clientes.length,
    eventosConsiderados: eventos.filter((evento) => evento.statusAnalitico === "entregue").length,
  });
}
