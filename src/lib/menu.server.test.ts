import { beforeEach, describe, expect, it, vi } from "vitest";

const redisGetMock = vi.fn();

vi.mock("./redis", () => ({
  redis: {
    get: redisGetMock,
  },
}));

describe("getMENUDinamico", () => {
  beforeEach(() => {
    redisGetMock.mockReset();
  });

  it("usa o catálogo padrão somente quando a chave ainda não existe", async () => {
    redisGetMock.mockResolvedValue(null);
    const { MENU } = await import("./menu");
    const { getMENUDinamico } = await import("./menu.server");

    await expect(getMENUDinamico()).resolves.toEqual(MENU);
  });

  it("preserva seções oficiais não sobrescritas pelo catálogo persistido", async () => {
    redisGetMock.mockResolvedValue({
      bebidas: [{ name: "Bebida oficial", price: 12 }],
    });
    const { MENU } = await import("./menu");
    const { getMENUDinamico } = await import("./menu.server");

    await expect(getMENUDinamico()).resolves.toMatchObject({
      bebidas: [{ name: "Bebida oficial", price: 12 }],
      lanches: MENU.lanches,
      payments: MENU.payments,
    });
  });

  it("torna a indisponibilidade explícita quando o Redis falha", async () => {
    redisGetMock.mockRejectedValue(new Error("redis offline"));
    const {
      CardapioIndisponivelError,
      getMENUDinamico,
    } = await import("./menu.server");

    await expect(getMENUDinamico()).rejects.toBeInstanceOf(
      CardapioIndisponivelError,
    );
  });
});
