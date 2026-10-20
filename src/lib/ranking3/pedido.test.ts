import { beforeEach, describe, expect, it, vi } from "vitest";
import { transicionarPremio, type Premio } from "./domain";
const m = vi.hoisted(() => ({ premio: null as Premio | null, pedidos: [] as unknown[], transicionar: vi.fn() }));
vi.mock("../redis", () => ({ redis: { smembers: async () => [m.premio?.id], get: async () => m.pedidos } }));
vi.mock("./server", () => ({ ranking3: () => ({ chave: (s: string) => s, premio: async () => m.premio, transicionar: m.transicionar }) }));
vi.mock("../fidelidade", () => ({ derivarClienteIdPorTelefone: () => "titular-sintetico" }));
import { recuperarVinculosRanking3, sincronizarPremioDoPedido } from "./pedido";
const id = "r3-2026-10-20-0-liga-1";
beforeEach(() => {
  vi.clearAllMocks(); m.pedidos = [];
  m.premio = { id, clienteId: "titular-sintetico", temporadaId: "r3-2026-10-20-0", liga: 1, tetoCents: 4700, estado: "associado", pedidoId: "pedido-sintetico", concedidoEm: "2026-11-19T06:00:00Z", revisao: 1, proximoAvisoEm: 0 };
  m.transicionar.mockImplementation(async (_id, _titular, pedidoId, evento) => { m.premio = transicionarPremio(m.premio!, pedidoId, evento, 1000); return m.premio; });
});
describe("Ranking3 — pedido real é autoridade, nunca conversa encerrada", () => {
  it("ausência de pedido não libera reserva nem assume sucesso", async () => {
    expect(await recuperarVinculosRanking3()).toEqual({ reconciliados: 0, semPedido: 1 });
    expect(m.transicionar).not.toHaveBeenCalled(); expect(m.premio?.estado).toBe("associado");
  });
  it("recuperação acompanha preparo, sem falsificar entrega", async () => {
    m.pedidos = [{ id: "pedido-sintetico", premioRankingId: id, status: "em_preparo", telefone: "sintetico" }];
    await recuperarVinculosRanking3(); expect(m.premio?.estado).toBe("em_preparo");
  });
  it("cancelamento após entrega comprovada não restaura o prêmio", async () => {
    await sincronizarPremioDoPedido({ id: "pedido-sintetico", premioRankingId: id, status: "cancelado", premioRankingEntregueEm: "2026-11-20T00:00:00Z", telefone: "sintetico" });
    expect(m.premio?.estado).toBe("entregue");
  });
  it("repetir cancelamento anterior à entrega não reinicia indevidamente os 15 dias", async () => {
    const p = { id: "pedido-sintetico", premioRankingId: id, status: "cancelado", telefone: "sintetico" };
    await sincronizarPremioDoPedido(p); const primeira = m.premio?.proximoAvisoEm;
    await sincronizarPremioDoPedido(p); expect(m.premio?.estado).toBe("disponivel"); expect(m.premio?.proximoAvisoEm).toBe(primeira);
  });
});
