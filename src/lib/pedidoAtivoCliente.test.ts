import { describe, test, expect } from "vitest";
import {
  lerPedidoAtivoId,
  tabAtivaCardapio,
  consumirFlagAbrirSacola,
  CF_OPEN_CART_KEY,
  type StorageLike,
} from "./pedidoAtivoCliente";

describe("lerPedidoAtivoId — TTL de 3h do pedido ativo (aba Pedido do menu inferior)", () => {
  test("null/ausente -> null", () => {
    expect(lerPedidoAtivoId(null)).toBeNull();
    expect(lerPedidoAtivoId("")).toBeNull();
  });

  test("dentro das 3h -> retorna o id como string", () => {
    const agora = 1_000_000_000_000;
    const raw = JSON.stringify({ id: "abc123", ts: agora - 60_000 });
    expect(lerPedidoAtivoId(raw, agora)).toBe("abc123");
  });

  test("id numérico -> convertido para string", () => {
    const agora = 1_000_000_000_000;
    const raw = JSON.stringify({ id: 42, ts: agora });
    expect(lerPedidoAtivoId(raw, agora)).toBe("42");
  });

  test("exatamente no limite de 3h -> ainda válido", () => {
    const agora = 1_000_000_000_000;
    const raw = JSON.stringify({ id: "x", ts: agora - 3 * 60 * 60 * 1000 });
    expect(lerPedidoAtivoId(raw, agora)).toBe("x");
  });

  test("passou de 3h -> null (expirado)", () => {
    const agora = 1_000_000_000_000;
    const raw = JSON.stringify({ id: "x", ts: agora - 3 * 60 * 60 * 1000 - 1 });
    expect(lerPedidoAtivoId(raw, agora)).toBeNull();
  });

  test("sem id -> null", () => {
    expect(lerPedidoAtivoId(JSON.stringify({ ts: Date.now() }))).toBeNull();
  });

  test("ts ausente ou não numérico -> null", () => {
    expect(lerPedidoAtivoId(JSON.stringify({ id: "x" }))).toBeNull();
    expect(lerPedidoAtivoId(JSON.stringify({ id: "x", ts: "ontem" }))).toBeNull();
  });

  test("JSON inválido -> null, nunca lança", () => {
    expect(lerPedidoAtivoId("{isso não é json")).toBeNull();
  });
});

describe("tabAtivaCardapio — mapeia a tela do cardápio público para a aba ativa", () => {
  test("sc-start -> inicio", () => {
    expect(tabAtivaCardapio("sc-start")).toBe("inicio");
  });
  test("sc-cart -> sacola", () => {
    expect(tabAtivaCardapio("sc-cart")).toBe("sacola");
  });
  test("sc-done -> pedido", () => {
    expect(tabAtivaCardapio("sc-done")).toBe("pedido");
  });
  test("qualquer outra tela (ex.: sc-list) -> nenhuma aba destacada", () => {
    expect(tabAtivaCardapio("sc-list")).toBeNull();
    expect(tabAtivaCardapio("sc-delivery")).toBeNull();
    expect(tabAtivaCardapio("sc-pay")).toBeNull();
  });
});

// Storage falso em memória — evita depender de sessionStorage real (sem DOM).
function storageFalso(inicial: Record<string, string> = {}): StorageLike {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k)! : null),
    removeItem: (k) => { dados.delete(k); },
  };
}

describe("consumirFlagAbrirSacola — sinal entre /cliente|/rastrear e /pedido para abrir a sacola", () => {
  test("sem flag -> false, nada é removido", () => {
    const storage = storageFalso();
    expect(consumirFlagAbrirSacola(storage)).toBe(false);
  });

  test("com flag -> true, e a flag é consumida (não repete na próxima leitura)", () => {
    const storage = storageFalso({ [CF_OPEN_CART_KEY]: "1" });
    expect(consumirFlagAbrirSacola(storage)).toBe(true);
    expect(consumirFlagAbrirSacola(storage)).toBe(false);
  });

  test("nunca lança mesmo se o storage falhar", () => {
    const storage: StorageLike = {
      getItem: () => { throw new Error("boom"); },
      removeItem: () => {},
    };
    expect(consumirFlagAbrirSacola(storage)).toBe(false);
  });
});
