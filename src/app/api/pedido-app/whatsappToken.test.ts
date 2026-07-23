import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    // Dois scripts do lock global de pedidosStore.ts: compare-and-delete (1
    // key, libera o lock) e a escrita cercada de "pedidos" via
    // escreverPedidosCercado (2 keys: lock + "pedidos").
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (keys.length >= 2) {
        const [lockKey, pedidosKey] = keys;
        const [token, jsonValor] = args;
        if (store.get(lockKey) !== token) return 0;
        store.set(pedidosKey, JSON.parse(jsonValor));
        return 1;
      }
      const [key] = keys;
      const [token] = args;
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/mercadoPagoPix", () => ({
  criarCobrancaPixMercadoPago: vi.fn().mockResolvedValue(null),
}));

import { POST } from "./route";

function postReq(body: unknown) {
  return { json: async () => body } as never;
}

const PHONE_WHATSAPP = "5599974000691";
const TOKEN_VALIDO = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const basePayload = {
  cliente: "Ana Silva",
  itens: [
    { kind: "simple", name: "Refrigerante 2L", detail: "", price: 1, qty: 1 },
  ],
  tipoEntrega: "retirada",
  pagamento: "Cartão",
};

function ultimoPedido(): Record<string, unknown> {
  const pedidos = (store.get("pedidos") as Record<string, unknown>[]) || [];
  return pedidos[pedidos.length - 1];
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/pedido-app — vínculo com WhatsApp via token (token é a fonte principal)", () => {
  // 1. Pedido com token válido e sem telefone salva o phone do token.
  it("token válido e sem telefone no body: salva o phone do WhatsApp e marca vínculo", async () => {
    store.set(`cardapio:token:${TOKEN_VALIDO}`, { phone: PHONE_WHATSAPP, createdAt: Date.now() });
    const res = await POST(postReq({ ...basePayload, whatsappToken: TOKEN_VALIDO }));
    const data = await (res as Response).json();
    expect(data.ok).toBe(true);
    const pedido = ultimoPedido();
    expect(pedido.telefone).toBe(PHONE_WHATSAPP);
    expect(pedido.whatsappVinculado).toBe(true);
  });

  // 2. Pedido com token válido e telefone antigo no body ainda salva o phone do token.
  it("token válido e telefone antigo/stale no body: token vence, telefone do body é ignorado", async () => {
    store.set(`cardapio:token:${TOKEN_VALIDO}`, { phone: PHONE_WHATSAPP, createdAt: Date.now() });
    const res = await POST(postReq({ ...basePayload, whatsappToken: TOKEN_VALIDO, telefone: "(11) 90000-0000" }));
    const data = await (res as Response).json();
    expect(data.ok).toBe(true);
    const pedido = ultimoPedido();
    expect(pedido.telefone).toBe(PHONE_WHATSAPP);
    expect(pedido.telefone).not.toBe("(11) 90000-0000");
    expect(pedido.whatsappVinculado).toBe(true);
  });

  // 3. usarOutroWhatsapp: true salva o telefone digitado e NÃO trata como vínculo automático.
  it("token válido + usarOutroWhatsapp:true: usa o telefone digitado, sem marcar vínculo automático", async () => {
    store.set(`cardapio:token:${TOKEN_VALIDO}`, { phone: PHONE_WHATSAPP, createdAt: Date.now() });
    const res = await POST(postReq({
      ...basePayload, whatsappToken: TOKEN_VALIDO, telefone: "(11) 93333-4444", usarOutroWhatsapp: true,
    }));
    const data = await (res as Response).json();
    expect(data.ok).toBe(true);
    const pedido = ultimoPedido();
    expect(pedido.telefone).toBe("(11) 93333-4444");
    expect(pedido.whatsappVinculado).toBeUndefined();
  });

  it("usarOutroWhatsapp:true sem telefone digitado ainda exige telefone (não cai de volta pro token)", async () => {
    store.set(`cardapio:token:${TOKEN_VALIDO}`, { phone: PHONE_WHATSAPP, createdAt: Date.now() });
    const res = await POST(postReq({ ...basePayload, whatsappToken: TOKEN_VALIDO, usarOutroWhatsapp: true }));
    expect((res as Response).status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  // 4. Pedido sem token continua exigindo telefone manual.
  it("sem token: fluxo atual intacto — telefone digitado obrigatório e salvo", async () => {
    const semTel = await POST(postReq(basePayload));
    expect((semTel as Response).status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();

    const comTel = await POST(postReq({ ...basePayload, telefone: "(99) 99999-9999" }));
    const data = await (comTel as Response).json();
    expect(data.ok).toBe(true);
    expect(ultimoPedido().telefone).toBe("(99) 99999-9999");
    expect(ultimoPedido().whatsappVinculado).toBeUndefined();
  });

  // 5. Token inválido não vincula telefone.
  it("token inválido/expirado com telefone digitado: usa o telefone digitado e NÃO marca vínculo", async () => {
    const res = await POST(postReq({ ...basePayload, whatsappToken: "deadbeef".repeat(4), telefone: "(11) 91111-2222" }));
    const data = await (res as Response).json();
    expect(data.ok).toBe(true);
    const pedido = ultimoPedido();
    expect(pedido.telefone).toBe("(11) 91111-2222");
    expect(pedido.whatsappVinculado).toBeUndefined();
  });

  it("token inválido/expirado sem telefone digitado: rejeita pedindo telefone (não vincula nada)", async () => {
    const res = await POST(postReq({ ...basePayload, whatsappToken: TOKEN_VALIDO }));
    expect((res as Response).status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("token de formato malicioso não consulta vínculo e cai na regra normal", async () => {
    const res = await POST(postReq({ ...basePayload, whatsappToken: "../../pedidos", telefone: "(11) 91111-2222" }));
    const data = await (res as Response).json();
    expect(data.ok).toBe(true);
    expect(ultimoPedido().telefone).toBe("(11) 91111-2222");
    expect(ultimoPedido().whatsappVinculado).toBeUndefined();
  });

  // 6. LocalStorage antigo (representado aqui pelo campo telefone do body) não sobrescreve token válido.
  it("localStorage antigo (telefone no body) não sobrescreve o vínculo do token sem usarOutroWhatsapp explícito", async () => {
    store.set(`cardapio:token:${TOKEN_VALIDO}`, { phone: PHONE_WHATSAPP, createdAt: Date.now() });
    const res = await POST(postReq({ ...basePayload, whatsappToken: TOKEN_VALIDO, telefone: "(21) 98888-7777" }));
    const data = await (res as Response).json();
    expect(data.ok).toBe(true);
    expect(ultimoPedido().telefone).toBe(PHONE_WHATSAPP);
  });

  it("cliente não força vínculo com phone arbitrário: o vínculo só sai do Redis, nunca do body", async () => {
    store.set(`cardapio:token:${TOKEN_VALIDO}`, { phone: PHONE_WHATSAPP, createdAt: Date.now() });
    const res = await POST(postReq({ ...basePayload, whatsappToken: TOKEN_VALIDO, phone: "5500000000000", whatsappPhone: "5500000000000" }));
    const data = await (res as Response).json();
    expect(data.ok).toBe(true);
    expect(ultimoPedido().telefone).toBe(PHONE_WHATSAPP);
  });
});
