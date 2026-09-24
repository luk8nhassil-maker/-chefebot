// GET /api/cron/pesquisa-preferencia-auditoria
//
// Sonda agregada e SOMENTE LEITURA do Motor de Preferência em produção.
// Protegida por CRON_SECRET para permitir auditoria automatizada sem sessão
// administrativa e sem expor identificadores individuais.
//
// Não envia pesquisa, não grava resposta e não altera pedidos, Redis, Pix,
// WhatsApp, impressão, estoque ou fidelidade.

import { NextResponse } from "next/server";
import {
  consultarEventosAntesDe,
  consultarEventosPorPeriodo,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
} from "@/lib/historicoAnalitico";
import { analisarPesquisaPreferencia } from "@/lib/pesquisaPreferencia";
import { resumoSegurancaContatoDryRun } from "@/lib/pesquisaPreferenciaContato";

function autorizado(req: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  return req.headers.get("authorization") === `Bearer ${segredo}`;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const tenantId =
    (url.searchParams.get("tenantId") ?? TENANT_PADRAO_ANALYTICS).trim() ||
    TENANT_PADRAO_ANALYTICS;

  const agoraMs = Date.now();
  const { inicioMs, fimMs } = periodo90Dias(agoraMs);

  try {
    const [janela90Dias, historicoAnterior] = await Promise.all([
      consultarEventosPorPeriodo(tenantId, inicioMs, fimMs),
      consultarEventosAntesDe(tenantId, inicioMs),
    ]);

    const resumo = analisarPesquisaPreferencia([...historicoAnterior, ...janela90Dias], {
      agoraMs,
      janelaInicioMs: inicioMs,
    });

    const quantidadesMomentos = Object.fromEntries(
      Object.entries(resumo.momentos).map(([id, momento]) => [
        id,
        {
          tipo: momento.tipo,
          quantidade: momento.quantidade,
        },
      ])
    );

    return NextResponse.json(
      {
        ok: true,
        modo: "dry-run" as const,
        somenteLeitura: true as const,
        periodoDias: 90,
        deploymentCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        janela: resumo.janela,
        cobertura: resumo.cobertura,
        calibracao: resumo.calibracao,
        segmentacaoQueda: resumo.segmentacaoQueda,
        estadosAtuais: resumo.estadosAtuais,
        momentos: quantidadesMomentos,
        segurancaContato: resumoSegurancaContatoDryRun(),
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-ChefeBot-Research-Mode": "dry-run",
          "X-ChefeBot-Audit-Mode": "read-only",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Falha ao calcular auditoria agregada de pesquisa" },
      { status: 500 }
    );
  }
}
