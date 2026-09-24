// GET /api/admin/pesquisa-preferencia/dry-run
//
// Fase de observação do Motor de Preferência.
// SOMENTE LEITURA:
// - não envia WhatsApp;
// - não grava respostas;
// - não cria prêmio, desconto, pontos ou missão;
// - não altera Redis, pedidos, fidelidade, estoque, Pix ou impressão.
//
// A rota agrega o histórico analítico já existente e devolve somente contagens
// e limiares derivados dos próprios dados. Nenhum clienteId ou PII é exposto.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  consultarEventosAntesDe,
  consultarEventosPorPeriodo,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
} from "@/lib/historicoAnalitico";
import { analisarPesquisaPreferencia } from "@/lib/pesquisaPreferencia";
import { resumoSegurancaContatoDryRun } from "@/lib/pesquisaPreferenciaContato";
import { resumirPrimeiroEnvioM5 } from "@/lib/pesquisaPreferenciaPrimeiroEnvio.server";
import { envioControladoLiberadoNestaVersao } from "@/lib/pesquisaPreferenciaRelease";
import { obterInstrumentoPesquisa } from "@/lib/pesquisaPreferenciaRegistro";

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

  const tenantId =
    (req.nextUrl.searchParams.get("tenantId") ?? TENANT_PADRAO_ANALYTICS).trim() ||
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
    const primeiroEnvioM5 = await resumirPrimeiroEnvioM5({
      agoraMs,
      tenantId,
      eventos,
    });
    const instrumentoM5 = obterInstrumentoPesquisa("M5");

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        periodoDias: 90,
        ...resumo,
        segurancaContato: resumoSegurancaContatoDryRun(),
        primeiroEnvioM5: {
          candidatosComportamentais: primeiroEnvioM5.candidatosComportamentais,
          candidatosSemBloqueioAutomatico:
            primeiroEnvioM5.candidatosSemBloqueioAutomatico,
          prontoParaConfirmacaoManual:
            primeiroEnvioM5.prontoParaConfirmacaoManual,
          candidateRef:
            primeiroEnvioM5.primeiroCandidato?.candidateRef ?? null,
          identidadeMascarada:
            primeiroEnvioM5.primeiroCandidato?.telefoneMascarado ?? null,
          pergunta: instrumentoM5?.pergunta ?? null,
          envioLiberadoNestaVersao: envioControladoLiberadoNestaVersao(),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-ChefeBot-Research-Mode": "dry-run",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Falha ao calcular dry-run de pesquisa",
      },
      { status: 500 }
    );
  }
}
