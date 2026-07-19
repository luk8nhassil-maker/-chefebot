import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  aplicarResgateManual,
  revogarCodigoResgate,
  substituirRecompensa,
  mascararCodigoResgate,
  type EspecificacaoSubstituicaoRecompensa,
  type TipoRecompensaJornada,
} from "@/lib/jornadaChef";

const TIPOS_VALIDOS: TipoRecompensaJornada[] = ["bebida_sobremesa", "pizza", "presente_especial"];

/**
 * Extrai a especificação estruturada de substituição do corpo da requisição —
 * nunca aceita `novoProdutoId`/`novoProdutoNome` livres (rule 8). Coerção
 * defensiva só para não quebrar com tipos inesperados; a validação real
 * contra o catálogo acontece dentro de `substituirRecompensa`.
 */
function extrairEspecificacaoSubstituicao(bruta: unknown): EspecificacaoSubstituicaoRecompensa | null {
  if (!bruta || typeof bruta !== "object") return null;
  const obj = bruta as Record<string, unknown>;
  const tipo = TIPOS_VALIDOS.includes(obj.tipo as TipoRecompensaJornada) ? (obj.tipo as TipoRecompensaJornada) : null;
  if (!tipo) return null;

  const item =
    obj.item && typeof obj.item === "object"
      ? {
          produtoId: String((obj.item as Record<string, unknown>).produtoId ?? "").trim(),
          produtoNome: String((obj.item as Record<string, unknown>).produtoNome ?? "").trim(),
          categoria: (obj.item as Record<string, unknown>).categoria as never,
        }
      : undefined;
  const pizza =
    obj.pizza && typeof obj.pizza === "object"
      ? {
          tamanho: String((obj.pizza as Record<string, unknown>).tamanho ?? "").trim(),
          sabores: Array.isArray((obj.pizza as Record<string, unknown>).sabores)
            ? ((obj.pizza as Record<string, unknown>).sabores as unknown[]).map((s) => String(s).trim()).filter(Boolean)
            : [],
        }
      : undefined;
  const composicao = Array.isArray(obj.composicao)
    ? (obj.composicao as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          item: {
            produtoId: String((c.item as Record<string, unknown> | undefined)?.produtoId ?? "").trim(),
            produtoNome: String((c.item as Record<string, unknown> | undefined)?.produtoNome ?? "").trim(),
            categoria: (c.item as Record<string, unknown> | undefined)?.categoria as never,
          },
          quantidade: Math.max(1, Math.trunc(Number(c.quantidade)) || 1),
        }))
    : undefined;

  return {
    tipo,
    ...(item ? { item } : {}),
    ...(pizza ? { pizza } : {}),
    ...(composicao ? { composicao } : {}),
  };
}

// POST /api/admin/jornada-chef/resgate-manual — fallback obrigatório da
// Kellyne (rule 15): aplica manualmente um presente pelo código público de
// resgate, sem depender do fluxo automático de carrinho/pedido do site.

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const acao = body?.acao;

  try {
    if (acao === "aplicar") {
      const codigo = String(body?.codigoPublico ?? "").trim();
      if (!codigo) return NextResponse.json({ ok: false, error: "codigoPublico obrigatorio" }, { status: 400 });
      const recompensa = await aplicarResgateManual(codigo, auth.role as string);
      return NextResponse.json({ ok: true, recompensaId: recompensa.recompensaId, status: recompensa.status });
    }
    if (acao === "revogar_codigo") {
      const recompensaId = String(body?.recompensaId ?? "").trim();
      if (!recompensaId) return NextResponse.json({ ok: false, error: "recompensaId obrigatorio" }, { status: 400 });
      const recompensa = await revogarCodigoResgate(recompensaId);
      // Só a versão mascarada volta para o painel — o novo código integral
      // fica só no servidor (rule 2/8).
      return NextResponse.json({ ok: true, codigoMascarado: mascararCodigoResgate(recompensa.codigoPublico) });
    }
    if (acao === "substituir") {
      if (auth.role !== "admin" && auth.role !== "dev") {
        return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
      }
      const recompensaId = String(body?.recompensaId ?? "").trim();
      const motivo = String(body?.motivo ?? "").trim();
      const especificacao = extrairEspecificacaoSubstituicao(body?.novaEspecificacao);
      if (!recompensaId || !motivo || !especificacao) {
        return NextResponse.json({ ok: false, error: "Campos obrigatorios ausentes" }, { status: 400 });
      }
      const recompensa = await substituirRecompensa(recompensaId, especificacao, motivo, auth.username as string);
      return NextResponse.json({
        ok: true,
        recompensaId: recompensa.recompensaId,
        produtoNome: recompensa.produtoNome,
        status: recompensa.status,
        valorReferencia: recompensa.valorReferencia,
      });
    }
    return NextResponse.json({ ok: false, error: "Acao invalida" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Nao foi possivel processar" }, { status: 400 });
  }
}
