import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { redis } from "@/lib/redis";
import { agendarProximaVerificacaoPixGuardiao } from "@/lib/pixGuardiaoScheduler";
import {
  calcularDelayAteProximoMarcoPagamentoPix,
  calcularIntervaloPorIdade,
  PIX_PAGAMENTO_AVISO_PENDENTE_MS,
} from "@/lib/pixAutoCheckConfig";
import { processarPoliticaTimeoutPagamentoPix } from "@/lib/pixPagamentoTimeout";
import { incrementarContadorPix } from "@/lib/pixMetricas";
import { solicitarVerificacaoOficialPix, carregarEstadoSentinela } from "@/lib/pixSentinela";

// Endpoint interno de cada tick da cadeia server-side do Guardião Pix
// (chamado exclusivamente pelo QStash — nunca pelo navegador nem pelo
// painel). Autenticação por ASSINATURA (upstash-signature), não por sessão
// de admin: quem entrega a requisição é o QStash, não um usuário logado.
//
// Fluxo: QStash → este endpoint → Sentinela Pix → conciliador central
// (reconciliarPixMercadoPago) → Mercado Pago. O timeout comercial de 6/13
// minutos é uma política separada: consulta/cancela a cobrança pelo adaptador
// oficial e nunca confirma pagamento por relógio.
//
// Retorno HTTP: mensagens antigas (geração superada), pagamentos já
// finalizados e payload permanentemente inválido retornam 200 — não há
// nenhuma condição em que reenviar o mesmo corpo mudaria o resultado, então
// não faz sentido o QStash gastar retries nelas. Assinatura ausente/inválida
// continua 401 (é uma fronteira de segurança, não uma condição de retry).

type CorpoTick = { pedidoId?: unknown; geracao?: unknown; tentativa?: unknown };

const TICK_DEDUPE_PREFIXO = "pix:guardiao:tick:dedupe:";
const TICK_DEDUPE_TTL_SEGUNDOS = 55;

function receiver(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) return null;
  return new Receiver({ currentSigningKey, nextSigningKey });
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
    // Payload permanentemente malformado — reenviar o mesmo corpo nunca vai
    // funcionar, então 200 evita retries inúteis do QStash.
    return NextResponse.json({ ok: false, ignorado: true, motivo: "corpo_invalido" });
  }

  const pedidoId = typeof corpo.pedidoId === "string" ? corpo.pedidoId.trim() : "";
  const geracao = typeof corpo.geracao === "number" && Number.isFinite(corpo.geracao) ? corpo.geracao : undefined;
  const tentativa = typeof corpo.tentativa === "number" && Number.isFinite(corpo.tentativa) ? corpo.tentativa : 0;
  if (!pedidoId || tentativa < 1) {
    return NextResponse.json({ ok: false, ignorado: true, motivo: "payload_invalido" });
  }

  // Dedupe do tick: o QStash garante entrega "at-least-once" — retries de
  // rede podem entregar o mesmo tick mais de uma vez. NX curto evita chamar
  // o Sentinela em dobro para o mesmo (pedidoId, geração, tentativa); não
  // impede o PRÓXIMO tick de ser agendado normalmente.
  const chaveDedupe = `${TICK_DEDUPE_PREFIXO}${pedidoId}:${geracao ?? "s"}:${tentativa}`;
  const primeiraEntrega = await redis.set(chaveDedupe, "1", { nx: true, ex: TICK_DEDUPE_TTL_SEGUNDOS });
  if (!primeiraEntrega) {
    await incrementarContadorPix("sentinela_mensagem_duplicada_ignorada");
    return NextResponse.json({ ok: true, duplicado: true, ignorado: true });
  }

  await incrementarContadorPix("guardiao_cadeia_tick");

  const agora = Date.now();
  const resultado = await solicitarVerificacaoOficialPix({
    pedidoId,
    origem: "guardiao_qstash",
    geracaoMensagem: geracao,
    agora,
  });

  if (resultado.motivo === "geracao_antiga") {
    await incrementarContadorPix("sentinela_mensagem_antiga_ignorada");
    return NextResponse.json({ ok: true, ignorado: true, motivo: "geracao_antiga" });
  }

  if (resultado.encerrado) {
    await incrementarContadorPix("guardiao_cadeia_finalizada");
    return NextResponse.json({ ok: true, encerrado: true, motivo: resultado.motivoEncerramento || resultado.motivo });
  }

  const estadoAtual = await carregarEstadoSentinela(pedidoId);
  const idadeMs = estadoAtual?.criadoEm ? Math.max(0, Date.now() - estadoAtual.criadoEm) : 0;

  // Política de expiração do pagamento só entra a partir do marco de aviso.
  // Aos 13 minutos ela tenta antes encerrar a cobrança pendente no próprio
  // Mercado Pago; erro/ambiguidade nunca cancela o pedido local às cegas.
  const politicaTimeout = idadeMs >= PIX_PAGAMENTO_AVISO_PENDENTE_MS
    ? await processarPoliticaTimeoutPagamentoPix({ pedidoId, agora: Date.now() })
    : { encerrado: false, motivo: "antes_do_aviso" };

  if (politicaTimeout.encerrado) {
    await incrementarContadorPix("guardiao_cadeia_finalizada");
    return NextResponse.json({
      ok: true,
      encerrado: true,
      motivo: politicaTimeout.motivo,
      timeoutPagamento: true,
    });
  }

  // Chain segue ativa. Nunca agenda um tick para depois do próximo marco de
  // 6/13 minutos, mesmo quando a cadência normal está na faixa de 60s.
  const proximaConsultaEm = resultado.proximaConsultaMercadoPagoEm ?? estadoAtual?.proximaConsultaMercadoPagoEm;
  let proximoDelayMs = proximaConsultaEm
    ? Math.max(1_000, proximaConsultaEm - Date.now())
    : calcularIntervaloPorIdade(idadeMs);

  const delayMarco = calcularDelayAteProximoMarcoPagamentoPix(idadeMs);
  if (delayMarco !== null) proximoDelayMs = Math.min(proximoDelayMs, Math.max(1_000, delayMarco));
  if (typeof politicaTimeout.proximoDelayMs === "number") {
    proximoDelayMs = Math.min(proximoDelayMs, Math.max(1_000, politicaTimeout.proximoDelayMs));
  }

  const agendado = await agendarProximaVerificacaoPixGuardiao({
    pedidoId,
    geracao: estadoAtual?.geracao ?? geracao ?? 1,
    tentativa: tentativa + 1,
    delayMs: proximoDelayMs,
  });

  if (!agendado) await incrementarContadorPix("guardiao_cadeia_finalizada");

  return NextResponse.json({ ok: true, encerrado: !agendado, proximoDelayMs: agendado ? proximoDelayMs : undefined });
}
