import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  criarTemporada,
  listarTemporadas,
  ativarTemporada,
  encerrarTemporada,
} from "@/lib/temporadas";
import { garantirResultadoTemporada, projetarResultadoTemporada } from "@/lib/temporadaResultado";

const TENANT_PADRAO = "default";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

// GET /api/admin/fidelidade/temporadas — lista todas as temporadas do tenant.
// Com ?resultado=<temporadaId>, devolve também o resultado arquivado dessa
// temporada (garantindo que ele existe, se a temporada já estiver encerrada
// — cobre tanto o encerramento manual quanto o auto-expiry lazy por fimEm).
export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const tenantId = (req.nextUrl.searchParams.get("tenantId") ?? TENANT_PADRAO).trim();
  if (!tenantId) return NextResponse.json({ error: "tenantId obrigatorio" }, { status: 400 });

  const resultadoTemporadaId = req.nextUrl.searchParams.get("resultado")?.trim();
  if (resultadoTemporadaId) {
    const bruto = await garantirResultadoTemporada(tenantId, resultadoTemporadaId);
    if (!bruto) return NextResponse.json({ resultado: null });
    const resultado = await projetarResultadoTemporada(bruto);
    return NextResponse.json({ resultado });
  }

  const lista = await listarTemporadas(tenantId);
  return NextResponse.json({ temporadas: lista });
}

// POST /api/admin/fidelidade/temporadas — cria ou altera estado de uma temporada.
//
// Ações (campo "acao" no body):
//   "criar"     — cria nova temporada em estado rascunho
//   "ativar"    — transiciona para ativa (auto-encerra a anterior)
//   "encerrar"  — transiciona para encerrada
//
// Body comum: { acao, tenantId?, temporadaId, ... }
// Body para "criar": também aceita { nome?, metaCompras?, metaIndicacoes? }
export async function POST(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const tenantId = (typeof body.tenantId === "string" ? body.tenantId : TENANT_PADRAO).trim();
  const temporadaId = typeof body.temporadaId === "string" ? body.temporadaId.trim() : "";
  const acao = typeof body.acao === "string" ? body.acao.trim() : "";

  if (!tenantId) return NextResponse.json({ error: "tenantId obrigatorio" }, { status: 400 });
  if (!temporadaId) return NextResponse.json({ error: "temporadaId obrigatorio" }, { status: 400 });
  if (!acao) return NextResponse.json({ error: "acao obrigatoria" }, { status: 400 });

  if (acao === "criar") {
    const params: {
      nome?: string;
      metaCompras?: number;
      metaIndicacoes?: number;
      duracaoDias?: number;
      premioDescricao?: string;
      premioQuantidadePremiados?: number;
      premioAprovado?: boolean;
    } = {};
    if (typeof body.nome === "string") params.nome = body.nome.trim();
    if (typeof body.metaCompras === "number" && body.metaCompras > 0) params.metaCompras = Math.round(body.metaCompras);
    if (typeof body.metaIndicacoes === "number" && body.metaIndicacoes > 0) params.metaIndicacoes = Math.round(body.metaIndicacoes);
    if (typeof body.duracaoDias === "number" && body.duracaoDias >= 1) params.duracaoDias = Math.round(body.duracaoDias);
    // Prêmio da temporada: só fica registrado se o admin informar os DOIS
    // campos explicitamente — descrição sozinha nunca declara vencedor
    // (garantirResultadoTemporada também exige premioAprovado === true).
    if (typeof body.premioDescricao === "string" && body.premioDescricao.trim()) params.premioDescricao = body.premioDescricao.trim();
    if (typeof body.premioQuantidadePremiados === "number" && body.premioQuantidadePremiados > 0) params.premioQuantidadePremiados = Math.round(body.premioQuantidadePremiados);
    if (body.premioAprovado === true) params.premioAprovado = true;
    const config = await criarTemporada(tenantId, temporadaId, params);
    return NextResponse.json({ ok: true, config });
  }

  if (acao === "ativar") {
    const resultado = await ativarTemporada(tenantId, temporadaId);
    if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 422 });
    return NextResponse.json({ ok: true, config: resultado.config });
  }

  if (acao === "encerrar") {
    const resultado = await encerrarTemporada(tenantId, temporadaId);
    if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 422 });
    // Arquiva o resultado no mesmo momento do encerramento manual. Falha aqui
    // não desfaz a transição de estado — a próxima leitura (GET ?resultado=)
    // tenta de novo de forma idempotente.
    const resultadoTemporada = await garantirResultadoTemporada(tenantId, temporadaId).catch(() => null);
    return NextResponse.json({ ok: true, config: resultado.config, resultadoTemporada });
  }

  return NextResponse.json({ error: `acao desconhecida: ${acao}` }, { status: 400 });
}
