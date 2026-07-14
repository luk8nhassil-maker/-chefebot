import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { redis } from "@/lib/redis";
import type { PedidoComPix } from "@/lib/pix";
import { reconciliarPixMercadoPago } from "@/lib/mercadoPagoReconciliacao";
import { agendarProximaVerificacaoPixGuardiao } from "@/lib/pixGuardiaoScheduler";
import { calcularIntervaloPorIdade, PIX_GUARDIAO_IDADE_MAXIMA_MS } from "@/lib/pixAutoCheckConfig";
import { incrementarContadorPix } from "@/lib/pixMetricas";

// Endpoint interno de cada tick da cadeia server-side do Guardião Pix
// (chamado exclusivamente pelo QStash — nunca pelo navegador nem pelo
// painel). Autenticação por ASSINATURA (upstash-signature), não por sessão
// de admin: quem entrega a requisição é o QStash, não um usuário logado.
//
// Cada tick: (1) verifica assinatura, (2) dedupe por pedidoId+tentativa,
// (3) checa se o pedido já foi resolvido (confirmado/cancelado/idade
// máxima) — se sim, ENCERRA a cadeia sem reagendar, (4) senão reconcilia
// esse pedido pelo MESMO mecanismo central (reconciliarPixMercadoPago,
// idêntico ao usado pelo painel e pelo Guardião sob-demanda) e agenda o
// próximo tick com o intervalo correto para a idade atual (10s/20s/30s).
//
// Nunca confirma nada por si mesmo, nunca inventa paymentId, nunca cria um
// segundo caminho de confirmação — apenas decide QUANDO chamar o caminho
// que já existe.

type PedidoGuardiaoTick = PedidoComPix & { pixConfirmado?: boolean; status?: string };

type CorpoTick = { pedidoId?: unknown; tentativa?: unknown };

const TICK_DEDUPE_PREFIXO = "pix:guardiao:tick:dedupe:";
const TICK_DEDUPE_TTL_SEGUNDOS = 55;

function receiver(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return null;
  return new Receiver({ currentSigningKey, nextSigningKey });
}

function pedidoResolvido(pedido: PedidoGuardiaoTick | undefined, agora: number): boolean {
  if (!pedido) return true;
  if (pedido.status === "cancelado") return true;
  if (pedido.pixConfirmado === true || pedido.pix?.status === "confirmado") return true;

  const criadoEm = pedido.pix?.criadoEm ? new Date(pedido.pix.criadoEm).getTime() : NaN;
  if (Number.isFinite(criadoEm) && agora - criadoEm >= PIX_GUARDIAO_IDADE_MAXIMA_MS) return true;

  return false;
}

export async function POST(req: NextRequest) {
  const corpoTexto = await req.text();

  const verificador = receiver();
  if (!verificador) {
    // Sem chaves de assinatura configuradas: por segurança, nunca processa —
    // equivalente a desligado (a cadeia simplesmente não avança; polling do
    // painel/webhook seguem cobrindo a confirmação).
    return NextResponse.json({ ok: false, motivo: "assinatura_nao_configurada" }, { status: 503 });
  }

  const assinatura = req.headers.get("upstash-signature");
  if (!assinatura) {
    return NextResponse.json({ ok: false, motivo: "assinatura_ausente" }, { status: 401 });
  }

  try {
    const valida = await verificador.verify({ signature: assinatura, body: corpoTexto });
    if (!valida) return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, motivo: "assinatura_invalida" }, { status: 401 });
  }

  let corpo: CorpoTick;
  try {
    corpo = JSON.parse(corpoTexto) as CorpoTick;
  } catch {
    return NextResponse.json({ ok: false, motivo: "corpo_invalido" }, { status: 400 });
  }

  const pedidoId = typeof corpo.pedidoId === "string" ? corpo.pedidoId.trim() : "";
  const tentativa = typeof corpo.tentativa === "number" && Number.isFinite(corpo.tentativa) ? corpo.tentativa : 0;
  if (!pedidoId || tentativa < 1) {
    return NextResponse.json({ ok: false, motivo: "payload_invalido" }, { status: 400 });
  }

  // Dedupe do tick: o QStash garante entrega "at-least-once" — retries de
  // rede podem entregar o mesmo tick mais de uma vez. NX curto evita rodar a
  // reconciliação em dobro para o mesmo (pedidoId, tentativa); não impede o
  // PRÓXIMO tick de ser agendado normalmente.
  const chaveDedupe = `${TICK_DEDUPE_PREFIXO}${pedidoId}:${tentativa}`;
  const primeiraEntrega = await redis.set(chaveDedupe, "1", { nx: true, ex: TICK_DEDUPE_TTL_SEGUNDOS });
  if (!primeiraEntrega) {
    return NextResponse.json({ ok: true, duplicado: true });
  }

  await incrementarContadorPix("guardiao_cadeia_tick");

  const agora = Date.now();
  const pedidos = (await redis.get<PedidoGuardiaoTick[]>("pedidos")) || [];
  let pedido = pedidos.find((p) => p.id === pedidoId);

  if (pedidoResolvido(pedido, agora)) {
    await incrementarContadorPix("guardiao_cadeia_finalizada");
    return NextResponse.json({ ok: true, encerrado: true, motivo: "resolvido_antes_da_reconciliacao" });
  }

  // Reconciliação restrita a este pedido — mesmo mecanismo central usado
  // pelo painel e pelo Guardião sob-demanda; lock/cooldown/rate-limit já são
  // tratados dentro dele (uma reconciliação concorrente do painel não causa
  // dupla confirmação, só retorna `locked`).
  await reconciliarPixMercadoPago({ apenasPedidoIds: [pedidoId] });

  const pedidosAtualizados = (await redis.get<PedidoGuardiaoTick[]>("pedidos")) || [];
  pedido = pedidosAtualizados.find((p) => p.id === pedidoId);

  if (pedidoResolvido(pedido, Date.now())) {
    await incrementarContadorPix("guardiao_cadeia_finalizada");
    return NextResponse.json({ ok: true, encerrado: true, motivo: "resolvido_apos_reconciliacao" });
  }

  const idadeMs = pedido?.pix?.criadoEm ? Date.now() - new Date(pedido.pix.criadoEm).getTime() : 0;
  const proximoDelayMs = calcularIntervaloPorIdade(idadeMs);
  const agendado = await agendarProximaVerificacaoPixGuardiao({
    pedidoId,
    tentativa: tentativa + 1,
    delayMs: proximoDelayMs,
  });

  if (!agendado) await incrementarContadorPix("guardiao_cadeia_finalizada");

  return NextResponse.json({ ok: true, encerrado: !agendado, proximoDelayMs: agendado ? proximoDelayMs : undefined });
}
