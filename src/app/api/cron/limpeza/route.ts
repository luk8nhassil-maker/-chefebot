import { NextResponse } from "next/server";
import { mutarLotePedidosAtomico } from "@/lib/pedidosStore";

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
    const agora = new Date();
    const seteDias = 7 * 24 * 60 * 60 * 1000;
    let removidos = 0;
    let restantes = 0;

    const resultado = await mutarLotePedidosAtomico<Pedido>((atuais) => {
      const pedidosFiltrados = atuais.filter((pedido) => {
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
      removidos = atuais.length - pedidosFiltrados.length;
      restantes = pedidosFiltrados.length;
      return pedidosFiltrados;
    });

    if (resultado.tipo !== "sucesso") {
      return NextResponse.json({ ok: false, error: "Não foi possível limpar agora. Tente de novo." }, { status: 503 });
    }

    return NextResponse.json({ ok: true, removidos, restantes });
  } catch (error) {
    console.error("Erro na limpeza:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}