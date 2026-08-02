import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
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
  type Comanda,
} from "./comandas";

async function abrirComandaOk(mesa: string, complemento?: string): Promise<Comanda> {
  const r = await abrirComanda(mesa, complemento);
  if (typeof r !== "object") throw new Error(`esperava Comanda, recebeu "${r}"`);
  return r;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  store.set("cardapio", CARDAPIO_TESTE);
});

describe("abrirComanda", () => {
  it("cria uma comanda aberta, sem itens, com número sequencial", async () => {
    const c1 = await abrirComanda("5");
    const c2 = await abrirComanda("6", "Terraço");
    if (typeof c1 !== "object" || typeof c2 !== "object") throw new Error("esperava Comanda");
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

  it("recusa abrir uma segunda comanda para a mesma mesa ainda não fechada", async () => {
    const c1 = await abrirComanda("7");
    if (typeof c1 !== "object") throw new Error("esperava Comanda");
    const r2 = await abrirComanda("7");
    expect(r2).toBe("mesa_ocupada");
    expect(await listarComandas()).toHaveLength(1);
  });

  it("permite reabrir a mesma mesa depois que a comanda anterior foi fechada", async () => {
    const c1 = await abrirComanda("7");
    if (typeof c1 !== "object") throw new Error("esperava Comanda");
    await marcarComandaEnviada(c1.id, "ped_1", 1);
    await fecharComanda(c1.id);
    const r2 = await abrirComanda("7");
    expect(typeof r2).toBe("object");
    expect(await listarComandas()).toHaveLength(2);
  });

  it("duas aberturas concorrentes da mesma mesa — só uma vira comanda, a outra é recusada", async () => {
    const [a, b] = await Promise.all([abrirComanda("9"), abrirComanda("9")]);
    const resultados = [a, b];
    expect(resultados.filter((r) => typeof r === "object")).toHaveLength(1);
    expect(resultados.filter((r) => r === "mesa_ocupada")).toHaveLength(1);
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
    const c = await abrirComandaOk("5");
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
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_1", 10);
    const r = await atualizarItensComanda(c.id, []);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("marcarComandaEnviada", () => {
  it("marca como enviada e guarda o vínculo com o pedido", async () => {
    const c = await abrirComandaOk("5");
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
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await marcarComandaEnviada(c.id, "ped_456", 43);
    expect(r).toBe("nao_esta_aberta");
  });
});

describe("fecharComanda", () => {
  it("recusa fechar uma comanda ainda aberta (sem pedido enviado)", async () => {
    const c = await abrirComandaOk("5");
    const r = await fecharComanda(c.id);
    expect(r).toBe("ainda_aberta");
  });

  it("fecha uma comanda já enviada", async () => {
    const c = await abrirComandaOk("5");
    await marcarComandaEnviada(c.id, "ped_123", 42);
    const r = await fecharComanda(c.id);
    expect(r).not.toBe("nao_encontrada");
    if (typeof r === "object") {
      expect(r.status).toBe("fechada");
      expect(r.fechadaEm).toBeTruthy();
    }
  });

  it("recusa fechar uma comanda já fechada", async () => {
    const c = await abrirComandaOk("5");
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
