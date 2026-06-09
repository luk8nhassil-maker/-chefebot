import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type Pedido = {
  id: string;
  status: string;
  horario: string;
  data?: string;
};

export async function GET() {
  try {
    const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
    const agora = new Date();
    const hojeStr = agora.toLocaleDateString("pt-BR");

    const limpo = pedidos.filter((p: Pedido) => {
      // Pedidos ativos nunca são removidos
      if (!["entregue", "cancelado"].includes(p.status)) return true;

      // Se tem data salva, remove pedidos com mais de 7 dias
      if (p.data) {
        const [dia, mes, ano] = p.data.split("/").map(Number);
        const dataPedido = new Date(ano, mes - 1, dia);
        const diffDias = (agora.getTime() - dataPedido.getTime()) / 1000 / 60 / 60 / 24;
        return diffDias < 7;
      }

      // Pedidos sem data — mantém por 24h baseado no horário
      const parts = p.horario.split(":");
      const h = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      const horarioPedido = new Date();
      horarioPedido.setHours(h, m, 0, 0);
      const diff = (agora.getTime() - horarioPedido.getTime()) / 1000 / 60 / 60;
      return diff < 24;
    });

    // Limpa também chaves de sessão expiradas
    await redis.set("pedidos", limpo);

    return NextResponse.json({
      ok: true,
      total: pedidos.length,
      removidos: pedidos.length - limpo.length,
      mantidos: limpo.length,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}