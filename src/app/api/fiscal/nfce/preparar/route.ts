import { NextRequest, NextResponse } from "next/server";
import { autenticarRequisicao, exigirRole } from "@/lib/apiAuth";
import { emPreviewVercel } from "@/lib/previewSafety";
import { redis } from "@/lib/redis";
import { prepararNfce, type PedidoParaNfce } from "@/lib/fiscal/nfcePreflight";

export const dynamic = "force-dynamic";

const SEM_CACHE = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * Leitura de pré-conferência fiscal, exclusiva da equipe autenticada.
 * Não gera NF, não consulta SEFAZ, não lê segredos fiscais e não escreve Redis.
 */
export async function GET(req: NextRequest) {
  const usuario = await autenticarRequisicao(req);
  const negado = exigirRole(usuario, ["admin", "atendente", "dev"]);
  if (negado) return negado;

  // NUNCA consultar Redis produtivo em Preview, mesmo se Vercel espelhar variáveis.
  if (emPreviewVercel())
    return NextResponse.json(
      { ok: false, error: "Prévia sem dados fiscais reais." },
      { status: 403, headers: SEM_CACHE },
    );

  const id = new URL(req.url).searchParams.get("pedidoId") ?? "";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    return NextResponse.json(
      { ok: false, error: "Identificador de pedido inválido." },
      { status: 400, headers: SEM_CACHE },
    );

  try {
    const pedidos = await redis.get<PedidoParaNfce[]>("pedidos");
    if (!Array.isArray(pedidos)) throw new Error("pedidos_indisponiveis");
    const pedido = pedidos.find(p => p && p.id === id);
    if (!pedido) return NextResponse.json(
      { ok: false, error: "Pedido não encontrado." },
      { status: 404, headers: SEM_CACHE },
    );

    const emissorConfigurado = Boolean(
      process.env.FOCUS_NFCE_TOKEN?.trim() &&
      /^\d{14}$/.test(process.env.FISCAL_EMITENTE_CNPJ ?? ""),
    );
    return NextResponse.json(
      { ok: true, ...prepararNfce(pedido, emissorConfigurado) },
      { headers: SEM_CACHE },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Não foi possível conferir os dados fiscais. Tente novamente mais tarde." },
      { status: 503, headers: SEM_CACHE },
    );
  }
}

/**
 * Defesa explícita: nenhum client pode acionar emissão via esta rota.
 * O emissor real dependerá de credenciamento, mapeamento fiscal e idempotência,
 * todos auditados em um PR de ativação separado.
 */
export async function POST(req: NextRequest) {
  const usuario = await autenticarRequisicao(req);
  const negado = exigirRole(usuario, ["admin", "atendente", "dev"]);
  if (negado) return negado;
  return NextResponse.json(
    { ok: false, error: "Emissão ainda não habilitada. Nenhuma nota foi criada." },
    { status: 423, headers: SEM_CACHE },
  );
}
