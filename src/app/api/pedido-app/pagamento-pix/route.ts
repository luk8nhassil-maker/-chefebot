import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { serializarPixCliente, type PixCliente, type PixMetadata } from "@/lib/pix";
import {
  classificarPagamentoPixPublico,
  mensagemPagamentoPixPublico,
  type PedidoStatusPublicoFonte,
} from "@/lib/pedidoStatusPublico";

// Endpoint dedicado à retomada do pagamento Pix (Etapa 2 do fluxo de "Pix
// pendente"). Deliberadamente separado de /api/pedido-app/status: aquele
// endpoint é usado pelo polling da tela de checkout e sua resposta
// permanece sanitizada (sem QR/copia-e-cola) — este é o único lugar que
// reexpõe o payload Pix, e só quando o pagamento ainda está aguardando.
//
// Localiza o pedido só pelo token público (não recebe `id`, ao contrário de
// /api/pedido-app/status) porque a página /pedido/pagamento/[token] só tem
// o token na URL.

type PedidoComPixToken = PedidoStatusPublicoFonte & {
  statusToken?: string;
  acompanhamentoToken?: string;
  pix?: PixMetadata;
};

type ConfigPizzariaPix = {
  nomePizzaria?: string;
  chavePix?: string;
  nomeTitularPix?: string;
  whatsappPizzaria?: string;
};

async function getConfigPix(): Promise<ConfigPizzariaPix> {
  return (await redis.get<ConfigPizzariaPix>("config:pizzaria")) || {};
}

function tokenDoPedido(pedido: PedidoComPixToken): string {
  return String(pedido.statusToken || pedido.acompanhamentoToken || "");
}

function tokensIguais(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function encontrarPedidoPorToken(pedidos: PedidoComPixToken[], token: string): PedidoComPixToken | null {
  // Percorre todos os pedidos (não há índice por token) comparando sempre
  // com timingSafeEqual — mesma proteção contra timing attack já usada em
  // /api/pedido-app/status, aplicada a cada candidato.
  for (const pedido of pedidos) {
    if (tokensIguais(tokenDoPedido(pedido), token)) return pedido;
  }
  return null;
}

export type EstadoPagamentoPix = "aguardando" | "confirmado" | "em_analise" | "indisponivel";

function estadoDoPagamento(pedido: PedidoComPixToken, pixCliente: PixCliente | undefined): EstadoPagamentoPix {
  if (pedido.status === "cancelado") return "indisponivel";
  const pagamentoStatus = classificarPagamentoPixPublico(pedido);
  if (pagamentoStatus === "pago") return "confirmado";
  if (pagamentoStatus === "em_revisao" || pagamentoStatus === "conferencia_manual") return "em_analise";
  if (pagamentoStatus === "aguardando_pix") {
    const temPayload = !!(pixCliente?.qrCode || pixCliente?.copiaECola || pixCliente?.chavePix);
    return temPayload ? "aguardando" : "indisponivel";
  }
  return "indisponivel";
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return NextResponse.json({ ok: false, error: "token obrigatório" }, { status: 400 });
  }

  const pedidos = (await redis.get<PedidoComPixToken[]>("pedidos")) || [];
  const pedido = encontrarPedidoPorToken(pedidos, token);

  if (!pedido) {
    return NextResponse.json({ ok: false, error: "Pedido não encontrado" }, { status: 404 });
  }

  const configPix = await getConfigPix();
  const pixCliente = serializarPixCliente(pedido.pix, configPix);
  const estado = estadoDoPagamento(pedido, pixCliente);
  const pagamentoStatus = classificarPagamentoPixPublico(pedido);
  const texto = mensagemPagamentoPixPublico(pagamentoStatus);

  // Nunca inclui providerPaymentId, credenciais, telefone, endereço ou
  // qualquer outro dado interno/pessoal — pixCliente já vem sanitizado por
  // serializarPixCliente (o mesmo helper usado na criação do pedido) e o
  // restante da resposta só expõe id/numero/total/status público.
  return NextResponse.json({
    ok: true,
    id: pedido.id,
    numero: pedido.numero,
    total: pedido.total,
    status: pedido.status,
    tipoEntrega: pedido.tipoEntrega,
    estado,
    titulo: texto.titulo,
    mensagem: texto.mensagem,
    ...(estado === "aguardando" && pixCliente ? { pix: pixCliente } : {}),
  });
}
