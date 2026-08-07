import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// AUDITORIA + CORREÇÃO — bug de LOST UPDATE na chave Redis "pedidos"
// (achado separado da colisão de pedido.id corrigida no PR #289).
//
// Mapa completo em docs/architecture/REDIS_KEY_INVENTORY.md, seção 1: a
// própria documentação do projeto já classifica `pedidos` como 🔴 crítico e
// "o maior risco estrutural do modelo atual" — toda mutação (criar, mudar
// status, editar, sair para entrega, confirmar Pix, escalonar, arquivar,
// limpar) fazia GET do array inteiro + mutação em memória + SET do array
// inteiro, sem nenhuma proteção que abrangesse TODOS os escritores. O mutex
// por pedidoId (adquirirMutexEdicao) só serializava escritores que disputam
// o MESMO id — nunca protegia contra um escritor de OUTRO id (ou sem id,
// como GET.lazy-cleanup) sobrescrevendo com um snapshot desatualizado.
//
// Este arquivo provou (com `test.fails`, antes do patch) três cenários de
// Categoria B: STATUS x STATUS, criação x status de outro pedido, e criação
// x limpeza preguiçosa do GET. Corrigido com o lock GLOBAL de "pedidos" (ver
// src/lib/pedidosConcorrencia.ts), os três agora são testes NORMAIS provando
// a garantia inversa — nenhuma das duas mutações concorrentes desaparece.
//
// Nota de harness: a barreira determinística usada antes do patch (segurar
// duas leituras concorrentes até ambas chegarem, para forçar o pior caso)
// deixou de fazer sentido aqui — com o lock global, a SEGUNDA requisição
// nunca chega a ler "pedidos" antes da primeira liberar o lock (ela fica
// esperando a aquisição), então uma barreira baseada em "duas leituras
// simultâneas de pedidos" travaria para sempre. Isso por si só já é um sinal
// de que a serialização está funcionando: basta Promise.all comum agora.

const redisStore = new Map<string, unknown>();

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

async function defaultGetImpl(key: string) {
  if (!redisStore.has(key)) return null;
  return deepClone(redisStore.get(key));
}
async function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return null;
  redisStore.set(key, value);
  return "OK";
}
function defaultDelImpl(key: string) {
  const existed = redisStore.has(key);
  redisStore.delete(key);
  return Promise.resolve(existed ? 1 : 0);
}
function defaultIncrImpl(key: string) {
  const atual = (redisStore.get(key) as number | undefined) ?? 0;
  const novo = atual + 1;
  redisStore.set(key, novo);
  return Promise.resolve(novo);
}
// Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
// src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
function defaultEvalImpl(_script: string, keys: string[], args: string[]) {
  const [chave] = keys;
  const [tokenEsperado] = args;
  if (redisStore.get(chave) === tokenEsperado) {
    redisStore.delete(chave);
    return Promise.resolve(1);
  }
  return Promise.resolve(0);
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(defaultDelImpl),
    incr: vi.fn(defaultIncrImpl),
    expire: vi.fn(async () => 1),
    eval: vi.fn(defaultEvalImpl),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) =>
      token === "token-admin" ? { username: "kellyne", name: "Kellyne", role: "admin" } : null
    ),
  };
});

vi.mock("@/lib/evolutionApi", () => ({
  obterConfigEvolution: vi.fn(() => ({
    baseUrl: "https://evolution.test",
    apiKey: "key",
    instanceName: "chefebot",
    webhookUrl: "https://x.test/api/whatsapp",
  })),
}));

const fetchMock = vi.fn<(url: string, opts?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(
  async () => ({ ok: true, json: async () => ({}) })
);
vi.stubGlobal("fetch", fetchMock);

import { GET, PATCH, POST } from "./route";

function authedRequest(method: string, body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method,
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function seedPedidos(pedidos: Record<string, unknown>[]) {
  redisStore.set("pedidos", pedidos);
}

beforeEach(() => {
  redisStore.clear();
  fetchMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("STATUS x STATUS em pedidos DIFERENTES — corrigido pelo lock global de pedidos", () => {
  test("Pedido A -> em_preparo e Pedido B -> em_preparo simultaneamente (Promise.all): as duas atualizações persistem", async () => {
    seedPedidos([
      { id: "5001", numero: 1, cliente: "Carla A", telefone: "5551111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "5002", numero: 2, cliente: "Diego B", telefone: "5552222222222", itens: ["x"], total: 20, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    // adquirirMutexEdicao(id) é por pedidoId — A e B usam chaves de lock
    // DIFERENTES, então esse mutex sozinho não serializaria esta corrida.
    // Quem fecha isso agora é o lock GLOBAL de "pedidos" dentro de
    // aplicarMudancaDeStatus.
    const [resA, resB] = await Promise.all([
      PATCH(authedRequest("PATCH", { id: "5001", status: "em_preparo" })),
      PATCH(authedRequest("PATCH", { id: "5002", status: "em_preparo" })),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    const pedidoA = persistidos.find(p => p.id === "5001");
    const pedidoB = persistidos.find(p => p.id === "5002");

    expect(pedidoA?.status).toBe("em_preparo");
    expect(pedidoB?.status).toBe("em_preparo");
  });
});

describe("CASO 3 — criação de um pedido concorrente com mudança de status de OUTRO pedido já existente — corrigido", () => {
  test("Pedido A muda de status enquanto Pedido B é criado (Promise.all): os dois persistem", async () => {
    seedPedidos([
      { id: "3001", numero: 1, cliente: "Ana Existente", telefone: "5511111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
    ]);

    const [resPatch, resPost] = await Promise.all([
      PATCH(authedRequest("PATCH", { id: "3001", status: "em_preparo" })),
      POST(authedRequest("POST", { cliente: "Bruno Novo", telefone: "5522222222222", itens: ["Pizza M"], total: 40, endereco: "Rua 2" })),
    ]);

    expect(resPatch.status).toBe(200);
    expect(resPost.status).toBe(201);
    const pedidoB = await resPost.json();

    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    const pedidoAPersistido = persistidos.find(p => p.id === "3001");
    const pedidoBPersistido = persistidos.find(p => p.id === pedidoB.id);

    expect(pedidoAPersistido?.status).toBe("em_preparo");
    expect(pedidoBPersistido).toBeDefined();
  });
});

describe("CASO EXTRA — criação concorrente com a limpeza preguiçosa de GET /api/orders (escritor de maior frequência prática, ~3s por poll) — corrigido", () => {
  test("GET faz limpeza preguiçosa de um lock de edição expirado enquanto um pedido novo é criado (Promise.all): as duas mutações persistem", async () => {
    const agoraISO = new Date(Date.now() - 10 * 60_000).toISOString(); // editExpiresAt no passado
    seedPedidos([
      {
        id: "4001", numero: 1, cliente: "Cliente Com Edição Expirada", telefone: "5533333333333",
        itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1",
        editStatus: "editing", editExpiresAt: agoraISO, editSessionId: "sess-1",
      },
    ]);

    const [resGet, resPost] = await Promise.all([
      GET(authedRequest("GET")),
      POST(authedRequest("POST", { cliente: "Cliente Novo Concorrente", telefone: "5544444444444", itens: ["Pizza G"], total: 55, endereco: "Rua 2" })),
    ]);

    expect(resGet.status).toBe(200);
    expect(resPost.status).toBe(201);
    const pedidoNovo = await resPost.json();

    const persistidos = (redisStore.get("pedidos") as Record<string, unknown>[]) ?? [];
    const pedidoNovoPersistido = persistidos.find(p => p.id === pedidoNovo.id);
    const pedidoComEdicaoPersistido = persistidos.find(p => p.id === "4001");

    expect(pedidoNovoPersistido).toBeDefined();
    expect(pedidoComEdicaoPersistido?.editStatus).toBe("none");
  });
});
