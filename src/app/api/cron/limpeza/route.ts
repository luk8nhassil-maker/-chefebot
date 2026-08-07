import { NextResponse } from "next/server";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";

type Pedido = {
  id: string;
  horario: string;
  status: string;
  [key: string]: any;
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Protegido pelo lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts): leitura e filtragem sobre um
    // snapshot fresco, dentro do lock — nenhuma chamada externa aqui.
    const { removidos, restantes } = await mutarPedidos<Pedido, { removidos: number; restantes: number }>(
      (pedidosFrescos) => {
        const agora = new Date();
        const seteDias = 7 * 24 * 60 * 60 * 1000;

        const pedidosFiltrados = pedidosFrescos.filter((pedido) => {
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

        return {
          persistir: true,
          pedidos: pedidosFiltrados,
          resultado: { removidos: pedidosFrescos.length - pedidosFiltrados.length, restantes: pedidosFiltrados.length },
        };
      }
    );

    return NextResponse.json({ ok: true, removidos, restantes });
  } catch (error) {
    console.error("Erro na limpeza:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}