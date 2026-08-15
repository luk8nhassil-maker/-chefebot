import { redis } from "./redis";

// Proteção contra impressão automática duplicada do mesmo pedido — nunca
// substitui nem altera a impressão em si (a rota /pedidos/[id]/imprimir
// continua exatamente igual), só decide QUEM tem o direito de disparar o
// gatilho AUTOMÁTICO.
//
// Por que persistente em vez de em memória: duas abas do painel (ou dois
// dispositivos) podem observar o mesmo pedido quase ao mesmo tempo. Um SET
// NX no Redis garante que só um recebe o direito de imprimir automaticamente.
// A reimpressão manual nunca passa por aqui.

function chaveClaimImpressaoAutomatica(pedidoId: string): string {
  return `pedido:auto-print-claim:${pedidoId}`;
}

type OpcoesClaimImpressao = {
  permitirPedidoPainel?: boolean;
};

type PedidoOrigem = { id?: string; origem?: unknown };

/**
 * Reivindica, de forma atômica e permanente, o direito de disparar a
 * impressão automática deste pedido. Por padrão, pedidos criados no painel
 * NÃO podem reivindicar por caminhos legados (como o aceite novo -> preparo):
 * eles têm a regra própria de criação/Pix, que chama esta função explicitando
 * `permitirPedidoPainel` somente depois de todas as travas server-side.
 */
export async function reivindicarImpressaoAutomatica(
  pedidoId: string,
  opcoes: OpcoesClaimImpressao = {},
): Promise<boolean> {
  try {
    if (!opcoes.permitirPedidoPainel) {
      const pedidos = (await redis.get<PedidoOrigem[]>("pedidos")) || [];
      const pedido = Array.isArray(pedidos) ? pedidos.find((item) => item?.id === pedidoId) : undefined;
      if (pedido?.origem === "painel") return false;
    }

    const ok = await redis.set(chaveClaimImpressaoAutomatica(pedidoId), String(Date.now()), { nx: true });
    return !!ok;
  } catch {
    // Redis indisponível: nunca bloqueia a transição de status do pedido por
    // causa da permissão de impressão automática — só nega o gatilho.
    return false;
  }
}
