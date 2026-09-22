import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    eval: vi.fn(async (_script: string, keys: string[], args: unknown[]) => {
      const key = keys[0];
      if (!key || store.get(key) !== args[0]) return 0;
      store.delete(key);
      return 1;
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";
import { abrirComanda, type Comanda } from "@/lib/comandas";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(token: string) {
  return { cookies: { get: (n: string) => (n === SALAO_COOKIE ? { value: token } : undefined) } } as never;
}
async function abrirComandaOk(mesa: string): Promise<Comanda> {
  const r = await abrirComanda({ cliente: "Cliente Teste", mesa });
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("POST /api/salao/comandas/[id]/fechar", () => {
  it("bloqueia sem sessão do Salão", async () => {
    const res = await POST({ cookies: { get: () => undefined } } as never, paramsFor("x"));
    expect(res.status).toBe(401);
  });

  it("recusa pedir a conta de uma comanda sem envio ativo", async () => {
    const token = await criarTokenSalao();
    const comanda = await abrirComandaOk("5");
    const res = await POST(req(token), paramsFor(comanda.id));
    expect(res.status).toBe(409);
  });

  it("solicita a conta de uma comanda com todos os envios servidos", async () => {
    const token = await criarTokenSalao();
    const comanda = await abrirComandaOk("5");
    const agora = new Date().toISOString();
    store.set("salao:comandas", [{
      ...comanda,
      status: "enviada",
      pedidoId: "ped_1",
      pedidoNumero: 1,
      enviadaEm: agora,
      rodadas: [{
        id: "rodada_1",
        numero: 1,
        status: "enviada",
        itens: [{ kind: "simple", name: "Refrigerante 2L", price: 12, qty: 1 }],
        subtotal: 12,
        criadaEm: agora,
        atualizadaEm: agora,
        enviadaEm: agora,
        pedidoId: "ped_1",
        pedidoNumero: 1,
      }],
    }]);
    store.set("pedidos", [{ id: "ped_1", total: 12, status: "entregue" }]);
    const res = await POST(req(token), paramsFor(comanda.id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.contaSolicitada).toBe(true);
    expect(data.estado.status).toBe("conta_solicitada");
  });

  it("404 para comanda inexistente", async () => {
    const token = await criarTokenSalao();
    const res = await POST(req(token), paramsFor("nao_existe"));
    expect(res.status).toBe(404);
  });
});
