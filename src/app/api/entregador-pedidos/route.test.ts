import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock, authMock, pontosMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      // Dispatch por keys.length: 1 chave = compare-and-delete atômico do
      // lock GLOBAL de "pedidos" (ver src/lib/pedidosConcorrencia.ts); 2
      // chaves = a operação de conclusão de entrega (pedidos + fila do
      // entregador, atômica na mesma chamada Lua).
      eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
        if (keys.length === 1) {
          if (store.get(keys[0]) === args[0]) {
            store.delete(keys[0]);
            return 1;
          }
          return 0;
        }
        store.set(keys[0], JSON.parse(args[0]));
        store.set(keys[1], JSON.parse(args[1]));
        return 1;
      }),
    },
    authMock: vi.fn(),
    pontosMock: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/entregadorAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/entregadorAuth")>();
  return { ...actual, autenticarEntregador: authMock };
});
vi.mock("@/lib/fidelidade", () => ({ creditarPontosPedidoEntregue: pontosMock }));

import { GET, POST } from "./route";

const entregadorA = { id: "ent-a", nome: "A", telefone: "86999990000", ativo: true };
const authA = {
  entregador: entregadorA,
  sessao: { entregadorId: "ent-a", nome: "A", tipo: "entregador", issuedAt: 1, expiresAt: 2 },
};

function getRequest(query = "") {
  return new NextRequest(`https://x.test/api/entregador-pedidos${query}`);
}

function postRequest(body: unknown) {
  return new NextRequest("https://x.test/api/entregador-pedidos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function pedidoFila(status: "pendente" | "em_rota" | "entregue" = "pendente") {
  return {
    pedidoId: "ped-1",
    entregadorId: "ent-a",
    entregadorNome: "A",
    entregadorTelefone: entregadorA.telefone,
    clienteNome: "Cliente",
    clienteTelefone: "86988880000",
    endereco: "Rua 1",
    total: 50,
    itens: ["Pizza"],
    status,
    horarioSaida: "12:00",
  };
}

function pedidoMain(entregadorId = "ent-a", status = "saiu_entrega") {
  return { id: "ped-1", status, entregador: { id: entregadorId, nome: entregadorId, telefone: "86999990000" }, total: 50 };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  authMock.mockResolvedValue(authA);
});

describe("GET /api/entregador-pedidos", () => {
  it("sem sessão retorna 401", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(getRequest())).status).toBe(401);
  });

  it("ignora entregadorId da query e lê somente a fila da sessão", async () => {
    store.set("entregador:pedidos:ent-a", [pedidoFila()]);
    store.set("entregador:pedidos:ent-b", [{ ...pedidoFila(), pedidoId: "ped-b", entregadorId: "ent-b" }]);
    store.set("pedidos", [pedidoMain("ent-a")]);
    const res = await GET(getRequest("?entregadorId=ent-b"));
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].pedidoId).toBe("ped-1");
  });

  it("filtra defensivamente dados que sobraram na fila após reatribuição", async () => {
    store.set("entregador:pedidos:ent-a", [pedidoFila()]);
    store.set("pedidos", [pedidoMain("ent-b")]);

    const res = await GET(getRequest());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("Cliente");
    expect(JSON.stringify(data)).not.toContain("86988880000");
    expect(JSON.stringify(data)).not.toContain("Rua 1");
    expect(JSON.stringify(data)).not.toContain("Pizza");
  });
});

describe("POST /api/entregador-pedidos", () => {
  it("entregadorId do body é ignorado; identidade continua sendo a sessão", async () => {
    store.set("entregador:pedidos:ent-a", [pedidoFila()]);
    store.set("pedidos", [pedidoMain()]);
    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "iniciar", entregadorId: "ent-b" }));
    expect(res.status).toBe(200);
    expect((store.get("entregador:pedidos:ent-a") as Array<{ status: string }>)[0].status).toBe("em_rota");
    expect(store.has("entregador:pedidos:ent-b")).toBe(false);
  });

  it("A não altera pedido atribuído a B e nenhuma escrita ocorre", async () => {
    store.set("entregador:pedidos:ent-a", []);
    store.set("pedidos", [pedidoMain("ent-b")]);
    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "iniciar" }));
    expect(res.status).toBe(403);
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("ação desconhecida é rejeitada antes de qualquer escrita", async () => {
    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "apagar" }));
    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("entregar antes de iniciar retorna 409", async () => {
    store.set("entregador:pedidos:ent-a", [pedidoFila("pendente")]);
    store.set("pedidos", [pedidoMain()]);
    expect((await POST(postRequest({ pedidoId: "ped-1", acao: "entregar" }))).status).toBe(409);
    // O único EVAL possível aqui é a liberação (best-effort) do lock GLOBAL
    // de "pedidos" (1 chave) — a operação atômica de conclusão de entrega
    // (2 chaves) nunca chega a ser chamada para uma transição inválida.
    expect(redisMock.eval.mock.calls.every(([, keys]) => keys.length === 1)).toBe(true);
    expect((store.get("pedidos") as Array<{ status: string }>)[0].status).toBe("saiu_entrega");
    expect((store.get("entregador:pedidos:ent-a") as Array<{ status: string }>)[0].status).toBe("pendente");
  });

  it("iniciar e entregar preservam o fluxo e a conclusão é atômica", async () => {
    store.set("entregador:pedidos:ent-a", [pedidoFila("em_rota")]);
    store.set("pedidos", [pedidoMain()]);
    const chamadasDeConclusao = () =>
      redisMock.eval.mock.calls.filter(([, keys]) => keys.length === 2);

    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "entregar" }));
    expect(res.status).toBe(200);
    expect(chamadasDeConclusao()).toHaveLength(1);
    expect((store.get("pedidos") as Array<{ status: string }>)[0].status).toBe("entregue");
    expect((store.get("entregador:pedidos:ent-a") as Array<{ status: string }>)[0].status).toBe("entregue");
    expect(pontosMock).toHaveBeenCalledTimes(1);

    const repetida = await POST(postRequest({ pedidoId: "ped-1", acao: "entregar" }));
    expect(repetida.status).toBe(200);
    // Idempotente: a segunda chamada (pedido já entregue) não repete a
    // operação atômica de conclusão — só adquire/libera o lock global à toa.
    expect(chamadasDeConclusao()).toHaveLength(1);
  });
});
