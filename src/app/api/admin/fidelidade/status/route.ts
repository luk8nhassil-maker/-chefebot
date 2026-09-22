// GET /api/admin/fidelidade/status — estado agregado de todos os módulos de fidelidade.
//
// Somente roles admin/dev. Nenhuma PII exposta; dados de infraestrutura e contagens.
// Cobertura econômica NUNCA é alterada aqui — leitura pura.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigFidelidadePontos, estrelasV1Ativa } from "@/lib/fidelidade";
import { obterTemporadaAtiva, listarTemporadas } from "@/lib/temporadas";
import { obterTopRanking } from "@/lib/rankingClientes";

const TENANT_PADRAO = "default";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const tenantId = (req.nextUrl.searchParams.get("tenantId") ?? TENANT_PADRAO).trim() || TENANT_PADRAO;

  const [configPontos, temporadaAtiva, todasTemporadas] = await Promise.all([
    obterConfigFidelidadePontos(),
    obterTemporadaAtiva(tenantId),
    listarTemporadas(tenantId),
  ]);

  // Ranking: somente quando há temporada ativa; sem PII (clienteId é ID interno)
  let topRanking: { posicao: number; score: number }[] = [];
  if (temporadaAtiva) {
    const entradas = await obterTopRanking(tenantId, temporadaAtiva.temporadaId, 5);
    topRanking = entradas.map((e) => ({ posicao: e.posicao, score: e.score }));
  }

  const estrelas = {
    ativa: estrelasV1Ativa(configPontos ?? { ativo: false }),
    regraVersao: configPontos?.regraVersao ?? null,
    metaEstrelas: configPontos?.metaEstrelas ?? 50,
    // coberturaEconomicaAprovada NUNCA exposta aqui — pertence ao modal de config
  };

  const temporada = {
    ativa: temporadaAtiva
      ? {
          temporadaId: temporadaAtiva.temporadaId,
          nome: temporadaAtiva.nome ?? null,
          ativadaEm: temporadaAtiva.ativadaEm ?? null,
          fimEm: temporadaAtiva.fimEm ?? null,
          duracaoDias: temporadaAtiva.duracaoDias ?? null,
          metaCompras: temporadaAtiva.metaCompras ?? null,
          metaIndicacoes: temporadaAtiva.metaIndicacoes ?? null,
        }
      : null,
    total: todasTemporadas.length,
    encerradas: todasTemporadas.filter((t) => t.estado === "encerrada").length,
  };

  const ranking = {
    configurado: !!temporadaAtiva,
    temporadaId: temporadaAtiva?.temporadaId ?? null,
    top5: topRanking,
    nota: "saldo de Estrelas da temporada; empate por quem atingiu a pontuação primeiro",
  };

  const missoes = {
    configuradas: false,
    nota: "limiares operacionais pendentes de aprovação no Manual Mestre",
  };

  return NextResponse.json({
    tenantId,
    estrelas,
    temporada,
    ranking,
    missoes,
  });
}
