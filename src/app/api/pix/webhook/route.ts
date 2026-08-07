import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { mutarPedidos, type ResultadoMutacaoPedidos } from "@/lib/pedidosConcorrencia";
import { avaliarWebhookPixPassivo, type PedidoComPix, type PixWebhookPayload, type PixWebhookResultado } from "@/lib/pix";
import {
  isMercadoPagoWebhook,
  extrairPaymentIdMercadoPago,
  validarAssinaturaMercadoPago,
  buscarPagamentoMercadoPago,
  mapearPagamentoParaPayloadInterno,
} from "@/lib/mercadoPagoWebhook";
import { registrarAtividadeWebhookSentinela } from "@/lib/pixSentinela";
import { incrementarContadorPix } from "@/lib/pixMetricas";

type PedidoWebhookPix = PedidoComPix & {
  pixConfirmado?: boolean;
};

type ResultadoConfirmacaoPix =
  | { tipo: "idempotente"; pedidoId: unknown; txid: unknown }
  | { tipo: "nao_confirma"; resultado: PixWebhookResultado }
  | { tipo: "cobranca_substituida"; pedidoId: unknown; txid: string | undefined }
  | { tipo: "confirmado"; resultado: PixWebhookResultado; confirmadoEm: string; pedido: PedidoWebhookPix };

// Protegido pelo lock GLOBAL de "pedidos" (ver src/lib/pedidosConcorrencia.ts):
// a elegibilidade (idempotência, wouldConfirm, cobrança substituída) é
// reavaliada sobre uma leitura FRESCA de "pedidos", DENTRO do lock — depois
// de qualquer chamada externa (a verificação autoritativa no Mercado Pago já
// aconteceu antes desta função ser chamada) — nunca sobre o snapshot lido no
// início da rota, que só serve para a resposta passiva quando autoConfirm
// está desligado (nenhuma escrita acontece nesse caminho).
async function confirmarPixSeElegivel(payload: PixWebhookPayload): Promise<ResultadoConfirmacaoPix> {
  return mutarPedidos<PedidoWebhookPix, ResultadoConfirmacaoPix>((pedidosFrescos): ResultadoMutacaoPedidos<PedidoWebhookPix, ResultadoConfirmacaoPix> => {
    const resultado = avaliarWebhookPixPassivo(payload, pedidosFrescos);
    const index = pedidosFrescos.findIndex((p) => p.pix?.txid === payload.txid);
    const pedido = index >= 0 ? pedidosFrescos[index] : null;

    if (pedido?.pixConfirmado || pedido?.pix?.status === "confirmado") {
      // Não chama o Sentinela aqui de propósito: esta é uma notificação
      // REDUNDANTE (o pedido já estava confirmado antes desta chamada). Se
      // uma cadeia QStash ainda estiver ativa, o próprio tick seguinte já se
      // encerra sozinho ao reler o pedido (decisão 4 do Sentinela) — sem
      // precisar de mais uma escrita no Redis para uma notificação que não
      // mudou nada.
      return { persistir: false, resultado: { tipo: "idempotente", pedidoId: pedido.id, txid: pedido.pix?.txid } };
    }

    if (!resultado.wouldConfirm || index < 0 || !pedido?.pix) {
      return { persistir: false, resultado: { tipo: "nao_confirma", resultado } };
    }

    // Edição de pedido (ver AGENTS.md): quando o cliente altera valor/forma
    // de pagamento com um Pix ainda não pago, uma cobrança nova é criada mas
    // o txid interno (chefebot_<pedidoId>) permanece o mesmo por design — o
    // webhook casa por txid+valor. Sem esta checagem, o pagamento de uma
    // cobrança JÁ SUBSTITUÍDA (QR antigo, ainda visível em algum print/cache
    // do cliente) poderia confirmar a revisão nova do pedido. providerPaymentId
    // é o identificador da cobrança específica no Mercado Pago — só confirma
    // quando ele bate com a cobrança atualmente ativa no pedido.
    if (
      payload.providerPaymentId &&
      pedido.pix.providerPaymentId &&
      payload.providerPaymentId !== pedido.pix.providerPaymentId
    ) {
      return { persistir: false, resultado: { tipo: "cobranca_substituida", pedidoId: pedido.id, txid: payload.txid } };
    }

    const confirmadoEm = new Date().toISOString();
    const pix = {
      ...pedido.pix,
      status: "confirmado" as const,
      confirmadoPor: "webhook" as const,
      confirmadoEm,
      ...(payload.providerPaymentId ? { providerPaymentId: payload.providerPaymentId } : {}),
    };
    const atualizados = [...pedidosFrescos];
    atualizados[index] = { ...pedido, pixConfirmado: true, pix };
    return {
      persistir: true,
      pedidos: atualizados,
      resultado: { tipo: "confirmado", resultado, confirmadoEm, pedido: atualizados[index] },
    };
  });
}

export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json();
    const pedidos = (await redis.get<PedidoWebhookPix[]>("pedidos")) || [];
    const autoConfirm = process.env.PIX_WEBHOOK_AUTO_CONFIRM === "true";

    // Branch adaptador Mercado Pago: notificacao real do MP ({ type: "payment",
    // data: { id } }). Traduz para o payload interno e reutiliza toda a logica
    // passiva/idempotente abaixo. O webhook generico (x-pix-webhook-secret)
    // segue intacto no `else`.
    let payload: PixWebhookPayload;
    let mpAutorizado = false;

    if (isMercadoPagoWebhook(corpo)) {
      const paymentId = extrairPaymentIdMercadoPago(corpo);
      const assinaturaValida = validarAssinaturaMercadoPago({
        dataId: paymentId ?? "",
        xSignature: req.headers.get("x-signature"),
        xRequestId: req.headers.get("x-request-id"),
        secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
      });

      // Passivo (flag desligada): nunca grava e nunca chama a API do MP.
      if (!autoConfirm) {
        return NextResponse.json({ ok: true, passive: true, provider: "mercadopago", assinaturaValida });
      }
      // Ativo exige assinatura MP valida: ausente/invalida -> 401, sem gravar.
      if (!assinaturaValida || !paymentId) {
        return NextResponse.json(
          { ok: true, passive: false, provider: "mercadopago", wouldConfirm: false, reason: "assinatura_invalida" },
          { status: 401 }
        );
      }
      // Busca autoritativa: status/valor/external_reference vem da API do MP,
      // nunca do corpo da notificacao.
      const pagamento = await buscarPagamentoMercadoPago(paymentId);
      if (!pagamento) {
        return NextResponse.json({ ok: true, passive: false, provider: "mercadopago", wouldConfirm: false, reason: "pagamento_indisponivel" });
      }
      payload = mapearPagamentoParaPayloadInterno(pagamento);
      mpAutorizado = true;
    } else {
      payload = corpo as PixWebhookPayload;
    }

    const resultado = avaliarWebhookPixPassivo(payload, pedidos);

    if (!autoConfirm) {
      return NextResponse.json({
        ok: true,
        passive: true,
        ...resultado,
      });
    }

    // Autorizacao para gravar: MP ja validou por assinatura; o webhook generico
    // continua exigindo o segredo compartilhado.
    if (!mpAutorizado) {
      const expectedSecret = process.env.PIX_WEBHOOK_SECRET;
      const receivedSecret = req.headers.get("x-pix-webhook-secret");
      if (!expectedSecret || receivedSecret !== expectedSecret) {
        return NextResponse.json({
          ok: true,
          passive: false,
          wouldConfirm: false,
          reason: "segredo_invalido",
        });
      }
    }

    const resultadoConfirmacao = await confirmarPixSeElegivel(payload);

    if (resultadoConfirmacao.tipo === "idempotente") {
      // Não chama o Sentinela aqui de propósito: esta é uma notificação
      // REDUNDANTE (o pedido já estava confirmado antes desta chamada). Se
      // uma cadeia QStash ainda estiver ativa, o próprio tick seguinte já se
      // encerra sozinho ao reler o pedido (decisão 4 do Sentinela) — sem
      // precisar de mais uma escrita no Redis para uma notificação que não
      // mudou nada.
      return NextResponse.json({
        ok: true,
        passive: false,
        wouldConfirm: false,
        confirmed: true,
        idempotent: true,
        reason: "pix_ja_confirmado",
        pedidoId: resultadoConfirmacao.pedidoId,
        txid: resultadoConfirmacao.txid,
      });
    }

    if (resultadoConfirmacao.tipo === "nao_confirma") {
      return NextResponse.json({
        ok: true,
        passive: false,
        ...resultadoConfirmacao.resultado,
      });
    }

    if (resultadoConfirmacao.tipo === "cobranca_substituida") {
      // Edição de pedido (ver AGENTS.md): quando o cliente altera valor/forma
      // de pagamento com um Pix ainda não pago, uma cobrança nova é criada
      // mas o txid interno (chefebot_<pedidoId>) permanece o mesmo por
      // design — o webhook casa por txid+valor. Sem esta checagem, o
      // pagamento de uma cobrança JÁ SUBSTITUÍDA (QR antigo, ainda visível em
      // algum print/cache do cliente) poderia confirmar a revisão nova do
      // pedido.
      return NextResponse.json({
        ok: true,
        passive: false,
        wouldConfirm: false,
        reason: "cobranca_substituida",
        pedidoId: resultadoConfirmacao.pedidoId,
        txid: resultadoConfirmacao.txid,
      });
    }

    const { resultado: resultadoFresco, confirmadoEm, pedido: pedidoConfirmado } = resultadoConfirmacao;

    // Best-effort — nunca pode afetar a confirmação acima, que já foi
    // persistida. Encerra a cadeia server-side do Guardião (se existir):
    // incrementa a geração, fazendo qualquer tick QStash já agendado virar
    // no-op assim que chegar, sem precisar cancelar a mensagem no QStash.
    if (pedidoConfirmado.id) {
      await registrarAtividadeWebhookSentinela(pedidoConfirmado.id, { confirmado: true }).catch(() => {});
      await incrementarContadorPix("sentinela_encerrado_webhook");
    }

    return NextResponse.json({
      ok: true,
      passive: false,
      confirmed: true,
      ...resultadoFresco,
      confirmadoEm,
    });
  } catch {
    return NextResponse.json(
      { ok: false, passive: true, wouldConfirm: false, reason: "payload_invalido" },
      { status: 400 }
    );
  }
}
