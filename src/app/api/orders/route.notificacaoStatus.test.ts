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

function nenhumaMensagemEnviada(): boolean {
  return fetchMock.mock.calls.find(([url]) => String(url).includes("/message/sendText/")) === undefined;
}

// Todos os textos de WhatsApp enviados nesta chamada (pode ter mais de um —
// ex.: "entregue" também dispara a pesquisa de avaliação, um fluxo separado
// e fora de escopo desta tarefa, que continua funcionando igual). Usado
// quando o teste precisa provar que NENHUM dos textos enviados é a
// mensagem de status (não que nada foi enviado).
function textosEnviados(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes("/message/sendText/"))
    .map(([, opts]) => JSON.parse(String((opts as RequestInit).body)).text as string);
}

describe("PATCH /api/orders — cliente recebe a sequência completa de status", () => {
  test("em_preparo avisa que o pedido foi enviado para a cozinha", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja", status: "novo" });
    const res = await PATCH(patchRequest({ id: "ped_notif_1", status: "em_preparo" }));
    expect(res.status).toBe(200);
    expect(textoEnviado()).toBe("*Wesley*, seu pedido foi enviado para a cozinha! 👨‍🍳🍕\n\nJá começamos o preparo e avisaremos você a cada etapa.");
  });

  // Delivery envia somente no saiu_entrega — 1. copy exata.
  test("delivery: envia a copy exata de 'saiu para entrega' em saiu_entrega", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "delivery", endereco: "Rua das Flores, 123" });
    const res = await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(res.status).toBe(200);
    expect(textoEnviado()).toBe("*Wesley*, seu pedido saiu para entrega! 🛵\n\nJá está a caminho.");
  });

  // Retirada envia somente no saiu_entrega — 2. copy exata.
  test("retirada: envia a copy exata de 'pedido pronto' em saiu_entrega (nunca 'saiu para entrega')", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "retirada", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍕\n\nPode vir buscar.");
    expect(textoEnviado()).not.toContain("saiu para entrega");
  });

  // Consumo local envia "pronto" no fluxo real em_preparo -> entregue — 3. copy exata.
  test("consumo no local: fluxo real em_preparo -> entregue recebe a copy exata de 'pedido pronto'", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "dine_in", endereco: "Consumo no local", status: "em_preparo" });
    const res = await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(res.status).toBe(200);
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍽️\n\nBom apetite!");
    expect(textoEnviado()).not.toContain("saiu para entrega");
  });

  test("delivery e retirada em 'entregue' avisam que o pedido foi finalizado", async () => {
    seedPedido({ tipoEntrega: "delivery", endereco: "Rua das Flores, 123", status: "saiu_entrega" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textosEnviados()).toContain("*Wesley*, seu pedido foi finalizado! ✅🍕\n\nObrigado pela preferência. Bom apetite!");

    fetchMock.mockClear();
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja", status: "saiu_entrega" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textosEnviados()).toContain("*Wesley*, seu pedido foi finalizado! ✅🍕\n\nObrigado pela preferência. Bom apetite!");
  });

  test("consumo no local vindo de saiu_entrega finaliza sem repetir a mensagem de pronto", async () => {
    seedPedido({ tipoEntrega: "dine_in", endereco: "Consumo no local", status: "saiu_entrega" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textosEnviados()).toContain("*Wesley*, seu pedido foi finalizado! ✅🍕\n\nObrigado pela preferência. Bom apetite!");
    expect(textosEnviados().filter(texto => texto.includes("está pronto"))).toHaveLength(0);
  });

  // cancelado continua notificando — mensagem preservada.
  test("cancelado: continua enviando a mensagem de cancelamento de sempre", async () => {
    seedPedido({ tipoEntrega: "delivery", endereco: "Rua das Flores, 123" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "cancelado" }));
    expect(textoEnviado()).toContain("cancelado");
  });

  // Compatibilidade pickup legado continua funcionando.
  test("retirada também funciona com tipoEntrega legado 'pickup'", async () => {
    seedPedido({ cliente: "Wesley Dutra", tipoEntrega: "pickup", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍕\n\nPode vir buscar.");
  });

  // Compatibilidade por endereco legado "Retirada na loja" continua funcionando.
  test("retirada é reconhecida pelo endereco mesmo sem tipoEntrega (pedidos antigos)", async () => {
    seedPedido({ cliente: "Wesley Dutra", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍕\n\nPode vir buscar.");
  });

  // Compatibilidade por endereco legado "Consumo no local" continua funcionando.
  test("consumo no local é reconhecido pelo endereco mesmo sem tipoEntrega, no fluxo real em_preparo -> entregue", async () => {
    seedPedido({ cliente: "Wesley Dutra", endereco: "Consumo no local", status: "em_preparo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue" }));
    expect(textoEnviado()).toBe("*Wesley*, seu pedido está pronto! 🍽️\n\nBom apetite!");
  });

  // silent:true continua sem notificar, independente do tipo ou status.
  test("silent:true não notifica ninguém, independente do tipo ou status", async () => {
    seedPedido({ tipoEntrega: "retirada", endereco: "Retirada na loja" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "saiu_entrega", silent: true }));
    expect(nenhumaMensagemEnviada()).toBe(true);

    fetchMock.mockClear();
    seedPedido({ tipoEntrega: "dine_in", endereco: "Consumo no local", status: "em_preparo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "entregue", silent: true }));
    expect(nenhumaMensagemEnviada()).toBe(true);
  });

  test("repetir o mesmo status não duplica a mensagem", async () => {
    seedPedido({ tipoEntrega: "delivery", status: "em_preparo" });
    await PATCH(patchRequest({ id: "ped_notif_1", status: "em_preparo" }));
    expect(nenhumaMensagemEnviada()).toBe(true);
  });

  test("falha da Evolution preserva o status e retorna aviso operacional", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
    seedPedido({ tipoEntrega: "delivery", status: "novo" });
    const res = await PATCH(patchRequest({ id: "ped_notif_1", status: "em_preparo" }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("em_preparo");
    expect(data.avisoOperacional).toMatch(/mensagem ao cliente não foi enviada/i);
  });
});
