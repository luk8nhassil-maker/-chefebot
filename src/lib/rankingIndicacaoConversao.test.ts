import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      let removidos = 0;
      for (const key of keys) if (store.delete(key)) removidos++;
      return removidos;
    }),
  },
}));

import {
  registrarConversaoIndicacao,
  obterConversaoIndicacaoDoPedido,
  marcarConversaoAtivaIndicado,
  obterConversaoAtivaIndicado,
  revogarConversaoAtivaIndicadoSePedido,
} from "./rankingIndicacaoConversao";

beforeEach(() => store.clear());

describe("registrarConversaoIndicacao / obterConversaoIndicacaoDoPedido", () => {
  test("registra e recupera a migalha pelo pedidoId", async () => {
    await registrarConversaoIndicacao({ indicadorId: "cli_a", indicadoId: "cli_b", pedidoId: "pedido-1" });
    const conversao = await obterConversaoIndicacaoDoPedido("pedido-1");
    expect(conversao).toEqual({ indicadorId: "cli_a", indicadoId: "cli_b", pedidoId: "pedido-1" });
  });

  test("pedido sem migalha retorna null", async () => {
    expect(await obterConversaoIndicacaoDoPedido("pedido-nunca-registrado")).toBeNull();
  });

  test("pedidoId vazio retorna null sem consultar o Redis", async () => {
    expect(await obterConversaoIndicacaoDoPedido("")).toBeNull();
  });
});

describe("marcarConversaoAtivaIndicado / obterConversaoAtivaIndicado / revogarConversaoAtivaIndicadoSePedido (blocker 4)", () => {
  test("marca e recupera a conversão ativa do indicado", async () => {
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual({ indicadorId: "cli_indicador", pedidoId: "pedido-A" });
  });

  test("sem marca nenhuma, devolve null", async () => {
    expect(await obterConversaoAtivaIndicado("cli_sem_conversao")).toBeNull();
  });

  test("indicadoId vazio nunca consulta nem marca o Redis", async () => {
    expect(await obterConversaoAtivaIndicado("")).toBeNull();
    await marcarConversaoAtivaIndicado("", { indicadorId: "x", pedidoId: "y" });
    expect(await obterConversaoAtivaIndicado("cli_qualquer")).toBeNull();
  });

  test("revoga a marca quando o pedidoId bate com a conversão ativa", async () => {
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toBeNull();
  });

  test("NUNCA revoga quando o pedidoId não bate — protege contra reprocessamento fora de ordem apagando uma conversão MAIS NOVA", async () => {
    // Pedido A convertia originalmente; depois disso o indicado já fez uma
    // NOVA conversão válida via pedido B. Um cancelamento tardio e fora de
    // ordem de A (ex.: reprocessado depois de B) nunca pode apagar a marca de B.
    await marcarConversaoAtivaIndicado("cli_indicado", { indicadorId: "cli_indicador", pedidoId: "pedido-B" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado")).toEqual({ indicadorId: "cli_indicador", pedidoId: "pedido-B" });
  });

  test("revogar quando nunca houve marca é um no-op seguro (idempotente)", async () => {
    await expect(revogarConversaoAtivaIndicadoSePedido("cli_nunca_marcado", "pedido-X")).resolves.toBeUndefined();
    expect(await obterConversaoAtivaIndicado("cli_nunca_marcado")).toBeNull();
  });

  test("BLOCKER 4 fim a fim: A converte → cancelar A revoga → B (novo indicado sem relação com A) pode ter sua própria conversão ativa independente", async () => {
    await marcarConversaoAtivaIndicado("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-A" });
    await revogarConversaoAtivaIndicadoSePedido("cli_indicado_A", "pedido-A");
    expect(await obterConversaoAtivaIndicado("cli_indicado_A")).toBeNull();

    // Uma nova conversão válida substituta (pedido C) para o MESMO indicado.
    await marcarConversaoAtivaIndicado("cli_indicado_A", { indicadorId: "cli_indicador", pedidoId: "pedido-C" });
    expect(await obterConversaoAtivaIndicado("cli_indicado_A")).toEqual({ indicadorId: "cli_indicador", pedidoId: "pedido-C" });
  });
});
