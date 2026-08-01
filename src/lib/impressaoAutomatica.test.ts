import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { reivindicarImpressaoAutomatica } from "./impressaoAutomatica";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("reivindicarImpressaoAutomatica", () => {
  it("a primeira chamada para um pedido reivindica com sucesso", async () => {
    expect(await reivindicarImpressaoAutomatica("ped_1")).toBe(true);
  });

  it("a segunda chamada para o MESMO pedido é recusada — nunca imprime duas vezes o mesmo evento", async () => {
    expect(await reivindicarImpressaoAutomatica("ped_1")).toBe(true);
    expect(await reivindicarImpressaoAutomatica("ped_1")).toBe(false);
    expect(await reivindicarImpressaoAutomatica("ped_1")).toBe(false);
  });

  it("pedidos diferentes têm reivindicações independentes", async () => {
    expect(await reivindicarImpressaoAutomatica("ped_1")).toBe(true);
    expect(await reivindicarImpressaoAutomatica("ped_2")).toBe(true);
  });

  it("duas chamadas concorrentes (mesmo pedido) — só uma vence, mesmo disparadas ao mesmo tempo", async () => {
    const [a, b] = await Promise.all([
      reivindicarImpressaoAutomatica("ped_concorrente"),
      reivindicarImpressaoAutomatica("ped_concorrente"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("nunca expira: chamar de novo depois de qualquer tempo continua recusando", async () => {
    expect(await reivindicarImpressaoAutomatica("ped_1")).toBe(true);
    const chamado = redisMock.set.mock.calls[0];
    expect(chamado[2]).not.toHaveProperty("ex");
    expect(await reivindicarImpressaoAutomatica("ped_1")).toBe(false);
  });

  it("usa uma chave dedicada por pedido, isolada de outras estruturas do Redis", async () => {
    await reivindicarImpressaoAutomatica("ped_xyz");
    expect(redisMock.set).toHaveBeenCalledWith("pedido:auto-print-claim:ped_xyz", expect.any(String), { nx: true });
  });
});
