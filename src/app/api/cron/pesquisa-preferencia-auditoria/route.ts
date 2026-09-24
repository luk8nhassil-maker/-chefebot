// GET /api/cron/pesquisa-preferencia-auditoria
//
// Sonda agregada e SOMENTE LEITURA do Motor de Preferência em produção.
// Protegida por CRON_SECRET (compatibilidade) ou GitHub Actions OIDC validado
// para permitir auditoria automatizada sem sessão administrativa e sem expor
// identificadores individuais.
//
// Não envia pesquisa, não grava resposta e não altera pedidos, Redis, Pix,
// WhatsApp, impressão, estoque ou fidelidade.

import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  consultarEventosAntesDe,
  consultarEventosPorPeriodo,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
} from "@/lib/historicoAnalitico";
import { analisarPesquisaPreferencia } from "@/lib/pesquisaPreferencia";
import { resumoSegurancaContatoDryRun } from "@/lib/pesquisaPreferenciaContato";
import { auditarHistoricoAnteriorPreferencia } from "@/lib/pesquisaPreferenciaHistorico";
import { carregarEvidenciasHistoricasFidelidade } from "@/lib/pesquisaPreferenciaHistoricoRedis";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "chefebot-research-audit";
const GITHUB_REPOSITORY = "luk8nhassil-maker/-chefebot";
const GITHUB_REPOSITORY_ID = "1257327044";
const GITHUB_MAIN_REF = "refs/heads/main";
const GITHUB_WORKFLOW_REF =
  "luk8nhassil-maker/-chefebot/.github/workflows/pesquisa-preferencia-auditoria-producao.yml@refs/heads/main";
const githubJwks = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks")
);

function claimsOidcAutorizadas(payload: JWTPayload): boolean {
  return (
    payload.repository === GITHUB_REPOSITORY &&
    String(payload.repository_id ?? "") === GITHUB_REPOSITORY_ID &&
    payload.ref === GITHUB_MAIN_REF &&
    payload.workflow_ref === GITHUB_WORKFLOW_REF &&
    ["push", "workflow_dispatch"].includes(String(payload.event_name ?? ""))
  );
}

async function autorizado(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return false;

  const segredo = process.env.CRON_SECRET;
  if (segredo && token === segredo) return true;

  try {
    const { payload } = await jwtVerify(token, githubJwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: GITHUB_OIDC_AUDIENCE,
      algorithms: ["RS256"],
    });
    return claimsOidcAutorizadas(payload);
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!(await autorizado(req))) {
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

    const eventos = [...historicoAnterior, ...janela90Dias];
    const resumo = analisarPesquisaPreferencia(eventos, {
      agoraMs,
      janelaInicioMs: inicioMs,
    });
    const historicoAnteriorComprovado = await auditarHistoricoAnteriorPreferencia({
      eventos,
      janelaInicioMs: inicioMs,
      carregarEvidencias: carregarEvidenciasHistoricasFidelidade,
      concorrencia: 10,
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
        historicoAnteriorComprovado,
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
