import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => store.delete(key) ? 1 : 0),
      keys: vi.fn(async () => []),
      eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
        if (store.get(keys[0]) !== args[0]) return 0;
        store.delete(keys[0]);
        return 1;
      }),
    },
  };
});

vi.mock("@/lib/redis", () => ({ redis: h.redis }));
vi.mock("@/lib/fidelidadeEfeitos", () => ({ processarEfeitosPedidoEntregue: vi.fn(async () => {}) }));
vi.mock("@/lib/conversa", () => ({
  registrarMensagem: vi.fn(async () => {}),
  ultimasMensagensRelevantes: vi.fn(async () => []),
}));

import { POST } from "./route";

const PHONE_ENTREGADOR = "5586999990001";

beforeEach(() => {
  h.store.clear();
  vi.clearAllMocks();
  vi.stubEnv("EVOLUTION_API_URL", "https://evolution.exemplo.test");
  vi.stubEnv("EVOLUTION_API_KEY", "chave-teste");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
});

describe("entrega confirmada por entregador com bot pausado", () => {
  test("salva entrega e avisos operacionais, mas não envia pesquisa", async () => {
    h.store.set("bot_ativo", false);
    h.store.set(`entregador_aguardando:${PHONE_ENTREGADOR}`, "pedido-1");
    h.store.set("pedidos", [{
      id: "pedido-1",
      cliente: "Cliente Teste",
      telefone: "5586999990002",
      itens: ["Pizza"],
      total: 50,
      status: "saiu_entrega",
      horario: "18:00",
      endereco: "Rua Teste",
    }]);

    const res = await POST({ json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${PHONE_ENTREGADOR}@s.whatsapp.net`, id: "confirmacao-1", fromMe: false },
        message: { conversation: "1" },
      },
    }) } as never);

    expect(res.status).toBe(200);
    expect(h.store.get("pedidos")).toEqual(expect.arrayContaining([expect.objectContaining({ status: "entregue" })]));
    const textos = vi.mocked(fetch).mock.calls
      .filter(([url]) => String(url).includes("/message/sendText/"))
      .map(([, init]) => JSON.parse(String(init?.body)).text as string);
    expect(textos.some((texto) => texto.includes("pedido entregue"))).toBe(true);
    expect(textos.some((texto) => texto.includes("Avalia nossa pizza"))).toBe(false);
    expect(h.store.has("avaliacao_enviada:pedido-1")).toBe(false);
  });
});
