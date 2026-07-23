import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock, authMock, pontosMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
      // Três scripts: compare-and-delete do lock global (1 key — liberação
      // de pedidosStore.ts, roda para TODA chamada que passa pelo lock,
      // inclusive as que retornam cedo por 403/409 sem escrever nada),
      // INICIAR_LUA (2 keys: [lockKey, filaKey] — cercado pelo token do
      // lock, ação "iniciar") e ENTREGAR_LUA (3 keys: [lockKey, "pedidos",
      // filaKey] — cercado pelo token do lock, ação "entregar"). Ver
      // src/app/api/entregador-pedidos/route.ts.
      eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
        if (keys.length === 1) {
          const [key] = keys;
          const [token] = args;
          if (store.get(key) === token) {
            store.delete(key);
            return 1;
          }
          return 0;
        }
        if (keys.length === 2) {
          const [lockKey, filaKey] = keys;
          const [token, filaJson] = args;
          if (store.get(lockKey) !== token) return "lock_perdido";
          store.set(filaKey, JSON.parse(filaJson));
          return 1;
        }
        const [lockKey, pedidosKey, filaKey] = keys;
        const [token, principaisJson, filaJson] = args;
        if (store.get(lockKey) !== token) return "lock_perdido";
        store.set(pedidosKey, JSON.parse(principaisJson));
        store.set(filaKey, JSON.parse(filaJson));
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

  it("FENCING: iniciar com lock perdido no instante da escrita é recusado (409), fila permanece intacta", async () => {
    // Achado MÉDIO da revisão externa do PR #252: antes da correção, a ação
    // "iniciar" gravava a fila do entregador com um `redis.set` direto,
    // mesmo dentro do lock global — sem validar atomicamente que o token
    // ainda era dono do lock NO INSTANTE da escrita. Simula exatamente essa
    // janela: por qualquer motivo (TTL expirado, outra execução já
    // adquiriu um lock novo), o EVAL de fencing (2 keys: [lockKey, filaKey])
    // recusa a escrita em vez de sobrescrever uma atribuição mais nova.
    store.set("entregador:pedidos:ent-a", [pedidoFila("pendente")]);
    store.set("pedidos", [pedidoMain()]);

    redisMock.eval.mockImplementationOnce(async (_script: string, keys: string[]) => {
      expect(keys).toHaveLength(2); // confirma que é a escrita de "iniciar", não outro EVAL
      return "lock_perdido";
    });

    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "iniciar" }));
    expect(res.status).toBe(409);
    // A fila NUNCA foi sobrescrita com "em_rota" — permanece exatamente como
    // estava antes da tentativa recusada, nunca ambígua.
    expect(store.get("entregador:pedidos:ent-a")).toEqual([pedidoFila("pendente")]);
  });

  it("A não altera pedido atribuído a B e nenhuma escrita ocorre", async () => {
    store.set("entregador:pedidos:ent-a", []);
    store.set("pedidos", [pedidoMain("ent-b")]);
    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "iniciar" }));
    expect(res.status).toBe(403);
    // A resposta é negada antes de qualquer mutação: o estado de "pedidos" e
    // da fila do entregador continua exatamente como antes (o lock global é
    // adquirido/liberado mesmo em respostas de erro — isso não é uma
    // escrita de dados, só release best-effort do mutex).
    expect(store.get("pedidos")).toEqual([pedidoMain("ent-b")]);
    expect(store.get("entregador:pedidos:ent-a")).toEqual([]);
  });

  it("ação desconhecida é rejeitada antes de qualquer escrita", async () => {
    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "apagar" }));
    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("entregar antes de iniciar retorna 409", async () => {
    store.set("entregador:pedidos:ent-a", [pedidoFila("pendente")]);
    store.set("pedidos", [pedidoMain()]);
    expect((await POST(postRequest({ pedidoId: "ped-1", acao: "entregar" }))).status).toBe(409);
    // Nenhuma mutação de "pedidos"/fila — só o mutex global foi
    // adquirido/liberado (1 EVAL de release, não de escrita).
    expect(store.get("pedidos")).toEqual([pedidoMain()]);
    expect(store.get("entregador:pedidos:ent-a")).toEqual([pedidoFila("pendente")]);
  });

  it("iniciar e entregar preservam o fluxo e a conclusão é atômica", async () => {
    store.set("entregador:pedidos:ent-a", [pedidoFila("em_rota")]);
    store.set("pedidos", [pedidoMain()]);
    const res = await POST(postRequest({ pedidoId: "ped-1", acao: "entregar" }));
    expect(res.status).toBe(200);
    // 1 EVAL da escrita cercada (ENTREGAR_LUA, 3 keys) + 1 EVAL de release
    // do lock global (1 key) — a escrita cercada em si acontece uma única
    // vez, exatamente como antes desta correção (que só adicionou o
    // fencing, não uma segunda escrita).
    const chamadasDeEscrita = redisMock.eval.mock.calls.filter(([, keys]) => (keys as string[]).length >= 3);
    expect(chamadasDeEscrita).toHaveLength(1);
    expect((store.get("pedidos") as Array<{ status: string }>)[0].status).toBe("entregue");
    expect((store.get("entregador:pedidos:ent-a") as Array<{ status: string }>)[0].status).toBe("entregue");
    expect(pontosMock).toHaveBeenCalledTimes(1);

    const repetida = await POST(postRequest({ pedidoId: "ped-1", acao: "entregar" }));
    expect(repetida.status).toBe(200);
    expect(redisMock.eval.mock.calls.filter(([, keys]) => (keys as string[]).length >= 3)).toHaveLength(1);
  });
});
