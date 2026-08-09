import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regressão: a notificação de "saiu_entrega" mandava sempre "seu pedido
// saiu pra entrega! 🛵" pro cliente, mesmo quando o tipo de recebimento era
// retirada no balcão ou consumo no local — onde "saiu pra entrega" não faz
// sentido nenhum (ninguém está levando nada pra lugar nenhum).

const redisStore = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (redisStore.has(key) ? JSON.parse(JSON.stringify(redisStore.get(key))) : null)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
    // Compare-and-delete atômico do lock GLOBAL de "pedidos" (ver
    // src/lib/pedidosConcorrencia.ts) — 1 chave + 1 arg (o token).
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      const [chave] = keys;
      const [tokenEsperado] = args;
      if (redisStore.get(chave) === tokenEsperado) {
        redisStore.delete(chave);
        return 1;
      }
      return 0;
    }),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => (token === "token-admin" ? { username: "kellyne", name: "Kellyne", role: "admin" } : null)),
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

import { PATCH } from "./route";

function seedPedido(overrides: Record<string, unknown> = {}) {
  const pedido = {
    id: "ped_notif_1",
    numero: 10,
    cliente: "Wesley Dutra",
    telefone: "86999998888",
    itens: ["1x Pizza G Calabresa"],
    total: 50,
    status: "em_preparo",
    horario: "20:00",
    endereco: "Rua 1",
    ...overrides,
  };
  redisStore.set("pedidos", [pedido]);
  return pedido;
}

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

function textoEnviado(): string | undefined {
  const chamada = fetchMock.mock.calls.find(([url]) => String(url).includes("/message/sendText/"));
  if (!chamada) return undefined;
  const opts = chamada[1] as RequestInit;
  return JSON.parse(String(opts.body)).text;
}

beforeEach(() => {
  redisStore.clear();
  fetchMock.mockClear();
});

describe("PATCH /api/orders — mensagem de status varia por tipo de recebimento", () => {
  // 1. Delivery -> copy exata.
  test("delivery: copy exata de 'saiu para entrega' (nunca a de retirada/consumo local)", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "delivery", endereco: "Rua das Flores, 123" });
    const res = await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(res.status).toBe(200);
    expect(textoEnviado()).toBe("*Wesley*, seu pedido saiu para entrega! 🛵\n\nJá está a caminho.");
  });

  // 2. Retirada -> copy exata.
  test("retirada: copy exata de 'pedido pronto' (nunca 'saiu para entrega')", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "retirada", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍕\n\nPode vir buscar.");
  });

  // 3. Consumo no local no fluxo REAL (em_preparo -> entregue, pula saiu_entrega) -> copy exata.
  test("consumo no local: fluxo real em_preparo -> entregue recebe a copy exata de 'pedido pronto'", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "dine_in", endereco: "Consumo no local", status: "em_preparo" });
    const res = await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍽️\n\nBom apetite!");
  });

  // 4. Retirada nunca contém "saiu para entrega".
  test("retirada: nunca contém 'saiu para entrega'", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).not.toContain("saiu para entrega");
  });

  // 5. Consumo local nunca contém "saiu para entrega" — nem no fluxo real
  // (em_preparo -> entregue) nem no caminho manual/legado (saiu_entrega).
  test("consumo no local: nunca contém 'saiu para entrega', em nenhum dos dois caminhos possíveis", async () => {
    seedPedido({ tipoEntrega: "dine_in", endereco: "Consumo no local", status: "em_preparo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textoEnviado()).not.toContain("saiu para entrega");

    fetchMock.mockClear();
    seedPedido({ tipoEntrega: "dine_in", endereco: "Consumo no local", status: "em_preparo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).not.toContain("saiu para entrega");
  });

  // 6. Compatibilidade com pickup legado (retirada, saiu_entrega).
  test("retirada também funciona com tipoEntrega legado 'pickup'", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "pickup", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍕\n\nPode vir buscar.");
  });

  // 7. Compatibilidade por endereco legado "Retirada na loja" (sem tipoEntrega).
  test("retirada é reconhecida pelo endereco mesmo sem tipoEntrega (pedidos antigos)", async () => {
    seedPedido({ cliente: "Wesley Dutra", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍕\n\nPode vir buscar.");
  });

  // 8. Compatibilidade por endereco legado "Consumo no local" (sem tipoEntrega),
  // no fluxo real em_preparo -> entregue.
  test("consumo no local é reconhecido pelo endereco mesmo sem tipoEntrega, no fluxo real em_preparo -> entregue", async () => {
    seedPedido({ cliente: "Wesley Dutra", endereco: "Consumo no local", status: "em_preparo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍽️\n\nBom apetite!");
  });

  // 10. Fluxos não relacionados continuam inalterados.
  test("mensagens de em_preparo e cancelado continuam iguais para qualquer tipo (não mudou)", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja", status: "novo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "em_preparo" }));
    expect(textoEnviado()).toContain("sendo preparado");

    fetchMock.mockClear();
    await PATCH(patchRequest({ id: "ped_notif_1", status: "cancelado" }));
    expect(textoEnviado()).toContain("cancelado");
  });

  // 10. delivery/retirada em "entregue" continuam com a mensagem genérica de
  // sempre — só consumo no local vindo de em_preparo ganha a copy de "pronto".
  test("delivery e retirada em 'entregue' continuam com a mensagem genérica de sempre (não a de 'pronto')", async () => {
    seedPedido({ tipoEntrega: "delivery", endereco: "Rua das Flores, 123", status: "saiu_entrega" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textoEnviado()).toContain("pedido entregue");
    expect(textoEnviado()).not.toContain("está pronto");

    fetchMock.mockClear();
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja", status: "saiu_entrega" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textoEnviado()).toContain("pedido entregue");
    expect(textoEnviado()).not.toContain("está pronto");
  });

  test("consumo no local em 'entregue' vindo de 'saiu_entrega' (caminho manual/atípico) usa a mensagem genérica, não duplica o 'pronto'", async () => {
    seedPedido({ tipoEntrega: "dine_in", endereco: "Consumo no local", status: "saiu_entrega" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textoEnviado()).toContain("pedido entregue");
    expect(textoEnviado()).not.toContain("está pronto");
  });

  // 9. silent:true não envia WhatsApp.
  test("silent:true não notifica ninguém, independente do tipo ou status", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega", silent: true }));
    expect(fetchMock.mock.calls.find(([url]) => String(url).includes("/message/sendText/"))).toBeUndefined();

    fetchMock.mockClear();
    seedPedido({ tipoEntrega: "dine_in", endereco: "Consumo no local", status: "em_preparo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue", silent: true }));
    expect(fetchMock.mock.calls.find(([url]) => String(url).includes("/message/sendText/"))).toBeUndefined();
  });
});
