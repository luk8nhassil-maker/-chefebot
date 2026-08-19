import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { buscarComanda, identificacaoClienteComanda, marcarComandaEnviada, PAGAMENTO_COMANDA_EM_ABERTO } from "@/lib/comandas";
import { gerarClientRequestId, sanitizeClientRequestId } from "@/survival/clientRequestId";
import { POST as criarPedidoApp } from "@/app/api/pedido-app/route";
import { executarMutacaoComContaAbertaSalao } from "@/lib/salaoConta.server";
import { ERRO_ESCRITA_SALAO_PREVIEW, escritaSalaoBloqueadaNoPreview } from "@/lib/salaoAmbiente";
import {
  confirmarEnvioInicialSalao,
  liberarEnvioInicialSalao,
  reivindicarEnvioInicialSalao,
} from "@/lib/salaoEnvioInicial.server";

export const dynamic = "force-dynamic";

// "Enviar para a cozinha" do primeiro pedido: cria o pedido de verdade pela
// MESMA rota oficial /api/pedido-app. O claim por comanda fecha duplo clique
// e duas abas, e sua aquisição é serializada com "Pedir conta". O lock da
// conta é liberado antes da chamada ao motor de pedidos; enquanto o envio
// estiver em curso, a própria Rodada 1 ainda não enviada impede pedir conta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  if (escritaSalaoBloqueadaNoPreview()) {
    return NextResponse.json({ ok: false, error: ERRO_ESCRITA_SALAO_PREVIEW }, { status: 403 });
  }

  const { id } = await params;
  let body: { clientRequestId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const claim = await executarMutacaoComContaAbertaSalao(id, () => reivindicarEnvioInicialSalao(id));
  if (!claim.ok) {
    return NextResponse.json({ ok: false, error: claim.error }, { status: claim.status });
  }
  const reivindicacao = claim.valor;
  if (!reivindicacao.ok) {
    return NextResponse.json(
      {
        ok: false,
        unresolved: reivindicacao.motivo === "indisponivel",
        error: reivindicacao.motivo === "em_processamento"
          ? "O pedido inicial já está sendo enviado. Aguarde alguns segundos antes de tentar novamente."
          : "Não foi possível confirmar se o envio inicial já começou. Aguarde e tente novamente.",
      },
      { status: reivindicacao.motivo === "em_processamento" ? 409 : 503 },
    );
  }

  const comanda = await buscarComanda(id);
  if (!comanda) {
    if (reivindicacao.tipo === "claim") await liberarEnvioInicialSalao(id, reivindicacao.token);
    return NextResponse.json({ ok: false, error: "Comanda não encontrada" }, { status: 404 });
  }
  if (comanda.status === "fechada") {
    if (reivindicacao.tipo === "claim") await liberarEnvioInicialSalao(id, reivindicacao.token);
    return NextResponse.json({ ok: false, error: "Esta comanda já está fechada" }, { status: 409 });
  }

  if (reivindicacao.tipo === "resultado") {
    if (comanda.status === "aberta") {
      await marcarComandaEnviada(id, reivindicacao.resultado.pedidoId, reivindicacao.resultado.numero).catch(() => null);
    }
    return NextResponse.json({ ok: true, ...reivindicacao.resultado, recuperado: true });
  }

  const claimToken = reivindicacao.token;
  if (comanda.status !== "aberta") {
    await liberarEnvioInicialSalao(id, claimToken);
    return NextResponse.json({ ok: false, error: "O pedido inicial desta comanda já foi enviado" }, { status: 409 });
  }
  if (comanda.itens.length === 0) {
    await liberarEnvioInicialSalao(id, claimToken);
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
    itens: comanda.itens.map((i) => ({
      kind: i.kind,
      name: i.name,
      detail: i.detail,
      price: i.price,
      qty: i.qty,
      ...(i.pizzaSelection ? { pizzaSelection: i.pizzaSelection } : {}),
      ...(i.simpleSelection ? { simpleSelection: i.simpleSelection } : {}),
    })),
    tipoEntrega: "dine_in" as const,
    pagamento: PAGAMENTO_COMANDA_EM_ABERTO,
    observacao: observacaoComanda,
    ...(clientRequestId ? { clientRequestId } : {}),
  };

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
    // Resultado incerto: NÃO libera o claim. O TTL impede um segundo pedido
    // enquanto não sabemos se o primeiro chegou a ser persistido.
    return NextResponse.json({ ok: false, unresolved: true, error: "Não foi possível confirmar o envio. Aguarde antes de tentar novamente." }, { status: 503 });
  }

  if (!respostaPedido.ok || !dadosPedido?.ok) {
    const resultadoIncerto = respostaPedido.status >= 500 || dadosPedido?.unresolved === true;
    if (!resultadoIncerto) await liberarEnvioInicialSalao(id, claimToken);
    return NextResponse.json(
      { ok: false, ...(resultadoIncerto ? { unresolved: true } : {}), error: dadosPedido?.error || "Não foi possível criar o pedido agora." },
      { status: respostaPedido.status || 500 },
    );
  }

  const pedidoId = String(dadosPedido.pedidoId ?? "");
  const numero = typeof dadosPedido.numero === "number" ? dadosPedido.numero : undefined;
  const total = typeof dadosPedido.total === "number" ? dadosPedido.total : 0;
  const resultadoDuravel = { pedidoId, numero, total, criadoEm: new Date().toISOString() };

  await confirmarEnvioInicialSalao(id, claimToken, resultadoDuravel);
  const resultado = await marcarComandaEnviada(id, pedidoId, numero);
  if (resultado === "nao_encontrada" || resultado === "nao_esta_aberta") {
    return NextResponse.json({ ok: true, ...resultadoDuravel });
  }

  return NextResponse.json({ ok: true, ...resultadoDuravel, comanda: resultado });
}
