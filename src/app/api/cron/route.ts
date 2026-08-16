import { NextResponse } from "next/server";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";
import { timestampCriacaoPedido } from "@/lib/expedienteOperacional";

type Pedido = {
  id: string;
  status: string;
  horario?: string;
  data?: string;
  isArchived?: boolean;
  [key: string]: unknown;
};

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agoraMs = Date.now();

    // Regra operacional: pedido não-resolvido nunca é arquivado/removido
    // automaticamente. Ele atravessa a virada das 03:00 como pendência até que
    // uma pessoa registre uma decisão. O cron fica restrito à retenção de
    // pedidos TERMINAIS antigos e não controla mais a identidade do expediente.
    const { total, removidos, mantidos } = await mutarPedidos<
      Pedido,
      { total: number; removidos: number; mantidos: number }
    >((pedidosFrescos) => {
      const limpo = pedidosFrescos.filter((p: Pedido) => {
        if (!["entregue", "cancelado"].includes(p.status)) return true;

        // Usa a mesma fonte temporal do expediente. Pedidos legados cujo
        // instante não pode ser determinado ficam preservados em vez de serem
        // apagados por uma inferência frágil baseada apenas em HH:MM.
        const criadoEm = timestampCriacaoPedido(p, agoraMs);
        if (criadoEm === null) return true;
        return agoraMs - criadoEm < SETE_DIAS_MS;
      });

      const resultado = {
        total: pedidosFrescos.length,
        removidos: pedidosFrescos.length - limpo.length,
        mantidos: limpo.length,
      };

      return pedidosFrescos.length !== limpo.length
        ? { persistir: true, pedidos: limpo, resultado }
        : { persistir: false, resultado };
    });

    // O contador usa uma chave por expediente e TTL próprio. Deletar uma chave
    // por data de calendário aqui poderia cortar a numeração no meio do turno;
    // por isso o cron não mexe mais no contador.
    return NextResponse.json({
      ok: true,
      acao: "limpeza_historico_terminal",
      total,
      removidos,
      mantidos,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
