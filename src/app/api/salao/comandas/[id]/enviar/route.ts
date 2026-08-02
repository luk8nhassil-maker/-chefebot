import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { buscarComanda, identificacaoClienteComanda, marcarComandaEnviada, PAGAMENTO_COMANDA_EM_ABERTO } from "@/lib/comandas";
import { gerarClientRequestId, sanitizeClientRequestId } from "@/survival/clientRequestId";
import { POST as criarPedidoApp } from "@/app/api/pedido-app/route";

export const dynamic = "force-dynamic";

// "Enviar para a cozinha" do primeiro pedido (Rodada 1/"Pedido inicial") da
// comanda: cria o pedido de verdade chamando a MESMA rota de criação de
// pedido de sempre (POST /api/pedido-app, em processo — nunca um segundo
// motor de pedido). Preço, catálogo, estoque e idempotência continuam
// sendo decididos inteiramente por aquela rota; esta só monta o payload a
// partir da comanda e repassa o cookie de sessão do Salão real (a mesma
// verificação server-side roda de novo lá dentro).
//
// Sem pagamento aqui: assim como Rodada 2+ (ver .../rodadas/[rodadaId]/
// enviar), o Salão só manda para a cozinha — o pagamento de verdade só
// acontece quando o caixa fechar a conta, em uma etapa futura. O pedido é
// gravado com PAGAMENTO_COMANDA_EM_ABERTO, o mesmo marcador "pendente" já
// usado por Rodada 2+, nunca Pix/Dinheiro/Cartão/Misto.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await params;
  let body: { clientRequestId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const comanda = await buscarComanda(id);
  if (!comanda) {
    return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
  }
  if (comanda.status !== "aberta") {
    return NextResponse.json({ ok: false, error: "Esta comanda não está mais aberta" }, { status: 409 });
  }
  if (comanda.itens.length === 0) {
    return NextResponse.json({ ok: false, error: "Adicione pelo menos um item antes de enviar" }, { status: 422 });
  }

  const identificacaoCliente = identificacaoClienteComanda(comanda);
  const observacaoComanda = [
    `Comanda #${comanda.numero}`,
    comanda.mesa ? `Mesa ${comanda.mesa}${comanda.complemento ? ` (${comanda.complemento})` : ""}` : "Sem mesa",
    comanda.observacao?.trim() || null,
  ]
    .filter(Boolean)
    .join(" — ");

  // Reaproveita o clientRequestId gerado pela tela de revisão (retry da
  // mesma tentativa) — só gera um novo se, por algum motivo, nenhum vier no
  // corpo (nunca deixa a requisição sem idempotência).
  const clientRequestId = sanitizeClientRequestId(body.clientRequestId) ?? (() => {
    try {
      return gerarClientRequestId();
    } catch {
      return null;
    }
  })();

  const payloadPedidoApp = {
    cliente: identificacaoCliente,
    usarOutroWhatsapp: true,
    itens: comanda.itens.map((i) => ({ kind: i.kind, name: i.name, detail: i.detail, price: i.price, qty: i.qty })),
    tipoEntrega: "dine_in" as const,
    pagamento: PAGAMENTO_COMANDA_EM_ABERTO,
    observacao: observacaoComanda,
    ...(clientRequestId ? { clientRequestId } : {}),
  };

  // Mesma requisição real (mesmos cookies do navegador do Salão) — a rota
  // de criação de pedido verifica a sessão do Salão de novo, por conta
  // própria, antes de dispensar o telefone.
  const requisicaoInterna = {
    json: async () => payloadPedidoApp,
    cookies: req.cookies,
  } as unknown as NextRequest;

  const respostaPedido = await criarPedidoApp(requisicaoInterna);
  const dadosPedido = await respostaPedido.json().catch(() => null);

  if (!respostaPedido.ok || !dadosPedido?.ok) {
    return NextResponse.json(
      { ok: false, error: dadosPedido?.error || "Não foi possível criar o pedido agora." },
      { status: respostaPedido.status || 500 }
    );
  }

  const resultado = await marcarComandaEnviada(id, String(dadosPedido.pedidoId ?? ""), dadosPedido.numero);
  if (resultado === "nao_encontrada" || resultado === "nao_esta_aberta") {
    // O pedido já foi criado com sucesso; só a marcação da comanda é que não
    // pôde ser feita (corrida rara). Nunca reportamos falha ao Salão por
    // isto — o pedido está correto e visível no painel de qualquer forma.
    return NextResponse.json({ ok: true, pedidoId: dadosPedido.pedidoId, numero: dadosPedido.numero, total: dadosPedido.total });
  }

  return NextResponse.json({
    ok: true,
    pedidoId: dadosPedido.pedidoId,
    numero: dadosPedido.numero,
    total: dadosPedido.total,
    comanda: resultado,
  });
}
