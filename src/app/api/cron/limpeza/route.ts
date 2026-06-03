import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

type Pedido = {
  id: string;
  horario: string;
  status: string;
  [key: string]: any;
};

export async function GET() {
  try {
    const pedidos = (await redis.get<Pedido[]>("pedidos")) || [];
    const agora = new Date();
    const seteDias = 7 * 24 * 60 * 60 * 1000;

    const pedidosFiltrados = pedidos.filter((pedido) => {
      // Mantém pedidos ativos independente da data
      if (!["entregue", "cancelado"].includes(pedido.status)) return true;

      // Remove entregues/cancelados com mais de 7 dias
      const [hora, minuto] = pedido.horario.split(":").map(Number);
      const dataPedido = new Date();
      dataPedido.setHours(hora, minuto, 0, 0);

      // Se o horário for maior que agora, assume que foi ontem
      if (dataPedido > agora) {
        dataPedido.setDate(dataPedido.getDate() - 1);
      }

      return agora.getTime() - dataPedido.getTime() < seteDias;
    });

    const removidos = pedidos.length - pedidosFiltrados.length;
    await redis.set("pedidos", pedidosFiltrados);

    return NextResponse.json({ ok: true, removidos, restantes: pedidosFiltrados.length });
  } catch (error) {
    console.error("Erro na limpeza:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}