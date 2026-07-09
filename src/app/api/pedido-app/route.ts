import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { proximoNumeroPedido } from "@/lib/numeracao";
import { getMENUDinamico } from "@/lib/menu";
import { computeTaxaApp, buildEnderecoApp } from "@/lib/pedidoAppLogic";
import { criarPixMetadata, prepararPixProviderMercadoPago, serializarPixCliente } from "@/lib/pix";
import { gerarPixCopiaEColaEstatico } from "@/lib/pixBRCode";
import { montarLinkWhatsappComprovantePix } from "@/lib/pixCardapio";
import { PROMOS_KEY, catalogoDoMenu, dentroDaJanela, precoFinalPromocao, promocaoIndisponivel, type Promocao } from "@/lib/promocoes";

export const maxDuration = 20;

type ItemApp = {
  kind: "pizza" | "simple" | "promo";
  name: string;     // ex: "Pizza G (meio a meio)" ou "Refrigerante 2L"
  detail?: string;  // ex: "Calabresa / Baiana · borda Catupiry"
  price: number;
  qty: number;
  promoId?: string; // presente quando kind === "promo"
};

type PedidoApp = {
  cliente: string;
  telefone: string;
  itens: ItemApp[];
  tipoEntrega: "delivery" | "retirada" | "dine_in";
  bairro?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  pagamento: string;
  troco?: string;
  observacao?: string;
  email?: string;
};

type MenuSimpleItem = { name: string; price: number; sizes?: { code: string; price: number }[] };

type MenuPedidoApp = {
  sizes: { code: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  lanches: { name: string; price: number; sizes?: { code: string; price: number }[] }[];
  bebidas: { name: string; price: number }[];
  sucos: { name: string; price: number }[];
  borders: { label: string; priceSmall: number; priceLarge: number }[];
};

function norm(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isPagamentoDinheiro(pagamento: string): boolean {
  return norm(pagamento) === "dinheiro";
}

function formatItem(item: ItemApp): string {
  const qtyPrefix = item.qty > 1 ? `${item.qty}x ` : "";
  const detalhe = item.detail ? ` ${item.detail}` : "";
  return `${qtyPrefix}${item.name}${detalhe}`.trim();
}

function officialUnitPrice(item: ItemApp, menu: MenuPedidoApp): number | null {
  if (!Number.isInteger(item.qty) || item.qty < 1) return null;

  if (item.kind === "simple") {
    const produtos: MenuSimpleItem[] = [...menu.lanches, ...menu.bebidas, ...menu.sucos];
    const found = produtos.find((produto) => norm(produto.name) === norm(item.name));
    if (!found) return null;

    const suco = menu.sucos.find((entry) => norm(entry.name) === norm(item.name));
    if (suco) {
      const detail = norm(item.detail || "");
      if (!detail || detail === "sem leite") return Number.isFinite(suco.price) ? suco.price : null;
      if (detail === "com leite") return Number.isFinite(suco.price) ? suco.price + 1 : null;
      return null;
    }
    if (norm(found.name).includes("macarronada")) {
      const sizeCode = item.detail?.match(/^Tamanho\s+([A-Za-z])$/i)?.[1]?.toUpperCase();
      const size = sizeCode ? found.sizes?.find((entry) => entry.code.toUpperCase() === sizeCode) : null;
      return size && Number.isFinite(size.price) ? size.price : null;
    }

    return Number.isFinite(found.price) ? found.price : null;
  }

  if (item.kind !== "pizza") return null;

  const sizeCode = item.name.match(/^Pizza\s+([A-Za-z])/i)?.[1]?.toUpperCase();
  const size = sizeCode ? menu.sizes.find((entry) => entry.code.toUpperCase() === sizeCode) : null;
  if (!size || !Number.isFinite(size.price)) return null;

  const detail = item.detail || "";
  const detailParts = detail.split("·").map((part) => part.trim()).filter(Boolean);
  const flavorsText = detailParts[0] || "";
  const flavors = flavorsText.split("/").map((part) => part.trim()).filter(Boolean);
  const allowedFlavors = [...menu.saltyFlavors, ...menu.sweetFlavors].map(norm);
  if (flavors.length === 0 || flavors.some((flavor) => !allowedFlavors.includes(norm(flavor)))) {
    return null;
  }

  const borderText = detailParts.find((part) => norm(part).startsWith("borda "));
  if (!borderText) return size.price;

  const borderName = borderText.replace(/^borda\s+/i, "").trim();
  const border = menu.borders.find((entry) => norm(entry.label) === norm(borderName));
  if (!border) return null;

  const isSmallOrMedium = size.code === "P" || size.code === "M";
  return size.price + (isSmallOrMedium ? border.priceSmall : border.priceLarge);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PedidoApp;

    if (!body.cliente || !body.itens || body.itens.length === 0) {
      return NextResponse.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
    }
    if (!body.telefone || !body.telefone.trim()) {
      return NextResponse.json({ ok: false, error: "Telefone obrigatório" }, { status: 400 });
    }
    if (!body.pagamento || !body.pagamento.trim()) {
      return NextResponse.json({ ok: false, error: "Forma de pagamento obrigatória" }, { status: 400 });
    }

    if (isPagamentoDinheiro(body.pagamento) && !body.troco?.trim()) {
      return NextResponse.json({ ok: false, error: "Troco obrigatorio para dinheiro" }, { status: 400 });
    }

    if (body.tipoEntrega === "delivery" && (!body.bairro?.trim() || !body.rua?.trim() || !body.numero?.trim())) {
      return NextResponse.json({ ok: false, error: "Endereco obrigatorio para entrega" }, { status: 400 });
    }

    const menu = await getMENUDinamico();
    const pedidos = (await redis.get<unknown[]>("pedidos")) || [];

    // Itens promocionais: o preço NUNCA vem do cliente — é recalculado a
    // partir da promoção ativa salva no Redis. Promoção inexistente,
    // inativa, fora da janela ou com produto esgotado invalida o pedido.
    const temPromo = body.itens.some((item) => item.kind === "promo");
    const promos = temPromo ? ((await redis.get<Promocao[]>(PROMOS_KEY)) || []) : [];
    const esgotadosPromo = temPromo ? ((await redis.get<string[]>("esgotados")) || []) : [];
    const catalogoPromo = temPromo ? catalogoDoMenu(menu as never) : [];

    function promoUnitPrice(item: ItemApp): number | null {
      if (!Number.isInteger(item.qty) || item.qty < 1) return null;
      const promo = promos.find((p) => p.id === item.promoId);
      if (!promo || !promo.active || !dentroDaJanela(promo)) return null;
      if (promo.maxUsesPerOrder && item.qty > promo.maxUsesPerOrder) return null;
      if (promocaoIndisponivel(promo, esgotadosPromo)) return null;
      const sabor = item.detail?.match(/Sabor:\s*([^·]+)/i)?.[1]?.trim();
      if (sabor && esgotadosPromo.some((e) => norm(e) === norm(sabor))) return null;
      const preco = precoFinalPromocao(promo, catalogoPromo);
      return preco !== null && Number.isFinite(preco) && preco >= 0 ? preco : null;
    }

    const itensValidados = body.itens.map((item) => ({
      linha: formatItem(item),
      unitPrice: item.kind === "promo" ? promoUnitPrice(item) : officialUnitPrice(item, menu as MenuPedidoApp),
      qty: item.qty,
    }));

    if (itensValidados.some((item) => item.unitPrice === null)) {
      return NextResponse.json({ ok: false, error: "Item inválido" }, { status: 400 });
    }

    // Formata os itens como strings, no MESMO padrão do fluxo do WhatsApp
    const itens = itensValidados.map((item) => item.linha);

    const subtotal = itensValidados.reduce((s, item) => s + item.unitPrice! * item.qty, 0);
    const taxa = computeTaxaApp(body.tipoEntrega, body.bairro, menu.neighborhoods as Array<{ name: string; fee: number }>);
    const total = subtotal + taxa;

    const endereco = buildEnderecoApp({ tipoEntrega: body.tipoEntrega, rua: body.rua, numero: body.numero, bairro: body.bairro });

    const pedidoId = Date.now().toString();
    const numeroPedido = await proximoNumeroPedido();
    const pixBase = criarPixMetadata(pedidoId, body.pagamento, total);
    const pix = await prepararPixProviderMercadoPago({
      pedidoId,
      pix: pixBase,
      clienteNome: body.cliente,
      payerEmail: body.email,
    });
    // Token aleatorio que autoriza SOMENTE a consulta de status de pagamento
    // deste pedido (GET /api/pedido-status com token). Vai apenas na resposta
    // de criacao — quem nao criou o pedido nao tem como obte-lo.
    const statusToken = randomUUID();
    const novoPedido = {
      id: pedidoId,
      numero: numeroPedido,
      statusToken,
      cliente: body.cliente,
      telefone: body.telefone.trim(),
      itens,
      total,
      status: "novo" as const,
      horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
      endereco,
      data: new Date().toLocaleDateString("pt-BR"),
      origem: "site",
      ...(body.observacao ? { observacao: body.observacao } : {}),
      pagamento: body.pagamento,
      ...(pix ? { pix } : {}),
      ...(body.troco ? { troco: body.troco } : {}),
      ...(taxa ? { taxaEntrega: taxa } : {}),
      ...(body.bairro ? { bairro: body.bairro } : {}),
      ...(body.referencia ? { referencia: body.referencia } : {}),
      ...(body.tipoEntrega ? { tipoEntrega: body.tipoEntrega } : {}),
    };

    await redis.set("pedidos", [...pedidos, novoPedido]);

    // Dispara notificação push para a Kellyne (mesmo canal do WhatsApp)
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chefebot-pjif.vercel.app";
      const firstName = body.cliente.split(" ")[0];
      const itensResumo = itens.slice(0, 2).join(", ") + (itens.length > 2 ? "..." : "");
      await fetch(`${baseUrl}/api/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "notify",
          title: `Pedido #${numeroPedido} (site) — ${firstName} 🍕`,
          message: itensResumo,
        }),
      });
    } catch {}

    const pixCliente = serializarPixCliente(pix);

    // Pix manual (sem Mercado Pago): entrega ao cliente a chave configurada,
    // o beneficiario, o link do WhatsApp para envio do comprovante e um
    // copia-e-cola estatico gerado localmente (BR Code, sem API bancaria).
    let pixManual: Record<string, unknown> | undefined;
    if (pix && !pixCliente) {
      const config = await redis.get<{ chavePix?: string; nomeTitularPix?: string; nomePizzaria?: string; whatsappPizzaria?: string }>("config:pizzaria");
      const chave = (config?.chavePix || "").trim();
      if (chave) {
        const titular = (config?.nomeTitularPix || "").trim();
        const valorPix = typeof pix.valorEsperado === "number" && Number.isFinite(pix.valorEsperado) ? pix.valorEsperado : total;
        const copiaECola = gerarPixCopiaEColaEstatico({
          chave,
          valor: valorPix,
          nome: titular || config?.nomePizzaria,
          cidade: "ALTO ALEGRE",
          txid: `CHEFE${numeroPedido}`,
        });
        const whatsappUrl = montarLinkWhatsappComprovantePix({
          whatsapp: config?.whatsappPizzaria,
          numeroPedido,
          total: valorPix,
        });
        pixManual = {
          chave,
          valor: valorPix,
          ...(titular ? { titular } : {}),
          ...(copiaECola ? { copiaECola } : {}),
          ...(whatsappUrl ? { whatsappUrl } : {}),
        };
      }
    }

    return NextResponse.json({
      ok: true,
      pedidoId,
      numero: numeroPedido,
      total,
      statusToken,
      ...(pixCliente ? { pix: pixCliente } : {}),
      ...(pixManual ? { pixManual } : {}),
    });
  } catch (error) {
    console.error("Erro ao salvar pedido do site:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
