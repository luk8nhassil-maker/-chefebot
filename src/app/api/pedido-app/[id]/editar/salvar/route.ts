import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getMENUDinamico } from "@/lib/menu.server";
import { computeTaxaApp, buildEnderecoApp } from "@/lib/pedidoAppLogic";
import {
  criarPixMetadata,
  prepararPixProviderMercadoPago,
  serializarPixCliente,
} from "@/lib/pix";
import { PROMOS_KEY, catalogoDoMenu, dentroDaJanela, precoFinalPromocao, promocaoIndisponivel, type Promocao } from "@/lib/promocoes";
import { temDinheiroNoPagamento, valorDinheiroEsperado, temPixNoPagamento } from "@/lib/bot";
import { normalizarPagamentoComposto, pagamentoAindaValido } from "@/lib/pagamentoComposto";
import {
  type ItemApp,
  type MenuPedidoApp,
  formatItem,
  officialUnitPrice,
  makePromoUnitPrice,
} from "@/lib/pedidoAppItens";
import type { PedidoRedis } from "@/types/pedidoRedis";
import { montarResumoAlteracoes } from "@/lib/pedidoEdicaoResumo";
import {
  adquirirMutexEdicao,
  liberarMutexEdicao,
  tokensIguais,
  lockEdicaoAtivo,
  pedidoAguardandoAceite,
  pagamentoJaConfirmado,
} from "@/lib/pedidoEdicao";

type SalvarEdicaoBody = {
  statusToken?: string;
  editSessionId?: string;
  revision?: number;
  itens?: ItemApp[];
  tipoEntrega?: "delivery" | "retirada" | "dine_in";
  bairro?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  pagamento?: string;
  troco?: string;
  observacao?: string;
};

type ConfigPizzariaPix = {
  nomePizzaria?: string;
  chavePix?: string;
  nomeTitularPix?: string;
  whatsappPizzaria?: string;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: SalvarEdicaoBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const statusToken = (body.statusToken || "").trim();
  const editSessionId = (body.editSessionId || "").trim();
  if (!id || !statusToken || !editSessionId || !Array.isArray(body.itens) || body.itens.length === 0) {
    return NextResponse.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
  }
  if (!body.pagamento || !body.pagamento.trim()) {
    return NextResponse.json({ ok: false, error: "Forma de pagamento obrigatória" }, { status: 400 });
  }
  // Forma canônica antes de qualquer efeito: um pagamento composto que chegue
  // com a grafia legada (ponto decimal) é renormalizado aqui. Os helpers de
  // src/lib/bot.ts leem o ponto como separador de MILHAR, então "R$ 30.00"
  // viraria R$ 3.000 na cobrança Pix e na base do troco — ver
  // src/lib/pagamentoComposto.ts. Pagamento simples passa intacto.
  const pagamento = normalizarPagamentoComposto(body.pagamento.trim()) ?? body.pagamento.trim();
  if (temDinheiroNoPagamento(pagamento) && !body.troco?.trim()) {
    return NextResponse.json({ ok: false, error: "Troco obrigatorio para dinheiro" }, { status: 400 });
  }
  if (body.tipoEntrega === "delivery" && (!body.bairro?.trim() || !body.rua?.trim() || !body.numero?.trim())) {
    return NextResponse.json({ ok: false, error: "Endereco obrigatorio para entrega" }, { status: 400 });
  }

  const mutexToken = await adquirirMutexEdicao(id);
  if (!mutexToken) {
    return NextResponse.json({ ok: false, error: "Não foi possível salvar agora. Tente de novo." }, { status: 409 });
  }

  try {
    const pedidos = (await redis.get<PedidoRedis[]>("pedidos")) || [];
    const index = pedidos.findIndex((p) => p.id === id);
    if (index < 0 || !tokensIguais(pedidos[index].statusToken, statusToken)) {
      return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
    }
    const pedido = pedidos[index];

    // Idempotência de clique duplo / retry de rede: se esta MESMA sessão de
    // edição já salvou (editSessionId consumido), devolve o resultado já
    // persistido em vez de rejeitar como "sessão inválida".
    if (pedido.editStatus === "edited" && pedido.lastEditSessionId === editSessionId) {
      const configPixRepeat = (await redis.get<ConfigPizzariaPix>("config:pizzaria")) || {};
      const pixClienteRepeat = serializarPixCliente(pedido.pix, configPixRepeat);
      return NextResponse.json({
        ok: true,
        idempotent: true,
        pedidoId: pedido.id,
        numero: pedido.numero,
        total: pedido.total,
        statusToken: pedido.statusToken,
        revision: pedido.revision ?? 1,
        changesSummary: pedido.changesSummary || [],
        ...(pixClienteRepeat ? { pix: pixClienteRepeat } : {}),
      });
    }

    if (!pedidoAguardandoAceite(pedido)) {
      return NextResponse.json(
        { ok: false, error: "Este pedido já foi aceito pela loja e não pode mais ser alterado." },
        { status: 409 }
      );
    }
    if (pagamentoJaConfirmado(pedido)) {
      return NextResponse.json(
        { ok: false, error: "O pagamento deste pedido já foi confirmado. Para alterar o pedido, fale diretamente com a loja." },
        { status: 409 }
      );
    }
    if (pedido.editStatus !== "editing" || pedido.editSessionId !== editSessionId) {
      return NextResponse.json(
        { ok: false, error: "Sessão de edição inválida. Toque em Editar pedido novamente." },
        { status: 409 }
      );
    }
    if (!lockEdicaoAtivo(pedido)) {
      return NextResponse.json(
        { ok: false, error: "O tempo para editar terminou. Seu pedido original foi mantido." },
        { status: 410 }
      );
    }
    const revisaoAtual = pedido.revision ?? 1;
    if (typeof body.revision === "number" && body.revision !== revisaoAtual) {
      return NextResponse.json(
        { ok: false, error: "O pedido mudou enquanto você editava. Recarregue e tente novamente." },
        { status: 409 }
      );
    }

    const menu = await getMENUDinamico();

    const temPromo = body.itens.some((item) => item.kind === "promo");
    const promos = temPromo ? ((await redis.get<Promocao[]>(PROMOS_KEY)) || []) : [];
    const esgotadosPromo = temPromo ? ((await redis.get<string[]>("esgotados")) || []) : [];
    const catalogoPromo = temPromo ? catalogoDoMenu(menu as never) : [];
    const promoUnitPrice = makePromoUnitPrice({
      promos,
      esgotadosPromo,
      dentroDaJanela,
      promocaoIndisponivel,
      precoFinalPromocao: (promo) => precoFinalPromocao(promo, catalogoPromo),
    });

    const itensValidados = body.itens.map((item) => ({
      linha: formatItem(item),
      unitPrice: item.kind === "promo" ? promoUnitPrice(item) : officialUnitPrice(item, menu as MenuPedidoApp),
      qty: item.qty,
    }));
    if (itensValidados.some((item) => item.unitPrice === null)) {
      return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
    }
    const itens = itensValidados.map((item) => item.linha);
    const subtotal = itensValidados.reduce((s, item) => s + item.unitPrice! * item.qty, 0);

    // Desconto de fidelidade (resgate) já foi validado e debitado na criação
    // do pedido — a edição preserva o valor concedido, nunca revalida a
    // reserva de novo (ela já foi consumida e não existe mais como "reservado").
    const descontoFidelidade = pedido.descontoFidelidade || 0;
    const subtotalComDesconto = Math.max(0, subtotal - descontoFidelidade);
    const taxa = computeTaxaApp(body.tipoEntrega || "retirada", body.bairro, menu.neighborhoods as Array<{ name: string; fee: number }>);
    const total = subtotalComDesconto + taxa;

    // Invariante do pagamento composto: a soma das partes é revalidada contra
    // o total RECALCULADO agora, nunca contra o que foi gravado na criação.
    // Alterar itens muda o total, e um pagamento misto que fechava antes pode
    // deixar de fechar — sem esta checagem a loja receberia Pix + dinheiro
    // somando um valor diferente do pedido.
    if (!pagamentoAindaValido(pagamento, total)) {
      return NextResponse.json(
        { ok: false, error: "A divisão entre Pix e dinheiro não fecha com o novo total do pedido. Ajuste os valores antes de salvar." },
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

    const endereco = buildEnderecoApp({ tipoEntrega: body.tipoEntrega || "retirada", rua: body.rua, numero: body.numero, bairro: body.bairro });

    // --- Pix: nunca deixa a cobrança antiga confirmar a revisão nova ---
    // Comparação sempre entre formas canônicas: um pedido antigo gravado com
    // a grafia legada não deve contar como "forma mudou" só por ter sido
    // renormalizado, o que substituiria uma cobrança Pix ainda válida.
    const pagamentoAnterior = normalizarPagamentoComposto(pedido.pagamento) ?? pedido.pagamento;
    const tinhaPixAnterior = temPixNoPagamento(pagamentoAnterior) && !!pedido.pix;
    const novoTemPix = temPixNoPagamento(pagamento);
    const configPix = (await redis.get<ConfigPizzariaPix>("config:pizzaria")) || {};

    let novoPix: PedidoRedis["pix"] | undefined = pedido.pix;
    let pixSubstituido = pedido.pixSubstituido || [];

    if (tinhaPixAnterior) {
      // Qualquer mudança financeira (valor, forma de pagamento) invalida a
      // cobrança anterior — ela nunca deve conseguir confirmar a revisão nova.
      const valorMudou = Math.round((pedido.total || 0) * 100) !== Math.round(total * 100);
      const formaMudou = (pagamentoAnterior || "") !== (pagamento || "");
      if (valorMudou || formaMudou) {
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
      // Se não mudou valor nem forma, mantém a cobrança Pix existente intacta.
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
      { itens, total, pagamento, tipoEntrega: body.tipoEntrega, endereco, troco: body.troco, observacao: body.observacao }
    );

    const agora = new Date().toISOString();
    const novaRevisao = revisaoAtual + 1;
    const atualizado: PedidoRedis = {
      ...pedido,
      itens,
      itensDetalhados: body.itens,
      total,
      ...(taxa ? { taxaEntrega: taxa } : { taxaEntrega: undefined }),
      endereco,
      ...(body.tipoEntrega ? { tipoEntrega: body.tipoEntrega } : {}),
      ...(body.tipoEntrega === "delivery" ? { bairro: body.bairro, rua: body.rua, enderecoNumero: body.numero } : { bairro: undefined, rua: undefined, enderecoNumero: undefined }),
      ...(body.referencia ? { referencia: body.referencia } : { referencia: undefined }),
      pagamento,
      ...(body.troco ? { troco: body.troco } : { troco: undefined }),
      ...(body.observacao ? { observacao: body.observacao } : { observacao: undefined }),
      pix: novoPix,
      pixSubstituido,
      revision: novaRevisao,
      editStatus: "edited",
      editSessionId: undefined,
      editStartedAt: undefined,
      editExpiresAt: undefined,
      lastEditSessionId: editSessionId,
      editedAt: agora,
      editedBy: "cliente",
      changesSummary,
      editHistory: [
        ...(pedido.editHistory || []),
        { tipo: "salvo", horario: agora, revisaoAnterior: revisaoAtual, revisaoNova: novaRevisao, resumo: changesSummary },
      ],
    };
    pedidos[index] = atualizado;
    await redis.set("pedidos", pedidos);

    const pixCliente = serializarPixCliente(atualizado.pix, configPix);
    return NextResponse.json({
      ok: true,
      pedidoId: id,
      numero: atualizado.numero,
      total,
      statusToken: atualizado.statusToken,
      revision: novaRevisao,
      changesSummary,
      pixSubstituido: pixSubstituido.length > 0,
      ...(pixCliente ? { pix: pixCliente } : {}),
    });
  } finally {
    await liberarMutexEdicao(id, mutexToken);
  }
}
