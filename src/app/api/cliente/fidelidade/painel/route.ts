// GET /api/cliente/fidelidade/painel — dados de temporada e ranking para a
// view do cliente. Agrega em uma única chamada para reduzir round-trips.
//
// Segurança: clienteId NUNCA exposto no ranking — apenas posicao e eVoce.
// Sem PII de outros participantes.

import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { obterTemporadaAtiva } from "@/lib/temporadas";
import { posicaoClienteRanking, obterTopRanking } from "@/lib/rankingClientes";

const TENANT_PADRAO = "default";

function diasRestantes(fimEm: string): number {
  const agora = Date.now();
  const fim = new Date(fimEm).getTime();
  if (fim <= agora) return 0;
  return Math.ceil((fim - agora) / 86400000);
}

export async function GET(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const clienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  const tenantId = TENANT_PADRAO;

  const temporada = await obterTemporadaAtiva(tenantId);

  let ranking: {
    posicao: number;
    score: number;
    entorno: { posicao: number; eVoce: boolean }[];
    lista: { posicao: number; score: number; eVoce: boolean }[];
  } | null = null;

  if (temporada) {
    const [pos, top] = await Promise.all([
      posicaoClienteRanking(tenantId, temporada.temporadaId, clienteId),
      obterTopRanking(tenantId, temporada.temporadaId, 20),
    ]);
    if (pos) {
      const vizinhos = top.filter(
        (e) => e.posicao >= Math.max(1, pos.posicao - 1) && e.posicao <= pos.posicao + 1,
      );
      // clienteId NUNCA exposto — apenas posicao e eVoce
      const entorno = vizinhos.map((e) => ({ posicao: e.posicao, eVoce: e.clienteId === clienteId }));
      const lista = top.slice(0, 10).map((e) => ({
        posicao: e.posicao,
        score: e.score,
        eVoce: e.clienteId === clienteId,
      }));
      ranking = { posicao: pos.posicao, score: pos.score, entorno, lista };
    }
  }

  return NextResponse.json({
    temporada: temporada
      ? {
          nome: temporada.nome ?? null,
          diasRestantes: temporada.fimEm ? diasRestantes(temporada.fimEm) : null,
          fimEm: temporada.fimEm ?? null,
          estado: temporada.estado,
        }
      : null,
    ranking,
  });
}
