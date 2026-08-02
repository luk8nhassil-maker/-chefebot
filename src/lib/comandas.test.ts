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

const CARDAPIO_TESTE = {
  sizes: [{ code: "P", label: "Pequena", price: 30 }, { code: "G", label: "Grande", price: 50 }],
  saltyFlavors: ["Quatro Queijos"],
  sweetFlavors: [],
  borders: [],
  bebidas: [{ name: "Refrigerante 2L", price: 12 }],
  sucos: [],
  neighborhoods: [],
};

import {
  abrirComanda,
  atualizarItensComanda,
  buscarComanda,
  fecharComanda,
  listarComandas,
  marcarComandaEnviada,
  validarItensComanda,
} from "./comandas";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
});

describe("abrirComanda", () => {
  it("cria uma comanda aberta, sem itens, com número sequencial", async () => {
    const c1 = await abrirComanda("5");
    const c2 = await abrirComanda("6", "Terraço");
    expect(c1.status).toBe("aberta");
    expect(c1.itens).toEqual([]);
    expect(c1.numero).toBe(1);
    expect(c2.numero).toBe(2);
    expect(c2.complemento).toBe("Terraço");
  });

  it("aparece na listagem", async () => {
    await abrirComanda("5");
    expect(await listarComandas()).toHaveLength(1);
  });
});

describe("validarItensComanda", () => {
  it("recusa lista vazia", async () => {
    const r = await validarItensComanda([]);
    expect(r.ok).toBe(false);
  });

  it("recusa item fora do cardápio", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Produto Fantasma", qty: 1 }]);
    expect(r.ok).toBe(false);
  });

  it("recusa item promocional", async () => {
    const r = await validarItensComanda([{ kind: "promo", name: "Refrigerante 2L", qty: 1, promoId: "x" }]);
    expect(r.ok).toBe(false);
  });

  it("recusa preço vindo do cliente — sempre recalcula pelo cardápio oficial", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 2, price: 0.01 }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.itens[0].price).toBe(12);
      expect(r.total).toBe(24);
    }
  });

  it("recusa quantidade inválida", async () => {
    const r = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 0 }]);
    expect(r.ok).toBe(false);
  });
});

describe("atualizarItensComanda", () => {
  it("atualiza itens, observação e complemento de uma comanda aberta", async () => {
    const c = await abrirComanda("5");
    const validacao = await validarItensComanda([{ kind: "simple", name: "Refrigerante 2L", qty: 1 }]);
    expect(validacao.ok).toBe(true);
    if (!validacao.ok) return;
    const atualizada = await atualizarItensComanda(c.id, validacao.itens, { observacao: "Sem gelo", complemento: "Varanda" });
    expect(atualizada).not.toBe("nao_encontrada");
    expect(atualizada).not.toBe("nao_esta_aberta");
    if (typeof atualizada === "object") {
      expect(atualizada.itens).toHaveLength(1);
      expect(atualizada.observacao).toBe("Sem gelo");
      expect(atualizada.complemento).toBe("Varanda");
    }
  });

  it("devolve nao_encontrada para id inexistente", async () => {
    const r = await atualizarItensComanda("comanda_inexistente", []);
    expect(r).toBe("nao_encontrada");
  });

  it("recusa atualizar uma comanda que não está mais aberta", async () => {
    const c = await abrirComanda("5");
    await marcarComandaEnviada(c.id, "ped_1", 10);
    const r = await atualizarItensComanda(c.id, []);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("marcarComandaEnviada", () => {
  it("marca como enviada e guarda o vínculo com o pedido", async () => {
    const c = await abrirComanda("5");
    const r = await marcarComandaEnviada(c.id, "ped_123", 42);
    expect(r).not.toBe("nao_encontrada");
    if (typeof r === "object") {
      expect(r.status).toBe("enviada");
      expect(r.pedidoId).toBe("ped_123");
      expect(r.pedidoNumero).toBe(42);
      expect(r.enviadaEm).toBeTruthy();
    }
  });

  it("recusa marcar como enviada uma comanda que já foi enviada", async () => {
    const c = await abrirComanda("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await marcarComandaEnviada(c.id, "ped_456", 43);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("fecharComanda", () => {
  it("recusa fechar uma comanda ainda aberta (sem pedido enviado)", async () => {
    const c = await abrirComanda("5");
    const r = await fecharComanda(c.id);
    expect(r).toBe("ainda_aberta");
  });

  it("fecha uma comanda já enviada", async () => {
    const c = await abrirComanda("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await fecharComanda(c.id);
    expect(r).not.toBe("nao_encontrada");
    if (typeof r === "object") {
      expect(r.status).toBe("fechada");
      expect(r.fechadaEm).toBeTruthy();
    }
  });

  it("recusa fechar uma comanda já fechada", async () => {
    const c = await abrirComanda("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    await fecharComanda(c.id);
    const r = await fecharComanda(c.id);
    expect(r).toBe("ja_fechada");
  });
});

describe("buscarComanda", () => {
  it("devolve null para id inexistente", async () => {
    expect(await buscarComanda("nao_existe")).toBeNull();
  });
});
