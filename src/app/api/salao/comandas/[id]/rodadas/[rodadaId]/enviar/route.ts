import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import {
  buscarComanda,
  confirmarEnvioRodada,
  falharEnvioRodada,
  identificacaoClienteComanda,
  PAGAMENTO_COMANDA_EM_ABERTO,
  reivindicarEnvioRodada,
  totalParcialComanda,
  validarItensComanda,
} from "@/lib/comandas";
import { sanitizeClientRequestId } from "@/survival/clientRequestId";
import { POST as criarPedidoApp } from "@/app/api/pedido-app/route";

export const dynamic = "force-dynamic";

// Envia uma rodada (Rodada 2+) da comanda para a cozinha: cada rodada
// enviada vira um pedido oficial independente, contendo somente os itens
// daquela rodada — nunca os itens acumulados da comanda inteira. Mesmo
// motor de sempre (POST /api/pedido-app, em processo — nunca um segundo
// motor de pedido); esta rota só reivindica o direito de enviar (mutex +
// status "enviando", ver src/lib/comandas.ts), repassa o payload e confirma
// ou desfaz a reivindicação conforme o resultado.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rodadaId: string }> }
) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const { id, rodadaId } = await params;
  let body: { clientRequestId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const clientRequestId = sanitizeClientRequestId(body.clientRequestId);
  if (!clientRequestId) {
    return NextResponse.json({ ok: false, error: "Identificador de tentativa (clientRequestId) é obrigatório." }, { status: 400 });
  }

  let reivindicacao;
  try {
    reivindicacao = await reivindicarEnvioRodada(id, rodadaId, clientRequestId);
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível enviar agora. Tente de novo." }, { status: 503 });
  }

  if (!reivindicacao.ok) {
    if (reivindicacao.motivo === "nao_encontrada") {
      return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
    }
    if (reivindicacao.motivo === "comanda_fechada") {
      return NextResponse.json({ ok: false, error: "Esta comanda já está fechada" }, { status: 409 });
    }
    if (reivindicacao.motivo === "rodada_nao_encontrada") {
      return NextResponse.json({ ok: false, error: "Rodada não encontrada" }, { status: 404 });
    }
    if (reivindicacao.motivo === "rodada_vazia") {
      return NextResponse.json({ ok: false, error: "Adicione pelo menos um item antes de enviar" }, { status: 422 });
    }
    const erroConflito = reivindicacao.statusAtual === "enviando"
      ? "Esta rodada já está sendo enviada agora"
      : "Esta rodada já foi enviada por outra tentativa";
    return NextResponse.json({ ok: false, error: erroConflito }, { status: 409 });
  }

  // Retry com o mesmo clientRequestId de uma tentativa já concluída — devolve
  // o pedido já criado, sem criar (nem reivindicar) de novo.
  if (reivindicacao.retomada) {
    const comanda = await buscarComanda(id);
    return NextResponse.json({
      ok: true,
      rodada: reivindicacao.rodada,
      pedidoId: reivindicacao.rodada.pedidoId,
      pedidoNumero: reivindicacao.rodada.pedidoNumero,
      comanda: comanda ?? reivindicacao.comanda,
      totalParcial: totalParcialComanda(comanda ?? reivindicacao.comanda),
    });
  }

  const rodada = reivindicacao.rodada;
  const comandaBase = reivindicacao.comanda;

  // Reprecificação no servidor, em profundidade: os itens já foram validados
  // ao serem salvos na rodada (PATCH), mas o preço/disponibilidade oficial
  // é sempre recalculado de novo aqui, nunca confiado do que está salvo.
  const validacao = await validarItensComanda(rodada.itens);
  if (!validacao.ok) {
    await falharEnvioRodada(id, rodadaId, clientRequestId, validacao.error);
    return NextResponse.json({ ok: false, error: validacao.error }, { status: 422 });
  }

  const identificacaoCliente = identificacaoClienteComanda(comandaBase);
  const observacaoRodada = [
    `Comanda #${comandaBase.numero}`,
    comandaBase.mesa ? `Mesa ${comandaBase.mesa}${comandaBase.complemento ? ` (${comandaBase.complemento})` : ""}` : "Sem mesa",
    `Rodada ${rodada.numero}`,
    rodada.observacao?.trim() || null,
  ]
    .filter(Boolean)
    .join(" — ");

  const payloadPedidoApp = {
    cliente: identificacaoCliente,
    usarOutroWhatsapp: true,
    // pizzaSelection (IDs oficiais, Fase 5) preservado — validacao.itens já
    // vem de validarItensComanda (reprecificação em profundidade acima),
    // que só anexa esse campo quando resolveu contra o catálogo oficial
    // fresco; POST /api/pedido-app reprecifica de novo pelo motor nativo,
    // nunca confia neste payload.
    itens: validacao.itens.map((i) => ({
      kind: i.kind,
      name: i.name,
      detail: i.detail,
      price: i.price,
      qty: i.qty,
      ...(i.pizzaSelection ? { pizzaSelection: i.pizzaSelection } : {}),
    })),
    tipoEntrega: "dine_in" as const,
    pagamento: PAGAMENTO_COMANDA_EM_ABERTO,
    observacao: observacaoRodada,
    clientRequestId,
  };

  // Mesma requisição real (mesmos cookies do navegador do Salão) — a rota de
  // criação de pedido verifica a sessão do Salão de novo, por conta própria,
  // antes de dispensar o telefone.
  const requisicaoInterna = {
    json: async () => payloadPedidoApp,
    cookies: req.cookies,
  } as unknown as NextRequest;

  let respostaPedido;
  let dadosPedido;
  try {
    respostaPedido = await criarPedidoApp(requisicaoInterna);
    dadosPedido = await respostaPedido.json().catch(() => null);
  } catch {
    await falharEnvioRodada(id, rodadaId, clientRequestId, "Falha ao criar o pedido");
    return NextResponse.json({ ok: false, error: "Não foi possível criar o pedido agora. Tente de novo." }, { status: 503 });
  }

  if (!respostaPedido.ok || !dadosPedido?.ok) {
    const erro = dadosPedido?.error || "Não foi possível criar o pedido agora.";
    await falharEnvioRodada(id, rodadaId, clientRequestId, erro);
    return NextResponse.json({ ok: false, error: erro }, { status: respostaPedido.status || 500 });
  }

  const pedidoId = String(dadosPedido.pedidoId ?? "");
  const pedidoNumero = typeof dadosPedido.numero === "number" ? dadosPedido.numero : undefined;
  const resultado = await confirmarEnvioRodada(id, rodadaId, pedidoId, pedidoNumero);
  const comandaFinal = resultado === "nao_encontrada" || resultado === "rodada_nao_encontrada" ? null : resultado;

  return NextResponse.json({
    ok: true,
    rodada: { ...rodada, status: "enviada", pedidoId, pedidoNumero, enviadaEm: new Date().toISOString() },
    pedidoId,
    pedidoNumero,
    ...(comandaFinal ? { comanda: comandaFinal, totalParcial: totalParcialComanda(comandaFinal) } : {}),
  });
}
