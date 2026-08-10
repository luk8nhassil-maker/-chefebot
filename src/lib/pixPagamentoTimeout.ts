import { redis } from "./redis";
import { mutarPedidos } from "./pedidosConcorrencia";
import type { PedidoComPix } from "./pix";
import type { PedidoParaJornada } from "./jornadaChef";
import {
  PIX_PAGAMENTO_AVISO_PENDENTE_MS,
  PIX_PAGAMENTO_CANCELAMENTO_MS,
  PIX_PAGAMENTO_RETRY_INCONCLUSIVO_MS,
} from "./pixAutoCheckConfig";
import {
  cancelarPagamentoMercadoPagoPendente,
  consultarEstadoPagamentoMercadoPago,
} from "./mercadoPagoCancelamento";
import { reconciliarPixMercadoPago } from "./mercadoPagoReconciliacao";
import { enviarTextoWhatsApp } from "./whatsappMensagem";
import { encerrarSentinela } from "./pixSentinela";
import {
  calcularPontosElegiveisPedido,
  construirEventoIdPontos,
  derivarClienteIdPorTelefone,
  registrarMovimentoPontosIdempotente,
  reverterResgateConfirmado,
} from "./fidelidade";
import {
  liberarRecompensaDePedidoCancelado,
  reverterConclusaoPedidoJornada,
} from "./jornadaChef";

type PedidoTimeoutPix = PedidoComPix & PedidoParaJornada & {
  id: string;
  numero?: number;
  cliente?: string;
  telefone?: string;
  total?: number;
  taxaEntrega?: number;
  status?: string;
  resgateId?: string;
  cancelamentoSolicitado?: boolean;
  statusAtualizadoEm?: string;
};

export type ResultadoPoliticaTimeoutPix = {
  encerrado: boolean;
  motivo: string;
  proximoDelayMs?: number;
  avisoEnviado?: boolean;
  cancelado?: boolean;
};

const TTL_MARCADORES_SEGUNDOS = 24 * 60 * 60;
const PREFIXO_AVISO = "pix:timeout:aviso:";
const PREFIXO_LOCK_AVISO = "pix:timeout:lock:aviso:";
const PREFIXO_CANCELADO = "pix:timeout:cancelado:";
const PREFIXO_LOCK_CANCELAMENTO = "pix:timeout:lock:cancelamento:";

function idadePixMs(pedido: PedidoTimeoutPix, agora: number): number | null {
  const criadoEm = pedido.pix?.criadoEm;
  if (!criadoEm) return null;
  const criado = new Date(criadoEm).getTime();
  if (!Number.isFinite(criado)) return null;
  return Math.max(0, agora - criado);
}

function pedidoElegivel(pedido: PedidoTimeoutPix | undefined): pedido is PedidoTimeoutPix {
  return !!(
    pedido &&
    pedido.status === "novo" &&
    pedido.pix?.provider === "mercadopago" &&
    pedido.pix?.providerPaymentId?.trim() &&
    pedido.pix?.status !== "confirmado" &&
    pedido.pixConfirmado !== true
  );
}

function telefoneWhatsapp(telefone: string | undefined): string | null {
  const digits = String(telefone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function primeiroNome(cliente: string | undefined): string {
  return String(cliente || "Cliente").trim().split(/\s+/)[0] || "Cliente";
}

async function enviarAvisoPendente(pedido: PedidoTimeoutPix): Promise<boolean> {
  const marcador = `${PREFIXO_AVISO}${pedido.id}`;
  if (await redis.get(marcador)) return true;

  const lock = `${PREFIXO_LOCK_AVISO}${pedido.id}`;
  const ganhou = await redis.set(lock, "1", { nx: true, ex: 30 });
  if (!ganhou) return false;
  try {
    if (await redis.get(marcador)) return true;
    const phone = telefoneWhatsapp(pedido.telefone);
    if (!phone) {
      await redis.set(marcador, "sem_telefone", { ex: TTL_MARCADORES_SEGUNDOS });
      return true;
    }
    const nome = primeiroNome(pedido.cliente);
    const mensagem = `*${nome}*, seu pagamento Pix ainda está pendente. ⏳\n\nConclua o pagamento para manter seu pedido. O prazo total é de 13 minutos a partir da geração do Pix. Depois disso, o pedido é cancelado automaticamente.`;
    const resultado = await enviarTextoWhatsApp(phone, mensagem);
    if (!resultado.ok) return false;
    await redis.set(marcador, "enviado", { ex: TTL_MARCADORES_SEGUNDOS });
    return true;
  } finally {
    await redis.del(lock).catch(() => {});
  }
}

async function enviarCancelamentoAutomatico(pedido: PedidoTimeoutPix): Promise<void> {
  const phone = telefoneWhatsapp(pedido.telefone);
  if (!phone) return;
  const nome = primeiroNome(pedido.cliente);
  const mensagem = `*${nome}*, seu pedido foi cancelado automaticamente. ❌\n\nMotivo: o pagamento Pix não foi confirmado dentro do prazo de 13 minutos.\n\nO Pix pendente também foi encerrado para evitar pagamento depois do cancelamento. Se ainda quiser pedir, faça um novo pedido.`;
  const resultado = await enviarTextoWhatsApp(phone, mensagem);
  if (!resultado.ok) {
    console.error("[Pix timeout] Pedido cancelado, mas a mensagem ao cliente não foi enviada.", {
      pedidoId: pedido.id,
      motivo: resultado.motivo,
    });
  }
}

async function processarEfeitosCancelamento(pedido: PedidoTimeoutPix): Promise<void> {
  try {
    const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
    const pontos = calcularPontosElegiveisPedido({
      total: Number(pedido.total) || 0,
      taxaEntrega: pedido.taxaEntrega,
    });
    if (clienteId && pontos > 0) {
      await registrarMovimentoPontosIdempotente(clienteId, {
        eventoId: construirEventoIdPontos(pedido.id, "cancelado"),
        pedidoId: pedido.id,
        tipo: "cancelado",
        pontos,
        motivo: `Pedido ${pedido.id} cancelado automaticamente por Pix não confirmado em 13 minutos`,
      });
    }
  } catch (error) {
    console.error("[Pix timeout] Falha ao registrar cancelamento de pontos (ignorada).", error);
  }

  if (pedido.resgateId) {
    try {
      const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
      if (clienteId) {
        await reverterResgateConfirmado(
          clienteId,
          pedido.resgateId,
          `Pedido ${pedido.id} cancelado automaticamente por Pix não confirmado`
        );
      }
    } catch (error) {
      console.error("[Pix timeout] Falha ao reverter resgate (ignorada).", error);
    }
  }

  try {
    await reverterConclusaoPedidoJornada(pedido.id, `Pedido ${pedido.id} cancelado automaticamente por Pix não confirmado`);
    await liberarRecompensaDePedidoCancelado(pedido);
  } catch (error) {
    console.error("[Pix timeout] Falha ao reverter Jornada do Chef (ignorada).", error);
  }
}

async function confirmarSePagamentoAprovado(pedidoId: string): Promise<boolean> {
  const resumo = await reconciliarPixMercadoPago({ apenasPedidoIds: [pedidoId] });
  if (resumo.confirmados > 0) {
    await encerrarSentinela(pedidoId, "confirmado");
    return true;
  }
  return false;
}

export async function processarPoliticaTimeoutPagamentoPix(input: {
  pedidoId: string;
  agora?: number;
}): Promise<ResultadoPoliticaTimeoutPix> {
  const agora = input.agora ?? Date.now();
  const pedidos = (await redis.get<PedidoTimeoutPix[]>("pedidos")) || [];
  const pedido = pedidos.find((item) => item.id === input.pedidoId);
  if (!pedidoElegivel(pedido)) return { encerrado: false, motivo: "pedido_nao_elegivel" };

  const idade = idadePixMs(pedido, agora);
  if (idade === null) return { encerrado: false, motivo: "idade_indeterminada" };
  if (idade < PIX_PAGAMENTO_AVISO_PENDENTE_MS) return { encerrado: false, motivo: "antes_do_aviso" };

  if (idade < PIX_PAGAMENTO_CANCELAMENTO_MS) {
    const marcadorAviso = await redis.get(`${PREFIXO_AVISO}${pedido.id}`);
    if (marcadorAviso) return { encerrado: false, motivo: "aviso_ja_processado" };

    const estado = await consultarEstadoPagamentoMercadoPago(pedido.pix.providerPaymentId as string);
    if (estado.estado === "pago") {
      const confirmou = await confirmarSePagamentoAprovado(pedido.id);
      if (confirmou) return { encerrado: true, motivo: "confirmado_no_marco_aviso" };
      return { encerrado: false, motivo: "pago_aguardando_conciliacao", proximoDelayMs: 5_000 };
    }
    if (estado.estado === "nao_cobravel") {
      await redis.set(`${PREFIXO_AVISO}${pedido.id}`, "nao_pendente", { ex: TTL_MARCADORES_SEGUNDOS });
      return { encerrado: false, motivo: "pagamento_nao_pendente" };
    }
    if (estado.estado === "inconclusivo") {
      return { encerrado: false, motivo: "consulta_inconclusiva_no_aviso", proximoDelayMs: PIX_PAGAMENTO_RETRY_INCONCLUSIVO_MS };
    }

    const enviado = await enviarAvisoPendente(pedido);
    return enviado
      ? { encerrado: false, motivo: "aviso_enviado", avisoEnviado: true }
      : { encerrado: false, motivo: "aviso_envio_falhou", proximoDelayMs: PIX_PAGAMENTO_RETRY_INCONCLUSIVO_MS };
  }

  const lockCancelamento = `${PREFIXO_LOCK_CANCELAMENTO}${pedido.id}`;
  const ganhouCancelamento = await redis.set(lockCancelamento, "1", { nx: true, ex: 30 });
  if (!ganhouCancelamento) {
    return { encerrado: false, motivo: "cancelamento_em_andamento", proximoDelayMs: 5_000 };
  }

  try {
    const resultadoProvider = await cancelarPagamentoMercadoPagoPendente(pedido.pix.providerPaymentId as string);
    if (resultadoProvider.estado === "pago") {
      const confirmou = await confirmarSePagamentoAprovado(pedido.id);
      if (confirmou) return { encerrado: true, motivo: "confirmado_no_marco_cancelamento" };
      return { encerrado: false, motivo: "pago_aguardando_conciliacao", proximoDelayMs: 5_000 };
    }
    if (resultadoProvider.estado === "ainda_pendente" || resultadoProvider.estado === "inconclusivo") {
      return { encerrado: false, motivo: "cancelamento_provider_inconclusivo", proximoDelayMs: PIX_PAGAMENTO_RETRY_INCONCLUSIVO_MS };
    }

    const mutacao = await mutarPedidos<PedidoTimeoutPix, { cancelado: boolean; pedido?: PedidoTimeoutPix; motivo: string }>((frescos) => {
      const index = frescos.findIndex((item) => item.id === pedido.id);
      if (index < 0) return { persistir: false, resultado: { cancelado: false, motivo: "pedido_nao_encontrado" } };
      const atual = frescos[index];
      if (!pedidoElegivel(atual) || atual.pix?.providerPaymentId !== pedido.pix?.providerPaymentId) {
        return { persistir: false, resultado: { cancelado: false, pedido: atual, motivo: "estado_mudou" } };
      }
      const atualizado: PedidoTimeoutPix = {
        ...atual,
        status: "cancelado",
        cancelamentoSolicitado: false,
        statusAtualizadoEm: new Date(agora).toISOString(),
      };
      const proximos = [...frescos];
      proximos[index] = atualizado;
      return { persistir: true, pedidos: proximos, resultado: { cancelado: true, pedido: atualizado, motivo: "cancelado" } };
    });

    if (!mutacao.cancelado || !mutacao.pedido) {
      if (mutacao.pedido?.pixConfirmado === true || mutacao.pedido?.pix?.status === "confirmado") {
        await encerrarSentinela(pedido.id, "confirmado");
        return { encerrado: true, motivo: "confirmado_durante_cancelamento" };
      }
      return { encerrado: false, motivo: mutacao.motivo, proximoDelayMs: 5_000 };
    }

    await redis.set(`${PREFIXO_CANCELADO}${pedido.id}`, new Date(agora).toISOString(), { ex: TTL_MARCADORES_SEGUNDOS });
    await processarEfeitosCancelamento(mutacao.pedido);
    await enviarCancelamentoAutomatico(mutacao.pedido);
    await encerrarSentinela(pedido.id, "cancelado");
    return { encerrado: true, motivo: "cancelado_pix_13_minutos", cancelado: true };
  } finally {
    await redis.del(lockCancelamento).catch(() => {});
  }
}

export async function processarTimeoutsPixPendentesEmLote(): Promise<{
  avaliados: number;
  avisos: number;
  cancelados: number;
  pendentesRetry: number;
}> {
  const agora = Date.now();
  const pedidos = (await redis.get<PedidoTimeoutPix[]>("pedidos")) || [];
  const ids = pedidos
    .filter((pedido) => pedidoElegivel(pedido) && (idadePixMs(pedido, agora) ?? -1) >= PIX_PAGAMENTO_AVISO_PENDENTE_MS)
    .map((pedido) => pedido.id)
    .slice(0, 20);

  const resumo = { avaliados: 0, avisos: 0, cancelados: 0, pendentesRetry: 0 };
  for (const pedidoId of ids) {
    const resultado = await processarPoliticaTimeoutPagamentoPix({ pedidoId, agora });
    resumo.avaliados++;
    if (resultado.avisoEnviado) resumo.avisos++;
    if (resultado.cancelado) resumo.cancelados++;
    if (typeof resultado.proximoDelayMs === "number") resumo.pendentesRetry++;
  }
  return resumo;
}
