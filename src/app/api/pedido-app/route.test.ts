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
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST } from "./route";

function postReq(body: unknown) {
  return {
    json: async () => body,
  } as never;
}

const basePayload = {
  cliente: "Lucas Brito",
  telefone: "(99) 99999-9999",
  itens: [
    {
      kind: "simple",
      name: "Refrigerante 2L",
      detail: "",
      price: 1,
      qty: 2,
    },
  ],
  tipoEntrega: "delivery",
  bairro: "Centro",
  rua: "Rua das Flores",
  numero: "123",
  pagamento: "Pix",
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
});

describe("POST /api/pedido-app", () => {
  it("recalcula item simples com preco oficial do servidor quando o browser manda preco manipulado", async () => {
    const res = await POST(postReq(basePayload));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].itens).toEqual(["2x Refrigerante 2L"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(33);
  });

  it("recalcula pizza com tamanho e borda oficiais mais taxa de entrega", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [
        {
          kind: "pizza",
          name: "Pizza G",
          detail: "Calabresa · borda Catupiry",
          price: 1,
          qty: 1,
        },
      ],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Pizza G Calabresa · borda Catupiry"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(63);
  });

  it("retirada nao cobra taxa e ainda ignora preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      tipoEntrega: "retirada",
      bairro: undefined,
      rua: undefined,
      numero: undefined,
      pagamento: "Dinheiro",
      troco: "50",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].endereco).toBe("Retirada na loja");
    expect(pedidos[0].taxaEntrega).toBeUndefined();
    expect(pedidos[0].total).toBe(30);
    expect(pedidos[0].troco).toBe("50");
  });

  it("consumo no local nao cobra taxa e ainda ignora preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      tipoEntrega: "dine_in",
      bairro: undefined,
      rua: undefined,
      numero: undefined,
      pagamento: "Cartao",
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].endereco).toBe("Consumo no local");
    expect(pedidos[0].taxaEntrega).toBeUndefined();
    expect(pedidos[0].total).toBe(30);
  });


  it("aceita lanche simples com preco oficial mesmo se o browser manda preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "X-Burguer", detail: "", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["X-Burguer"]);
    expect(pedidos[0].total).toBe(18);
  });

  it("aceita suco com leite usando preco oficial mais adicional mesmo se o browser manda preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Caja", detail: "Com leite", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Caja Com leite"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(11);
  });

  it("aceita suco sem leite usando preco base oficial", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Caja", detail: "Sem leite", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Caja Sem leite"]);
    expect(pedidos[0].total).toBe(10);
  });

  it("rejeita suco com detail invalido", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Caja", detail: "Pouco leite", price: 8, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });
  it("aceita macarronada P com preco oficial mesmo se o browser manda preco manipulado", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Carne", detail: "Tamanho P", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(200);
    const pedidos = store.get("pedidos") as PedidoSalvo[];
    expect(pedidos[0].itens).toEqual(["Macarronada de Carne Tamanho P"]);
    expect(pedidos[0].taxaEntrega).toBe(3);
    expect(pedidos[0].total).toBe(31);
  });

  it("aceita macarronada M e G com precos oficiais", async () => {
    const resM = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Frango", detail: "Tamanho M", price: 1, qty: 1 }],
    }));
    expect(resM.status).toBe(200);
    expect((store.get("pedidos") as PedidoSalvo[])[0].total).toBe(43);

    store.clear();
    const resG = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Frango", detail: "Tamanho G", price: 1, qty: 1 }],
    }));
    expect(resG.status).toBe(200);
    expect((store.get("pedidos") as PedidoSalvo[])[0].total).toBe(53);
  });

  it("rejeita macarronada sem tamanho", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Carne", detail: "", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });

  it("rejeita macarronada com tamanho invalido", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Macarronada de Carne", detail: "Tamanho X", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });
  it("rejeita item que nao existe no cardapio oficial", async () => {
    const res = await POST(postReq({
      ...basePayload,
      itens: [{ kind: "simple", name: "Produto Fake", detail: "", price: 1, qty: 1 }],
    }));

    expect(res.status).toBe(400);
    expect(store.get("pedidos")).toBeUndefined();
  });
});
