import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { obterEsgotadosEfetivos } from "@/lib/estoque";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
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
import {
  temSelecaoEstruturada,
  resolverItemComSelecaoEstruturada,
  temSelecaoSimplesEstruturada,
  resolverItemComSelecaoSimplesEstruturada,
  temSelecaoDupla,
} from "@/lib/pedidoAppSelecaoEstruturada";
import { buildPizzaCatalog } from "@/lib/catalog/pizzas";
import { buildSimpleCatalog } from "@/lib/catalog/simpleProducts";
import { construirSnapshotItem, construirSnapshotOficial } from "@/lib/pedidoSnapshot";
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

type ResultadoSalvarEdicao =
  | { tipo: "nao_encontrado" }
  | { tipo: "sessao_invalida" }
  | { tipo: "tempo_esgotado" }
  | { tipo: "revisao_mudou" }
  | { tipo: "ok"; atualizado: PedidoRedis };

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
    const esgotadosPromo = temPromo ? (await obterEsgotadosEfetivos(menu)) : [];
    const catalogoPromo = temPromo ? catalogoDoMenu(menu as never) : [];
    const promoUnitPrice = makePromoUnitPrice({
      promos,
      esgotadosPromo,
      dentroDaJanela,
      promocaoIndisponivel,
      precoFinalPromocao: (promo) => precoFinalPromocao(promo, catalogoPromo),
    });

    // Itens com seleção estruturada por ID (Fase 2/6 — catálogo/motor nativo
    // de pizza e dos demais produtos configuráveis): resolvidos por
    // @/lib/pricing/pizzaEngine / @/lib/catalog/simpleProducts, nunca por
    // officialUnitPrice/name-detail às cegas. Um item reconhecido aqui como
    // "novo formato" (tem pizzaSelection ou simpleSelection) que falhe a
    // validação é definitivo — NUNCA cai para o caminho legado abaixo.
    // `esgotados` é lido FRESCO do Redis (compartilhado pelos dois
    // catálogos) sempre que algum item precisa dele — um sabor/produto que
    // esgota entre a montagem da edição e o salvamento é pego aqui.
    const temSelecaoPizzaEstruturada = body.itens.some((item) => temSelecaoEstruturada(item));
    const temSelecaoSimplesEstruturadaAlgumItem = body.itens.some((item) => temSelecaoSimplesEstruturada(item));
    const esgotadosFresco = temSelecaoPizzaEstruturada || temSelecaoSimplesEstruturadaAlgumItem
      ? (await obterEsgotadosEfetivos(menu))
      : [];
    const pizzaCatalog = temSelecaoPizzaEstruturada ? buildPizzaCatalog(menu, esgotadosFresco) : null;
    const simpleCatalog = temSelecaoSimplesEstruturadaAlgumItem ? buildSimpleCatalog(menu, esgotadosFresco) : null;

    let itensValidados: { itemCanonico: ItemApp; linha: string; unitPrice: number | null; qty: number; motivo?: string }[];
    try {
      itensValidados = body.itens.map((item) => {
        // Fail-closed (hardening pós-auditoria, 5ª rodada): pizzaSelection
        // E simpleSelection juntas no mesmo item nunca são resolvidas por
        // precedência silenciosa — o item inteiro é rejeitado ANTES de
        // qualquer resolver ser escolhido.
        if (temSelecaoDupla(item)) {
          return { itemCanonico: item, linha: "", unitPrice: null, qty: item.qty, motivo: "Seleção dupla (pizzaSelection e simpleSelection juntas)" };
        }
        if (temSelecaoEstruturada(item)) {
          const resolvido = resolverItemComSelecaoEstruturada(item, pizzaCatalog!);
          if (!resolvido.ok) return { itemCanonico: item, linha: "", unitPrice: null, qty: item.qty, motivo: resolvido.error };
          return {
            itemCanonico: resolvido.item,
            linha: formatItem(resolvido.item),
            unitPrice: resolvido.item.price,
            qty: item.qty,
          };
        }
        // Itens simples com seleção estruturada por ID (Fase 6 — Calzone,
        // Mini-Pizza, Macarronada, sucos): mesma regra da pizza acima —
        // reconhecido pela presença de `simpleSelection`, e uma falha aqui é
        // definitiva (nunca cai para o legado abaixo).
        if (temSelecaoSimplesEstruturada(item)) {
          const resolvido = resolverItemComSelecaoSimplesEstruturada(item, menu, simpleCatalog!);
          if (!resolvido.ok) return { itemCanonico: item, linha: "", unitPrice: null, qty: item.qty, motivo: resolvido.error };
          return {
            itemCanonico: resolvido.item,
            linha: formatItem(resolvido.item),
            unitPrice: resolvido.item.price,
            qty: item.qty,
          };
        }
        const unitPriceLegado = item.kind === "promo" ? promoUnitPrice(item) : officialUnitPrice(item, menu as MenuPedidoApp);
        return {
          itemCanonico: item,
          linha: formatItem(item),
          unitPrice: unitPriceLegado,
          qty: item.qty,
          ...(unitPriceLegado === null ? { motivo: "Item legado (name/detail) não reconhecido no cardápio atual" } : {}),
        };
      });
    } catch (err) {
      // Hardening (hotfix "Item inválido" mascarado, ver POST /api/pedido-app):
      // loga a causa real para diagnóstico; a resposta ao cliente continua genérica.
      console.error("[ChefeBot] Erro inesperado ao resolver itens da edição do pedido:", err instanceof Error ? err.message : err);
      return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
    }
    const itemInvalido = itensValidados.find((item) => item.unitPrice === null);
    if (itemInvalido) {
      console.error("[ChefeBot] Item de edição de pedido rejeitado:", itemInvalido.motivo ?? "motivo não capturado");
      return NextResponse.json({ ok: false, error: "Item inválido", motivo: itemInvalido.motivo }, { status: 400 });
    }
    const itensCanonicos = itensValidados.map((item) => item.itemCanonico);
    const itens = itensValidados.map((item) => item.linha);
    const subtotal = itensValidados.reduce((s, item) => s + item.unitPrice! * item.qty, 0);

    // Desconto de fidelidade (resgate) já foi validado e debitado na criação
    // do pedido — a edição preserva o valor concedido, nunca revalida a
    // reserva de novo (ela já foi consumida e não existe mais como "reservado").
    const descontoFidelidade = pedido.descontoFidelidade || 0;
    const subtotalComDesconto = Math.max(0, subtotal - descontoFidelidade);
    const taxa = computeTaxaApp(body.tipoEntrega || "retirada", body.bairro, menu.neighborhoods as Array<{ name: string; fee: number }>);
    const total = subtotalComDesconto + taxa;

    // Fase 3 — snapshot oficial estruturado (aditivo), recalculado do zero a
    // cada edição salva (nunca reaproveita o snapshot anterior, que ficaria
    // inconsistente com os novos itens/total). Sem a complexidade de
    // idempotência da criação (esta rota não tem attempt de retry) — os
    // valores já são sempre os finais aqui.
    //
    // Desconto efetivo = subtotal - subtotalComDesconto (a MESMA derivação
    // acima), nunca o descontoFidelidade cru: se os itens editados
    // encolheram o subtotal abaixo do desconto concedido na criação,
    // subtotalComDesconto já é clampado em 0 (nunca fica negativo) — usar
    // descontoFidelidade cru aqui quebraria
    // subtotalCents - descontoCents + taxaCents === totalCents.
    const descontoEfetivo = subtotal - subtotalComDesconto;
    const itensBody = body.itens;
    const snapshotOficial = construirSnapshotOficial({
      itens: itensValidados.map((item, i) =>
        construirSnapshotItem({
          kind: item.itemCanonico.kind,
          nome: item.itemCanonico.name,
          detalhe: item.itemCanonico.detail,
          quantidade: item.qty,
          precoUnitarioReais: item.unitPrice!,
          selecao: itensBody[i].pizzaSelection ?? itensBody[i].simpleSelection,
        })
      ),
      subtotalReais: subtotal,
      descontoReais: descontoEfetivo,
      taxaReais: taxa,
      tipoEntrega: body.tipoEntrega || "retirada",
      bairro: body.bairro,
      pagamento,
      criadoEm: new Date().toISOString(),
    });

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
    const camposAtualizados: Partial<PedidoRedis> = {
      itens,
      itensDetalhados: itensCanonicos,
      snapshotOficial,
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
    };

    // Pix já foi preparado acima (chamada externa ao Mercado Pago, fora de
    // qualquer lock). Daqui pra frente: protegido pelo lock GLOBAL de
    // "pedidos" (ver src/lib/pedidosConcorrencia.ts) — releitura fresca,
    // revalidação das mesmas invariantes de identidade/sessão/revisão contra
    // esse estado fresco, e só então a escrita. O mutex por pedido continua
    // segurado (adquirido acima) durante toda a rota.
    const resultadoPersistencia = await mutarPedidos<PedidoRedis, ResultadoSalvarEdicao>((pedidosFrescos) => {
      const indexFresco = pedidosFrescos.findIndex((p) => p.id === id);
      if (indexFresco < 0 || !tokensIguais(pedidosFrescos[indexFresco].statusToken, statusToken)) {
        return { persistir: false, resultado: { tipo: "nao_encontrado" } };
      }
      const pedidoFresco = pedidosFrescos[indexFresco];
      if (pedidoFresco.editStatus !== "editing" || pedidoFresco.editSessionId !== editSessionId) {
        return { persistir: false, resultado: { tipo: "sessao_invalida" } };
      }
      if (!lockEdicaoAtivo(pedidoFresco)) {
        return { persistir: false, resultado: { tipo: "tempo_esgotado" } };
      }
      if ((pedidoFresco.revision ?? 1) !== revisaoAtual) {
        return { persistir: false, resultado: { tipo: "revisao_mudou" } };
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
    if (resultadoPersistencia.tipo === "sessao_invalida") {
      return NextResponse.json(
        { ok: false, error: "Sessão de edição inválida. Toque em Editar pedido novamente." },
        { status: 409 }
      );
    }
    if (resultadoPersistencia.tipo === "tempo_esgotado") {
      return NextResponse.json(
        { ok: false, error: "O tempo para editar terminou. Seu pedido original foi mantido." },
        { status: 410 }
      );
    }
    if (resultadoPersistencia.tipo === "revisao_mudou") {
      return NextResponse.json(
        { ok: false, error: "O pedido mudou enquanto você editava. Recarregue e tente novamente." },
        { status: 409 }
      );
    }

    const atualizado = resultadoPersistencia.atualizado;
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
