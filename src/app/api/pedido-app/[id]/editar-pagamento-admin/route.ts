import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import {
  criarPixMetadata,
  prepararPixProviderMercadoPago,
  serializarPixCliente,
} from "@/lib/pix";
import { temDinheiroNoPagamento, temPixNoPagamento, valorDinheiroEsperado } from "@/lib/bot";
import { normalizarPagamentoComposto, pagamentoAindaValido } from "@/lib/pagamentoComposto";
import {
  adquirirMutexEdicao,
  liberarMutexEdicao,
  lockEdicaoAtivo,
  pagamentoJaConfirmado,
} from "@/lib/pedidoEdicao";
import { montarResumoAlteracoes } from "@/lib/pedidoEdicaoResumo";
import type { PedidoRedis } from "@/types/pedidoRedis";

// Edição administrativa da forma de pagamento — atendente corrige um
// pedido já criado (inclusive já aceito pela loja) sem reabrir o pedido
// inteiro para edição do cliente. Reaproveita EXATAMENTE a mesma lógica de
// invalidação/criação de Pix de src/app/api/pedido-app/[id]/editar/salvar
// (nunca duplica a regra), mas nunca mexe em itens, total ou endereço —
// escopo é só forma de pagamento e troco.
//
// Nunca permite alterar um pagamento já confirmado (Pix confirmado
// automaticamente ou manualmente): o dinheiro já entrou, mudar a forma
// depois corromperia conciliação e histórico. Trocar PARA Pix sempre cria
// uma cobrança nova e pendente — a edição administrativa nunca confirma Pix
// sozinha, só o Guardião/verificação manual existente confirmam depois.

type ConfigPizzariaPix = {
  nomePizzaria?: string;
  chavePix?: string;
  nomeTitularPix?: string;
  whatsappPizzaria?: string;
};

type EditarPagamentoAdminBody = {
  pagamento?: string;
  troco?: string;
};

type ResultadoEditarPagamentoAdmin =
  | { tipo: "nao_encontrado" }
  | { tipo: "cancelado" }
  | { tipo: "pagamento_confirmado" }
  | { tipo: "edicao_cliente_ativa" }
  | { tipo: "ok"; atualizado: PedidoRedis };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoAdmin = await lerSessaoAdministrativa(req);
  if (!sessaoAdmin) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  let body: EditarPagamentoAdminBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  if (!id || !body.pagamento || !body.pagamento.trim()) {
    return NextResponse.json({ ok: false, error: "Forma de pagamento obrigatória" }, { status: 400 });
  }
  const pagamento = normalizarPagamentoComposto(body.pagamento.trim()) ?? body.pagamento.trim();
  if (temDinheiroNoPagamento(pagamento) && !body.troco?.trim()) {
    return NextResponse.json({ ok: false, error: "Troco obrigatorio para dinheiro" }, { status: 400 });
  }

  const mutexToken = await adquirirMutexEdicao(id);
  if (!mutexToken) {
    return NextResponse.json({ ok: false, error: "Não foi possível salvar agora. Tente de novo." }, { status: 409 });
  }

  try {
    const pedidos = (await redis.get<PedidoRedis[]>("pedidos")) || [];
    const index = pedidos.findIndex((p) => p.id === id);
    if (index < 0) {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    const pedido = pedidos[index];

    if (pedido.status === "cancelado") {
      return NextResponse.json({ ok: false, error: "Pedido cancelado não pode ter o pagamento editado" }, { status: 409 });
    }
    if (pagamentoJaConfirmado(pedido)) {
      return NextResponse.json(
        { ok: false, error: "O pagamento deste pedido já foi confirmado e não pode mais ser alterado." },
        { status: 409 }
      );
    }
    if (pedido.editStatus === "editing" && lockEdicaoAtivo(pedido)) {
      return NextResponse.json(
        { ok: false, error: "O cliente está editando este pedido agora. Tente novamente em instantes." },
        { status: 409 }
      );
    }

    const total = pedido.total;
    if (!pagamentoAindaValido(pagamento, total)) {
      return NextResponse.json(
        { ok: false, error: "A divisão entre Pix e dinheiro não fecha com o total do pedido." },
        { status: 400 }
      );
    }
    if (temDinheiroNoPagamento(pagamento) && body.troco?.trim() && !/sem\s*troco/i.test(body.troco)) {
      const valorTroco = parseFloat(body.troco.replace(",", ".").replace(/[^0-9.]/g, ""));
      const baseTroco = valorDinheiroEsperado(pagamento, total);
      if (isNaN(valorTroco) || valorTroco < baseTroco) {
        return NextResponse.json({ ok: false, error: "Valor de troco insuficiente para a parte em dinheiro" }, { status: 400 });
      }
    }

    const pagamentoAnterior = normalizarPagamentoComposto(pedido.pagamento) ?? pedido.pagamento;
    if ((pagamentoAnterior || "") === pagamento && (pedido.troco || "") === (body.troco || "")) {
      return NextResponse.json({ ok: true, pedidoId: id, pagamento, troco: pedido.troco, changed: false });
    }

    const tinhaPixAnterior = temPixNoPagamento(pagamentoAnterior) && !!pedido.pix;
    const novoTemPix = temPixNoPagamento(pagamento);
    const configPix = (await redis.get<ConfigPizzariaPix>("config:pizzaria")) || {};

    let novoPix: PedidoRedis["pix"] | undefined = pedido.pix;
    let pixSubstituido = pedido.pixSubstituido || [];

    if (tinhaPixAnterior) {
      // Só o valor esperado e a forma decidem se a cobrança anterior precisa
      // ser invalidada — aqui o total nunca muda (esta rota não toca itens),
      // então só a forma de pagamento pode disparar a substituição.
      const formaMudou = (pagamentoAnterior || "") !== pagamento;
      if (formaMudou) {
        pixSubstituido = [
          ...pixSubstituido,
          {
            providerPaymentId: pedido.pix?.providerPaymentId,
            txid: pedido.pix?.txid,
            valorEsperado: pedido.pix?.valorEsperado,
            substituidoEm: new Date().toISOString(),
          },
        ];
        if (novoTemPix) {
          const pixBase = criarPixMetadata(id, pagamento, total);
          novoPix = await prepararPixProviderMercadoPago({
            pedidoId: id,
            pix: pixBase,
            clienteNome: pedido.cliente,
          });
        } else {
          novoPix = undefined;
        }
      }
    } else if (novoTemPix) {
      const pixBase = criarPixMetadata(id, pagamento, total);
      novoPix = await prepararPixProviderMercadoPago({
        pedidoId: id,
        pix: pixBase,
        clienteNome: pedido.cliente,
      });
    }

    const changesSummary = montarResumoAlteracoes(
      {
        itens: pedido.itens,
        total: pedido.total,
        pagamento: pedido.pagamento,
        tipoEntrega: pedido.tipoEntrega,
        endereco: pedido.endereco,
        troco: pedido.troco,
        observacao: pedido.observacao,
      },
      {
        itens: pedido.itens,
        total: pedido.total,
        pagamento,
        tipoEntrega: pedido.tipoEntrega,
        endereco: pedido.endereco,
        troco: body.troco,
        observacao: pedido.observacao,
      }
    );

    const agora = new Date().toISOString();
    const revisaoAtual = pedido.revision ?? 1;
    const novaRevisao = revisaoAtual + 1;
    const pixSubstituidoAntes = pedido.pixSubstituido?.length || 0;
    const camposAtualizados: Partial<PedidoRedis> = {
      pagamento,
      ...(body.troco ? { troco: body.troco } : { troco: undefined }),
      pix: novoPix,
      pixSubstituido,
      revision: novaRevisao,
      editedAt: agora,
      editedBy: "atendente",
      changesSummary,
    };

    // Pix já foi preparado acima (chamada externa ao Mercado Pago, fora de
    // qualquer lock). Daqui pra frente: protegido pelo lock GLOBAL de
    // "pedidos" (ver src/lib/pedidosConcorrencia.ts) — releitura fresca,
    // revalidação das mesmas invariantes contra esse estado fresco, e só
    // então a escrita. O mutex por pedido continua segurado durante toda a
    // rota.
    const resultadoPersistencia = await mutarPedidos<PedidoRedis, ResultadoEditarPagamentoAdmin>((pedidosFrescos) => {
      const indexFresco = pedidosFrescos.findIndex((p) => p.id === id);
      if (indexFresco < 0) return { persistir: false, resultado: { tipo: "nao_encontrado" } };
      const pedidoFresco = pedidosFrescos[indexFresco];
      if (pedidoFresco.status === "cancelado") return { persistir: false, resultado: { tipo: "cancelado" } };
      if (pagamentoJaConfirmado(pedidoFresco)) return { persistir: false, resultado: { tipo: "pagamento_confirmado" } };
      if (pedidoFresco.editStatus === "editing" && lockEdicaoAtivo(pedidoFresco)) {
        return { persistir: false, resultado: { tipo: "edicao_cliente_ativa" } };
      }

      const atualizadoFinal: PedidoRedis = {
        ...pedidoFresco,
        ...camposAtualizados,
        editHistory: [
          ...(pedidoFresco.editHistory || []),
          { tipo: "salvo", horario: agora, revisaoAnterior: revisaoAtual, revisaoNova: novaRevisao, resumo: changesSummary },
        ],
      };
      const atualizados = [...pedidosFrescos];
      atualizados[indexFresco] = atualizadoFinal;
      return { persistir: true, pedidos: atualizados, resultado: { tipo: "ok", atualizado: atualizadoFinal } };
    });

    if (resultadoPersistencia.tipo === "nao_encontrado") {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    if (resultadoPersistencia.tipo === "cancelado") {
      return NextResponse.json({ ok: false, error: "Pedido cancelado não pode ter o pagamento editado" }, { status: 409 });
    }
    if (resultadoPersistencia.tipo === "pagamento_confirmado") {
      return NextResponse.json(
        { ok: false, error: "O pagamento deste pedido já foi confirmado e não pode mais ser alterado." },
        { status: 409 }
      );
    }
    if (resultadoPersistencia.tipo === "edicao_cliente_ativa") {
      return NextResponse.json(
        { ok: false, error: "O cliente está editando este pedido agora. Tente novamente em instantes." },
        { status: 409 }
      );
    }

    const atualizado = resultadoPersistencia.atualizado;
    const pixCliente = serializarPixCliente(atualizado.pix, configPix);
    return NextResponse.json({
      ok: true,
      pedidoId: id,
      pagamento,
      troco: atualizado.troco,
      revision: novaRevisao,
      changesSummary,
      pixSubstituido: pixSubstituido.length > pixSubstituidoAntes,
      ...(pixCliente ? { pix: pixCliente } : {}),
    });
  } finally {
    await liberarMutexEdicao(id, mutexToken);
  }
}
