// GET /api/admin/analytics/pedidos — métricas analíticas de pedidos entregues.
//
// Leitura pura: nenhum dado é criado, modificado ou excluído aqui.
// Autenticação: somente roles admin/dev (mesmo padrão das demais rotas admin).
//
// Parâmetros:
//   ?tenantId=<id>   (default: "default")
//   ?periodo=7|30|60|90|historico (default: 30; histórico consulta todos os registros disponíveis)
//
// Resposta: MetricasAnaliticas agregadas + meta (período, pedidos no índice).
// Segurança: nomes, telefone, endereço e clienteId nunca aparecem; o canal do
// painel inclui apenas IDs dos próprios pedidos, para conciliação do admin.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  consultarClientesComHistoricoAnterior,
  calcularMetricas,
  periodo7Dias,
  periodo30Dias,
  periodo60Dias,
  periodo90Dias,
  TENANT_PADRAO_ANALYTICS,
} from "@/lib/historicoAnalitico";
import { consultarEventosAnaliticosComFallback } from "@/lib/analyticsPedidosReadModel.server";
import { consultarEstrelasCreditadasPorPedidos } from "@/lib/fidelidade";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

const PERIODOS_VALIDOS = [7, 30, 60, 90] as const;
type PeriodoDias = (typeof PERIODOS_VALIDOS)[number];
type PeriodoConsulta = PeriodoDias | "historico";

function resolverPeriodo(dias: PeriodoDias, agora: number) {
  if (dias === 7) return periodo7Dias(agora);
  if (dias === 60) return periodo60Dias(agora);
  if (dias === 90) return periodo90Dias(agora);
  return periodo30Dias(agora);
}

export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const tenantId = (params.get("tenantId") ?? TENANT_PADRAO_ANALYTICS).trim() || TENANT_PADRAO_ANALYTICS;

  const periodoParam = params.get("periodo") ?? "30";
  const periodo: PeriodoConsulta = periodoParam === "historico"
    ? "historico"
    : Number(periodoParam) as PeriodoDias;
  if (periodo !== "historico" && !PERIODOS_VALIDOS.includes(periodo)) {
    return NextResponse.json({ error: "periodo deve ser 7, 30, 60, 90 ou historico" }, { status: 400 });
  }
  const dias = periodo === "historico" ? null : periodo;

  const agora = Date.now();
  const { inicioMs, fimMs } = periodo === "historico"
    ? { inicioMs: 0, fimMs: agora }
    : resolverPeriodo(periodo, agora);

  try {
    const leitura = await consultarEventosAnaliticosComFallback(tenantId, inicioMs, fimMs, agora);
    const eventos = leitura.eventos;
    const clientesAtuais = new Set(
      eventos
        .filter((evento) => evento.statusAnalitico === "entregue")
        .map((evento) => evento.clienteId)
        .filter((clienteId): clienteId is string => Boolean(clienteId)),
    );

    const historicoFallback = new Set(
      leitura.fallbackTodos
        .filter((evento) => evento.statusAnalitico === "entregue" && evento.criadoEmMs < inicioMs)
        .map((evento) => evento.clienteId)
        .filter((clienteId): clienteId is string => Boolean(clienteId)),
    );

    const faltantesNoFallback = [...clientesAtuais].filter((clienteId) => !historicoFallback.has(clienteId));
    let historicoIndice = new Set<string>();
    let historicoAnteriorParcial = false;
    if (faltantesNoFallback.length > 0 && leitura.fonte.indiceDisponivel) {
      try {
        historicoIndice = await consultarClientesComHistoricoAnterior(tenantId, faltantesNoFallback, inicioMs);
      } catch {
        historicoAnteriorParcial = true;
      }
    } else if (faltantesNoFallback.length > 0 && !leitura.fonte.fallbackPedidosDisponivel) {
      historicoAnteriorParcial = true;
    }

    const clientesComHistoricoAnterior = new Set([...historicoFallback, ...historicoIndice]);
    const metricas = calcularMetricas(eventos, clientesComHistoricoAnterior);
    let metricasComEstrelas: Omit<typeof metricas, "estrelasDistribuidas"> & {
      estrelasDistribuidas: number | null;
      pedidosComEstrelasRegistradas: number | null;
    } = { ...metricas, estrelasDistribuidas: null, pedidosComEstrelasRegistradas: null };
    try {
      const estrelas = await consultarEstrelasCreditadasPorPedidos(
        eventos.flatMap((evento) => evento.statusAnalitico === "entregue" && evento.clienteId
          ? [{ clienteId: evento.clienteId, pedidoId: evento.pedidoId }]
          : []),
        inicioMs,
        fimMs,
      );
      metricasComEstrelas = {
        ...metricas,
        estrelasDistribuidas: estrelas.estrelas,
        pedidosComEstrelasRegistradas: estrelas.pedidosComCredito,
      };
    } catch {
      // Se a leitura do extrato falhar, não transforme falta de acesso em zero.
    }

    const baseCobertura = leitura.fallbackTodos.length > 0 ? leitura.fallbackTodos : eventos;
    const timestampsCobertura = baseCobertura
      .map((evento) => evento.criadoEmMs)
      .filter((valor) => Number.isFinite(valor) && valor <= fimMs);
    const primeiroHistoricoMs = timestampsCobertura.length > 0 ? Math.min(...timestampsCobertura) : null;
    const primeiroNaJanelaMs = primeiroHistoricoMs === null ? null : Math.max(primeiroHistoricoMs, inicioMs);
    const diasHistoricoEncontrado = primeiroNaJanelaMs === null
      ? 0
      : Math.min(dias ?? Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil((fimMs - primeiroNaJanelaMs) / 86400000)));
    const possuiDadosAntesDaJanela = primeiroHistoricoMs !== null && primeiroHistoricoMs < inicioMs;
    const recorrenciaAnteriorDisponivel = possuiDadosAntesDaJanela;
    historicoAnteriorParcial = historicoAnteriorParcial || !recorrenciaAnteriorDisponivel;

    return NextResponse.json(
      {
        ok: true,
        tenantId,
        periodosDias: dias,
        inicioIso: new Date(inicioMs).toISOString(),
        fimIso: new Date(fimMs).toISOString(),
        totalEventosNoIndice: leitura.fonte.eventosIndice,
        totalEventosConsiderados: eventos.length,
        fonteDados: leitura.fonte,
        historicoAnteriorParcial,
        cobertura: {
          janelaSolicitadaDias: dias,
          historicoEncontradoDesdeIso: primeiroHistoricoMs === null ? null : new Date(primeiroHistoricoMs).toISOString(),
          diasHistoricoEncontrado,
          possuiDadosAntesDaJanela,
          recorrenciaAnteriorDisponivel,
        },
        metricas: metricasComEstrelas,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch {
    return NextResponse.json({ ok: false, error: "Falha ao consultar historico analitico" }, { status: 500 });
  }
}
