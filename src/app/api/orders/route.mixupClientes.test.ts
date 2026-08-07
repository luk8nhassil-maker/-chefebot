import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// AUDITORIA + REGRESSÃO — incidente de produção: notificações de status
// chegando com nome/telefone de OUTRO cliente na mesma conversa do WhatsApp.
//
// Causa raiz comprovada: o campo `id` de todo pedido (usado como ÚNICA chave
// de busca em toda troca de status / notificação) era gerado com
// `Date.now().toString()` — resolução de 1ms, sem sufixo aleatório nem
// verificação de unicidade. Sob criação concorrente (dois clientes
// finalizando pedido no mesmo milissegundo, perfeitamente plausível em
// horário de pico com múltiplos webhooks da Evolution API chegando em
// paralelo), dois pedidos de clientes DIFERENTES podiam nascer com o MESMO
// `id`. Como `pedidos.findIndex(p => p.id === id)` sempre resolve para a
// PRIMEIRA ocorrência, toda troca de status feita a partir daí (em_preparo,
// saiu_entrega, entregue, ...) — não importa a qual dos dois pedidos o
// operador realmente pretendia mudar o status — acabava lendo nome+telefone
// do primeiro pedido daquele id, notificando sempre o MESMO cliente errado,
// repetidamente, com mensagens de status que na verdade pertenciam ao outro.
// Isso bate com o padrão observado (mesmo nome recebendo várias mensagens de
// status diferentes, enquanto outro nome aparece isolado).
//
// O `numero` sequencial (via INCR atômico, ver src/lib/numeracao.ts) já era o
// único identificador realmente único no sistema — mas não é usado como
// chave de busca em nenhum PATCH/notificação; só o `id` era usado.
//
// Patch: `gerarIdPedidoUnico` (src/lib/numeracao.ts) reivindica o id via
// SET NX antes de devolvê-lo, preservando `id === Date.now().toString()` no
// caso comum (sem mudar formato/tamanho em nenhum outro fluxo, inclusive o
// txid do Pix) e só desempatando no caso raro de colisão real.
//
// Os testes do grupo "CAUSA RAIZ" abaixo agora expressam a garantia SEGURA
// (pós-patch) — não devem voltar a aceitar colisão de id.

const redisStore = new Map<string, unknown>();

function defaultGetImpl(key: string) {
  return Promise.resolve(redisStore.has(key) ? redisStore.get(key) : null);
}
function defaultSetImpl(key: string, value: unknown, opts?: { nx?: boolean }) {
  if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
  redisStore.set(key, value);
  return Promise.resolve("OK");
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

const fetchMock = vi.fn(async (_url: string, _opts?: RequestInit) => ({ ok: true, json: async () => ({}) }));
vi.stubGlobal("fetch", fetchMock);

import { PATCH, POST } from "./route";

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

// Retorna todos os envios de sendText desta chamada, na ordem, como {numero, texto}.
function envios(): { numero: string; texto: string }[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/message/sendText/"))
    .map(([, opts]) => {
      const parsed = JSON.parse(String((opts as RequestInit).body));
      return { numero: parsed.number as string, texto: parsed.text as string };
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

describe("Isolamento correto quando os ids NÃO colidem (Casos 1-4 do roteiro de auditoria)", () => {
  test("Caso 1/2: duas trocas de status concorrentes para dois clientes distintos nunca se cruzam", async () => {
    seedPedidos([
      { id: "1001", numero: 1, cliente: "Fernanda Alves", telefone: "5511111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua A", tipoEntrega: "delivery" },
      { id: "1002", numero: 2, cliente: "Ricardo Nunes", telefone: "5522222222222", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua B", tipoEntrega: "delivery" },
    ]);

    await Promise.all([
      PATCH(patchRequest({ id: "1001", status: "em_preparo" })),
      PATCH(patchRequest({ id: "1002", status: "em_preparo" })),
    ]);

    const mensagens = envios();
    const paraA = mensagens.filter(m => m.numero === "5511111111111");
    const paraB = mensagens.filter(m => m.numero === "5522222222222");

    expect(paraA.length).toBeGreaterThan(0);
    expect(paraB.length).toBeGreaterThan(0);
    for (const m of paraA) expect(m.texto).toContain("Fernanda");
    for (const m of paraB) expect(m.texto).toContain("Ricardo");
    // Nenhuma mensagem enviada ao número de A cita o nome de B, e vice-versa.
    for (const m of paraA) expect(m.texto).not.toContain("Ricardo");
    for (const m of paraB) expect(m.texto).not.toContain("Fernanda");
  });

  test("Caso 4: três ou mais pedidos concorrentes — cada telefone recebe só seu próprio pedido", async () => {
    seedPedidos([
      { id: "2001", numero: 1, cliente: "Ana", telefone: "5531111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "2002", numero: 2, cliente: "Bruno", telefone: "5532222222222", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
      { id: "2003", numero: 3, cliente: "Carla", telefone: "5533333333333", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 3", tipoEntrega: "delivery" },
    ]);

    await Promise.all([
      PATCH(patchRequest({ id: "2001", status: "em_preparo" })),
      PATCH(patchRequest({ id: "2002", status: "em_preparo" })),
      PATCH(patchRequest({ id: "2003", status: "em_preparo" })),
    ]);

    const mensagens = envios();
    expect(mensagens.find(m => m.numero === "5531111111111")?.texto).toContain("Ana");
    expect(mensagens.find(m => m.numero === "5532222222222")?.texto).toContain("Bruno");
    expect(mensagens.find(m => m.numero === "5533333333333")?.texto).toContain("Carla");
  });
});

describe("CAUSA RAIZ (corrigida): id de pedido não colide mais sob criação concorrente", () => {
  // Antes do patch, estes dois testes provavam a colisão (dois pedidos de
  // clientes diferentes, criados no mesmo Date.now() mockado, nasciam com o
  // MESMO `id` — e o PATCH por esse id só conseguia endereçar o primeiro,
  // nunca o segundo). Ver histórico do PR do incidente para a versão que
  // reproduzia o bug com `expect(pedidoA.id).toBe(pedidoB.id)`. Agora que
  // `gerarIdPedidoUnico` (src/lib/numeracao.ts) reivindica o id via SET NX
  // antes de usá-lo, estes testes verificam a garantia inversa: mesmo no
  // mesmo milissegundo, os dois pedidos ficam com ids diferentes e cada um
  // continua endereçável e notificável corretamente.
  test("dois pedidos de clientes diferentes criados no mesmo milissegundo recebem ids DIFERENTES", async () => {
    const FIXO_MS = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(FIXO_MS);

    const resA = await POST(postRequest({
      cliente: "Jessica Ramos", telefone: "5541111111111", itens: ["Pizza G"], total: 50, endereco: "Rua das Palmeiras, 1",
    }));
    const resB = await POST(postRequest({
      cliente: "Adriano Silva", telefone: "5542222222222", itens: ["Pizza M"], total: 40, endereco: "Rua das Acácias, 2",
    }));

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const pedidoA = await resA.json();
    const pedidoB = await resB.json();

    // Mesmo com Date.now() travado no mesmo valor para as duas criações, os
    // ids não colidem mais — a reivindicação atômica força o desempate.
    expect(pedidoA.id).not.toBe(pedidoB.id);
    // Caso comum (primeira reivindicação): id continua EXATAMENTE
    // Date.now().toString(), sem mudar formato/tamanho usado no resto do
    // sistema (Pix txid, ordenação por timestampOrdenacaoPedido, etc.).
    expect(pedidoA.id).toBe(String(FIXO_MS));

    const persistidos = redisStore.get("pedidos") as Record<string, unknown>[];
    expect(persistidos.filter(p => p.id === pedidoA.id)).toHaveLength(1);
    expect(persistidos.filter(p => p.id === pedidoB.id)).toHaveLength(1);
  });

  test("cada pedido criado no mesmo milissegundo é notificado corretamente, sem cruzar nome/telefone", async () => {
    const FIXO_MS = 1_700_000_000_001;
    vi.spyOn(Date, "now").mockReturnValue(FIXO_MS);

    const resA = await POST(postRequest({
      cliente: "Jessica Ramos", telefone: "5541111111111", itens: ["Pizza G"], total: 50, endereco: "Rua das Palmeiras, 1", tipoEntrega: "delivery",
    }));
    const resB = await POST(postRequest({
      cliente: "Adriano Silva", telefone: "5542222222222", itens: ["Pizza M"], total: 40, endereco: "Rua das Acácias, 2", tipoEntrega: "delivery",
    }));
    const pedidoA = await resA.json();
    const pedidoB = await resB.json();
    expect(pedidoA.id).not.toBe(pedidoB.id); // pré-condição: sem colisão

    vi.restoreAllMocks(); // Date.now volta ao normal para as trocas de status.
    fetchMock.mockClear();

    await PATCH(patchRequest({ id: pedidoB.id, status: "em_preparo" }));
    await PATCH(patchRequest({ id: pedidoA.id, status: "em_preparo" }));
    await PATCH(patchRequest({ id: pedidoA.id, status: "saiu_entrega" }));

    const mensagens = envios();
    const paraJessica = mensagens.filter(m => m.numero === "5541111111111");
    const paraAdriano = mensagens.filter(m => m.numero === "5542222222222");

    // Adriano só recebe mensagens sobre o próprio pedido.
    expect(paraAdriano.length).toBe(1);
    expect(paraAdriano[0].texto).toContain("Adriano");
    expect(paraAdriano[0].texto).not.toContain("Jessica");

    // Jessica recebe as duas mensagens do próprio pedido (em_preparo e
    // saiu_entrega) — nunca nada endereçado ao Adriano.
    expect(paraJessica.length).toBe(2);
    for (const m of paraJessica) {
      expect(m.texto).toContain("Jessica");
      expect(m.texto).not.toContain("Adriano");
    }
  });
});

describe("Hipóteses alternativas descartadas pela auditoria", () => {
  test("Caso 6: nomes iguais em pedidos com ids diferentes NÃO são tratados como o mesmo cliente", async () => {
    seedPedidos([
      { id: "3001", numero: 1, cliente: "Amanda Reis", telefone: "5551111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "3002", numero: 2, cliente: "Amanda Reis", telefone: "5552222222222", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "3002", status: "em_preparo" }));

    const mensagens = envios();
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].numero).toBe("5552222222222");
  });

  test("Caso 7: mesmo telefone em dois pedidos legítimos (ids diferentes) não é contaminação de estado", async () => {
    seedPedidos([
      { id: "4001", numero: 1, cliente: "Jessica Ramos", telefone: "5561111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "4002", numero: 2, cliente: "Adriano Silva", telefone: "5561111111111", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "4001", status: "em_preparo" }));
    fetchMock.mockClear();
    await PATCH(patchRequest({ id: "4002", status: "saiu_entrega" }));

    const mensagens = envios();
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].numero).toBe("5561111111111");
    expect(mensagens[0].texto).toContain("Adriano");
    expect(mensagens[0].texto).not.toContain("Jessica");
  });

  test("Caso 8: telefone ausente nunca cai para o telefone de outro pedido do array", async () => {
    seedPedidos([
      { id: "5001", numero: 1, cliente: "Cliente Sem Telefone", telefone: "", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
      { id: "5002", numero: 2, cliente: "Outro Cliente", telefone: "5571234567890", itens: ["x"], total: 10, status: "novo", horario: "10:00", endereco: "Rua 2", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "5001", status: "em_preparo" }));

    const mensagens = envios();
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0].numero).not.toBe("5571234567890");
    expect(mensagens[0].numero).toBe("55"); // sanitizePhone("") -> só o prefixo do país
  });
});

describe("Achado secundário (não é a causa raiz, mas é duplicidade real e distinta da corrigida no PR #288)", () => {
  test("Caso 5: repetir o mesmo status no mesmo pedido reenvia a notificação (sem idempotência de notificação)", async () => {
    seedPedidos([
      { id: "6001", numero: 1, cliente: "Cliente Único", telefone: "5581111111111", itens: ["x"], total: 10, status: "em_preparo", horario: "10:00", endereco: "Rua 1", tipoEntrega: "delivery" },
    ]);

    await PATCH(patchRequest({ id: "6001", status: "saiu_entrega" }));
    await PATCH(patchRequest({ id: "6001", status: "saiu_entrega" }));

    const mensagens = envios().filter(m => m.numero === "5581111111111");
    // Documenta o comportamento atual: cada PATCH reenvia, mesmo sem mudança real de status.
    expect(mensagens.length).toBe(2);
  });
});
