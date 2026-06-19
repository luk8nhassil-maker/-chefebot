import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { proximoNumeroPedido } from "@/lib/numeracao";
import { getMENUDinamico } from "@/lib/menu";

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
  telefone?: string;
  itens: ItemApp[];
  tipoEntrega: "delivery" | "retirada";
  bairro?: string;
  endereco?: string;
  pagamento: string;
  troco?: string;
  observacao?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PedidoApp;

    if (!body.cliente || !body.itens || body.itens.length === 0) {
      return NextResponse.json({ ok: false, error: "Pedido inválido" }, { status: 400 });
    }

    const pedidos = (await redis.get<any[]>("pedidos")) || [];

    // Formata os itens como strings, no MESMO padrão do fluxo do WhatsApp
    const itens = body.itens.map((item) => {
      const qtyPrefix = item.qty > 1 ? `${item.qty}x ` : "";
      const detalhe = item.detail ? ` ${item.detail}` : "";
      return `${qtyPrefix}${item.name}${detalhe}`.trim();
    });

    const subtotal = body.itens.reduce((s, i) => s + i.price * i.qty, 0);
    let taxa = 0;
    if (body.tipoEntrega === "delivery" && body.bairro) {
      const menu = await getMENUDinamico();
      const bairroNorm = body.bairro.toLowerCase().trim();
      const bairroConfig = (menu.neighborhoods as Array<{ name: string; fee: number }>).find((n) => n.name.toLowerCase().trim() === bairroNorm);
      taxa = bairroConfig?.fee ?? 0;
    }
    const total = subtotal + taxa;

    const endereco =
      body.tipoEntrega === "delivery"
        ? `${body.endereco || ""}${body.bairro ? ` - ${body.bairro}` : ""}`.trim()
        : "Retirada na loja";

    const pedidoId = Date.now().toString();
    const numeroPedido = await proximoNumeroPedido();
    const novoPedido = {
      id: pedidoId,
      numero: numeroPedido,
      cliente: body.cliente,
      telefone: body.telefone || "App",
      itens,
      total,
      status: "novo" as const,
      horario: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }),
      endereco,
      data: new Date().toLocaleDateString("pt-BR"),
      origem: "app",
      ...(body.observacao ? { observacao: body.observacao } : {}),
      ...(body.pagamento ? { pagamento: body.pagamento } : {}),
      ...(body.troco ? { troco: body.troco } : {}),
      ...(taxa ? { taxaEntrega: taxa } : {}),
      ...(body.bairro ? { bairro: body.bairro } : {}),
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
          title: `Pedido #${numeroPedido} (app) — ${firstName} 🍕`,
          message: itensResumo,
        }),
      });
    } catch {}

    return NextResponse.json({ ok: true, pedidoId, numero: numeroPedido, total });
  } catch (error) {
    console.error("Erro ao salvar pedido do app:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
