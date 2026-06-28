import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { proximoNumeroPedido } from "@/lib/numeracao";
import { getMENUDinamico } from "@/lib/menu";
import { computeTaxaApp, buildEnderecoApp } from "@/lib/pedidoAppLogic";

export const maxDuration = 20;

type ItemApp = {
  kind: "pizza" | "simple";
  name: string;     // ex: "Pizza G (meio a meio)" ou "Refrigerante 2L"
  detail?: string;  // ex: "Calabresa / Baiana · borda Catupiry"
  price: number;
  qty: number;
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

    const menu = await getMENUDinamico();
    const pedidos = (await redis.get<unknown[]>("pedidos")) || [];

    const itensValidados = body.itens.map((item) => ({
      linha: formatItem(item),
      unitPrice: officialUnitPrice(item, menu as MenuPedidoApp),
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
    const novoPedido = {
      id: pedidoId,
      numero: numeroPedido,
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

    return NextResponse.json({ ok: true, pedidoId, numero: numeroPedido, total });
  } catch (error) {
    console.error("Erro ao salvar pedido do site:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
