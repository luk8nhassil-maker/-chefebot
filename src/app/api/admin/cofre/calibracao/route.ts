import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  calibrarComportamentoCofre,
  cofreChefCalibracaoHabilitada,
} from "@/lib/cofreChefCalibracao";
import {
  consultarEventosPorPeriodo,
  periodo30Dias,
  periodo60Dias,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
} from "@/lib/historicoAnalitico";
import { obterTemporadaAtivaSomenteLeitura } from "@/lib/temporadas";
import { obterRankingCompleto, reindexarPorFiltro } from "@/lib/rankingClientes";
import { obterParticipacaoRankingParaClientes } from "@/lib/consentimentoRanking";

const PERIODOS_VALIDOS = [30, 60, 90] as const;
type PeriodoDias = (typeof PERIODOS_VALIDOS)[number];

function resolverPeriodo(dias: PeriodoDias, agora: number) {
  if (dias === 30) return periodo30Dias(agora);
  if (dias === 60) return periodo60Dias(agora);
  return periodo90Dias(agora);
}

async function autenticarAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role)) return null;
  return payload;
}

// GET /api/admin/cofre/calibracao
//
// Endpoint observacional: mede distribuições agregadas dos participantes do
// Ranking atual para calibrar futuras regras do Cofre.
//
// Não expõe clienteId, telefone ou nome. Não grava nada. Não transforma
// percentis em regra de negócio. Fica 404 por padrão até release gate explícito.
export async function GET(req: NextRequest) {
  if (!cofreChefCalibracaoHabilitada()) {
    return NextResponse.json(
      { error: "Recurso indisponivel" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const auth = await autenticarAdmin(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Nao autorizado" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const periodoParam = Number(req.nextUrl.searchParams.get("periodo") ?? "90");
  const validos: readonly number[] = PERIODOS_VALIDOS;
  if (!validos.includes(periodoParam)) {
    return NextResponse.json(
      { error: "periodo deve ser 30, 60 ou 90" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const agora = Date.now();
  const periodo = resolverPeriodo(periodoParam as PeriodoDias, agora);
  const tenantId = TENANT_PADRAO_ANALYTICS;

  try {
    const temporada = await obterTemporadaAtivaSomenteLeitura(tenantId, new Date(agora));

    let rankingCompleto: Awaited<ReturnType<typeof obterRankingCompleto>> = [];
    let participantes = new Set<string>();

    if (temporada) {
      rankingCompleto = await obterRankingCompleto(tenantId, temporada.temporadaId);
      const ids = rankingCompleto.map((entrada) => entrada.clienteId);
      const participacoes = await obterParticipacaoRankingParaClientes(ids);
      const rankingParticipantes = reindexarPorFiltro(
        rankingCompleto,
        (clienteId) => participacoes.get(clienteId) === true,
      );
      participantes = new Set(rankingParticipantes.map((entrada) => entrada.clienteId));
    }

    const eventos = await consultarEventosPorPeriodo(
      tenantId,
      periodo.inicioMs,
      periodo.fimMs,
    );

    const calibracao = calibrarComportamentoCofre({
      eventos,
      participantes,
      inicioMs: periodo.inicioMs,
      fimMs: periodo.fimMs,
      agoraMs: agora,
    });

    return NextResponse.json(
      {
        ok: true,
        modo: "calibracao_somente_leitura",
        periodoDias: periodoParam,
        inicioIso: new Date(periodo.inicioMs).toISOString(),
        fimIso: new Date(periodo.fimMs).toISOString(),
        temporada: temporada
          ? {
              temporadaId: temporada.temporadaId,
              nome: temporada.nome ?? null,
            }
          : null,
        coberturaRanking: {
          clientesNoRanking: rankingCompleto.length,
          participantesAtivos: participantes.size,
        },
        calibracao,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-ChefeBot-Cofre-Mode": "calibration-read-only",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Falha ao calibrar Cofre" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
