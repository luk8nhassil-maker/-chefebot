import { vi, describe, test, expect } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { criarPixMetadata, gerarTxidPixInterno } from "./pix";

describe("metadados internos de Pix", () => {
  test("gera txid interno deterministico a partir do pedido", () => {
    expect(gerarTxidPixInterno("123")).toBe("chefebot_123");
  });

  test("cria metadados para Pix puro usando o total do pedido", () => {
    expect(criarPixMetadata("123", "Pix", 50)).toEqual({
      txid: "chefebot_123",
      valorEsperado: 50,
      status: "pendente",
    });
  });

  test("cria metadados para Pix hibrido usando apenas a parte Pix", () => {
    expect(criarPixMetadata("123", "Pix (R$ 30,00) + Dinheiro (R$ 20,00)", 50)).toEqual({
      txid: "chefebot_123",
      valorEsperado: 30,
      status: "pendente",
    });
  });

  test("nao cria metadados quando o pagamento nao tem Pix", () => {
    expect(criarPixMetadata("123", "Dinheiro", 50)).toBeUndefined();
  });
});
