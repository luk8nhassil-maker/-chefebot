import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock, sessaoMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
  };
  const sessaoMock = vi.fn(async () => ({ username: "kellyne", nome: "Kellyne", role: "admin" }));
  return { store, redisMock, sessaoMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/sessaoAdministrativa", () => ({
  lerSessaoAdministrativa: sessaoMock,
  ehOrigemAdministrativa: (origem: unknown) => origem === "painel",
}));

import { POST } from "./route";

function req(id = "ped_1") {
  return new NextRequest("http://localhost/api/orders/auto-print-painel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

function seed(overrides: Record<string, unknown> = {}) {
  store.set("pedidos", [
    { id: "ped_1", origem: "painel", status: "novo", pagamento: "Dinheiro", ...overrides },
  ]);
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  sessaoMock.mockResolvedValue({ username: "kellyne", nome: "Kellyne", role: "admin" });
});

describe("POST /api/orders/auto-print-painel", () => {
  test("exige sessao administrativa", async () => {
    sessaoMock.mockResolvedValueOnce(null);
    expect((await POST(req())).status).toBe(401);
  });

  test("pedido do site nunca usa a regra especial do painel", async () => {
    seed({ origem: "site" });
    const data = await (await POST(req())).json();
    expect(data).toMatchObject({ podeImprimirAutomaticamente: false, motivo: "origem_nao_painel" });
    expect(store.has("pedido:auto-print-claim:ped_1")).toBe(false);
  });

  test("pedido do painel sem Pix imprime imediatamente e apenas uma vez", async () => {
    seed({ pagamento: "Cartao" });
    const primeira = await (await POST(req())).json();
    const segunda = await (await POST(req())).json();
    expect(primeira.podeImprimirAutomaticamente).toBe(true);
    expect(segunda.podeImprimirAutomaticamente).toBe(false);
  });

  test("Pix pendente nao imprime nem consome o claim", async () => {
    seed({ pagamento: "Pix", pixConfirmado: false, pix: { status: "pendente" } });
    const data = await (await POST(req())).json();
    expect(data).toMatchObject({ podeImprimirAutomaticamente: false, motivo: "pix_pendente" });
    expect(store.has("pedido:auto-print-claim:ped_1")).toBe(false);
  });

  test("Pix confirmado libera a mesma impressao unica", async () => {
    seed({ pagamento: "Pix", pixConfirmado: true, pix: { status: "confirmado" } });
    const data = await (await POST(req())).json();
    expect(data.podeImprimirAutomaticamente).toBe(true);
    expect(store.has("pedido:auto-print-claim:ped_1")).toBe(true);
  });

  test("pagamento misto contendo Pix tambem aguarda confirmacao", async () => {
    seed({ pagamento: "Pix (R$ 20,00) + Dinheiro (R$ 30,00)", pixConfirmado: false });
    const data = await (await POST(req())).json();
    expect(data.motivo).toBe("pix_pendente");
  });

  test("pedido cancelado ou arquivado nunca dispara", async () => {
    seed({ status: "cancelado" });
    expect((await (await POST(req())).json()).podeImprimirAutomaticamente).toBe(false);
    store.clear();
    seed({ isArchived: true });
    expect((await (await POST(req())).json()).podeImprimirAutomaticamente).toBe(false);
  });
});
