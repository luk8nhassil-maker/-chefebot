import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// AUDITORIA — bug de LOST UPDATE confirmado na chave Redis "pedidos"
// (achado separado da colisão de pedido.id corrigida no PR #289).
//
// Mapa completo em docs/architecture/REDIS_KEY_INVENTORY.md, seção 1: a
// própria documentação do projeto já classifica `pedidos` como 🔴 crítico e
// "o maior risco estrutural do modelo atual" — toda mutação (criar, mudar
// status, editar, sair para entrega, confirmar Pix, escalonar, arquivar,
// limpar) faz GET do array inteiro + mutação em memória + SET do array
// inteiro, sem nenhuma proteção que abranja TODOS os escritores. O mutex por
// pedidoId (adquirirMutexEdicao) só serializa escritores que disputam o
// MESMO id — nunca protege contra um escritor de OUTRO id (ou sem id, como
// GET.lazy-cleanup) sobrescrevendo com um snapshot desatualizado.
//
// Este arquivo prova (não presume) dois cenários adicionais de Categoria B
// (qualquer mutação concorrente, não só criação x criação):
//   CASO 3 — criação x mudança de status de OUTRO pedido já existente.
//   CASO EXTRA — criação x limpeza preguiçosa do GET /api/orders (que roda
//     a cada poll do painel, "a cada 3s" segundo a documentação — o
//     escritor de MAIOR frequência prática entre todos os encontrados).
//
// `test.fails` documenta os dois como bugs CONHECIDOS e NÃO corrigidos por
// este relatório de auditoria — a decisão de implementar foi propositalmente
// parada antes do patch (ver ENTREGA), porque fechar corretamente exige
// tocar em ~17 arquivos/~25 pontos de escrita, não um único arquivo.

const redisStore = new Map<string, unknown>();

// Barreira: um mock de redis.get/set síncrono demais (resolve no mesmo tick)
// faz duas chamadas de rota concorrentes (Promise.all) raramente entrelaçarem
// no ponto exato da corrida — cada handler tem um número diferente de awaits
// antes do GET/SET final de "pedidos", então o agendamento "por acaso" do
// event loop nem sempre expõe o problema, mesmo quando ele existe de verdade.
// Em produção, cada redis.get/set é uma chamada de rede real — sempre cede o
// event loop. Este `await` extra (macrotask, não microtask) reproduz essa
// cessão real e força as duas requisições concorrentes a genuinamente se
// entrelaçarem no acesso à chave "pedidos", tornando a corrida determinística
// em vez de dependente de sorte de agendamento.
function macrotaskYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
async function defaultGetImpl(key: string) {
  if (key === "pedidos") await macrotaskYield();
  return redisStore.has(key) ? redisStore.get(key) : null;
}
async function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return null;
  if (key === "pedidos") await macrotaskYield();
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

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(defaultGetImpl),
    set: vi.fn(defaultSetImpl),
    del: vi.fn(defaultDelImpl),
    incr: vi.fn(defaultIncrImpl),
    expire: vi.fn(async () => 1),
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

describe("CASO 3 — criação de um pedido concorrente com mudança de status de OUTRO pedido já existente", () => {
  test.fails("Pedido A muda de status enquanto Pedido B é criado (Promise.all): SEM correção, um dos dois desaparece da lista persistida", async () => {
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

    // Comportamento ESPERADO (sem lost update): A tem o novo status E B está
    // persistido — nenhum dos dois desaparece por causa do outro.
    expect(pedidoAPersistido?.status).toBe("em_preparo");
    expect(pedidoBPersistido).toBeDefined();
  });
});

describe("CASO EXTRA — criação concorrente com a limpeza preguiçosa de GET /api/orders (escritor de maior frequência prática, ~3s por poll)", () => {
  test.fails("GET faz limpeza preguiçosa de um lock de edição expirado enquanto um pedido novo é criado (Promise.all): SEM correção, a limpeza do GET é silenciosamente perdida", async () => {
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

    // Comportamento ESPERADO (sem lost update): a criação concorrente
    // persiste E a limpeza preguiçosa do lock expirado (editStatus:
    // "editing" -> "none") também sobrevive — nenhuma das duas mutações
    // apaga a outra, mesmo escrevendo a mesma chave "pedidos" quase ao
    // mesmo tempo.
    expect(pedidoNovoPersistido).toBeDefined();
    expect(pedidoComEdicaoPersistido?.editStatus).toBe("none");
  });
});
