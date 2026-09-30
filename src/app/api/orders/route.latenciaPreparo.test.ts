import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

type PedidoTeste = {
  id: string;
  numero: number;
  cliente: string;
  telefone: string;
  itens: string[];
  total: number;
  status: string;
  horario: string;
  endereco: string;
};

const state = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  posResposta: [] as Array<() => Promise<void> | void>,
  enviarTexto: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => state.store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && state.store.has(key)) return null;
      state.store.set(key, structuredClone(value));
      return "OK";
    }),
    del: vi.fn(async (key: string) => state.store.delete(key) ? 1 : 0),
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const key = keys[0];
      if (state.store.get(key) === args[0]) {
        state.store.delete(key);
        return 1;
      }
      return 0;
    }),
  },
}));

vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async () => ({ username: "kellyne", name: "Kellyne", role: "admin" })),
}));

vi.mock("@/lib/afterResponse", () => ({
  agendarTarefaAposResposta: vi.fn((fn: () => Promise<void> | void) => {
    state.posResposta.push(fn);
    return true;
  }),
}));

vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: state.enviarTexto }));

import { PATCH } from "./route";

function req() {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify({ id: "p-fast", status: "em_preparo" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.store.clear();
  state.posResposta.length = 0;
  state.enviarTexto.mockResolvedValue({ ok: true, latenciaMs: 20_000, tentativas: 2 });
  const pedido: PedidoTeste = {
    id: "p-fast",
    numero: 1,
    cliente: "Cliente Teste",
    telefone: "86999998888",
    itens: ["Pizza"],
    total: 50,
    status: "novo",
    horario: "19:00",
    endereco: "Retirada na loja",
  };
  state.store.set("pedidos", [pedido]);
});

describe("PATCH /api/orders — aceite rápido e auto-print", () => {
  test("novo -> em_preparo responde com permissão de impressão antes de esperar WhatsApp", async () => {
    const response = await PATCH(req());
    const data = await response.json();

    expect(data.status).toBe("em_preparo");
    expect(data.podeImprimirAutomaticamente).toBe(true);
    expect(state.enviarTexto).not.toHaveBeenCalled();
    expect(state.posResposta).toHaveLength(1);

    await state.posResposta[0]();
    expect(state.enviarTexto).toHaveBeenCalledTimes(1);
  });
});
