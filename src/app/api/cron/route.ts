import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { mutarPedidos } from "@/lib/pedidosConcorrencia";

type ConfigPizzaria = {
  horaFechamento?: number;
  [key: string]: unknown;
};

type Pedido = {
  id: string;
  status: string;
  horario: string;
  data?: string;
  isArchived?: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archivedReason?: string;
  [key: string]: unknown;
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const agora = new Date();

    // Arquivamento automático de pedidos não-resolvidos no fechamento do expediente
    const config = await redis.get<ConfigPizzaria>("config:pizzaria");
    const horaFechamento = config?.horaFechamento ?? 23;
    const brasilia = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const horaAtual = brasilia.getHours();
    const minutosAtual = brasilia.getMinutes();
    // Arquiva dentro da janela de 5 min após o fechamento
    const deveArquivar = horaAtual === horaFechamento && minutosAtual < 5;
    const agoraISO = agora.toISOString();

    if (deveArquivar) {
      // Protegido pelo lock GLOBAL de "pedidos" (ver
      // src/lib/pedidosConcorrencia.ts): leitura e marcação sobre um
      // snapshot fresco, dentro do lock.
      const arquivados = await mutarPedidos<Pedido, number>((pedidosFrescos) => {
        const pedidosAtualizados = pedidosFrescos.map((p: Pedido) => {
          if (p.isArchived) return p;
          if (['entregue', 'cancelado'].includes(p.status)) return p;
          return { ...p, isArchived: true, archivedAt: agoraISO, archivedBy: 'system', archivedReason: 'fim_expediente' };
        });
        return {
          persistir: true,
          pedidos: pedidosAtualizados,
          resultado: pedidosAtualizados.filter((p: Pedido) => p.isArchived && p.archivedAt === agoraISO).length,
        };
      });
      return NextResponse.json({ ok: true, acao: 'arquivamento_expediente', arquivados });
    }

    // Protegido pelo lock GLOBAL de "pedidos": leitura, filtragem e escrita
    // sobre um snapshot fresco, dentro do lock.
    const { total, removidos, mantidos } = await mutarPedidos<
      Pedido,
      { total: number; removidos: number; mantidos: number }
    >((pedidosFrescos) => {
      const limpo = pedidosFrescos.filter((p: Pedido) => {
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

      return {
        persistir: true,
        pedidos: limpo,
        resultado: { total: pedidosFrescos.length, removidos: pedidosFrescos.length - limpo.length, mantidos: limpo.length },
      };
    });

    // Reset explícito do contador de numeração de pedidos do dia anterior.
    // A chave já expira sozinha em 36h e muda de nome a cada dia, mas a limpeza
    // explícita aqui garante que não fique nada residual, mesmo em caso raro de falha do TTL.
    const ontem = new Date(agora);
    ontem.setDate(ontem.getDate() - 1);
    const ontemStr = ontem.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await redis.del(`contador_pedidos:${ontemStr}`);

    return NextResponse.json({ ok: true, total, removidos, mantidos });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}