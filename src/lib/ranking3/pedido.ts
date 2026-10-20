import "server-only";
import { ranking3 } from "./server";
import { derivarClienteIdPorTelefone } from "../fidelidade";
import { redis } from "../redis";

export async function sincronizarPremioDoPedido(pedido: { id: string; premioRankingId?: string; premioRankingEntregueEm?: string; clienteId?: string; telefone?: string; status?: string; statusAnterior?: string; tenantId?: string }) {
  if (!pedido.premioRankingId) return;
  const store = ranking3(pedido.tenantId ?? "default");
  const premio = await store.premio(pedido.premioRankingId);
  const clienteId = derivarClienteIdPorTelefone(pedido.telefone) ?? pedido.clienteId;
  if (!premio || !clienteId || premio.clienteId !== clienteId) throw new Error("premio_pedido_inconsistente");
  if ((pedido.statusAnterior === "entregue" || pedido.premioRankingEntregueEm) && pedido.status === "cancelado") {
    // Correção administrativa posterior à entrega não devolve pizza consumida.
    await store.transicionar(premio.id, clienteId, pedido.id, "entregue");
    return;
  }
  if (["em_preparo", "saiu_entrega", "entregue", "cancelado"].includes(pedido.status ?? "")) await store.transicionar(premio.id, clienteId, pedido.id, pedido.status as "entregue" | "cancelado" | "em_preparo" | "saiu_entrega");
}

export async function recuperarVinculosRanking3() {
  const store = ranking3();
  const ids = await redis.smembers<string[]>(store.chave("vinculos"));
  if (!ids.length) return { reconciliados: 0, semPedido: 0 };
  const pedidos = await redis.get<Parameters<typeof sincronizarPremioDoPedido>[0][]>("pedidos") ?? [];
  let reconciliados = 0, semPedido = 0;
  for (const id of ids) {
    const premio = await store.premio(id);
    const pedido = pedidos.find((p) => p.id === premio?.pedidoId && p.premioRankingId === id);
    if (!pedido) { semPedido++; continue; } // Não liberar reserva/Pix ambíguo por ausência.
    await sincronizarPremioDoPedido(pedido);
    reconciliados++;
  }
  return { reconciliados, semPedido };
}
