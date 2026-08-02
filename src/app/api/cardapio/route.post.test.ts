import { vi, describe, it, expect, beforeEach } from "vitest";
import { MENU } from "@/lib/menu";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cardapio precisa validar a ESTRUTURA do payload antes de gravar no
// Redis. Foi a ausência dessa validação que permitiu dois registros idênticos
// {"name":"Teste","price":1} entrarem em produção — sem checagem de nome
// vazio, preço inválido ou item duplicado — e corromperem o seletor do Novo
// pedido (ver src/lib/montagemManual.ts). A validação nunca bloqueia por
// nome: um item chamado "Teste" com preço válido e sem duplicar é aceito.
// ─────────────────────────────────────────────────────────────────────────────

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    lpush: vi.fn(async (key: string, value: unknown) => {
      const lista = (store.get(key) as unknown[]) ?? [];
      lista.unshift(value);
      store.set(key, lista);
      return lista.length;
    }),
    ltrim: vi.fn(async () => "OK"),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { POST, validarCardapio } from "./route";
import { createToken } from "@/lib/auth";

function postReq(body: unknown, token?: string) {
  return {
    cookies: { get: (name: string) => (name === "auth-token" && token ? { value: token } : undefined) },
    json: async () => body,
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

async function tokenAdmin() {
  return createToken({ username: "brito", name: "Brito", role: "admin" });
}

describe("validarCardapio — validação estrutural pura", () => {
  it("aceita o cardápio base legítimo (MENU) sem alterações", () => {
    const resultado = validarCardapio(MENU);
    expect(resultado.ok).toBe(true);
  });

  it("rejeita corpo que não é objeto", () => {
    expect(validarCardapio(null).ok).toBe(false);
    expect(validarCardapio([1, 2, 3]).ok).toBe(false);
    expect(validarCardapio("string").ok).toBe(false);
  });

  it("rejeita campo desconhecido no payload", () => {
    const resultado = validarCardapio({ ...MENU, campoInventado: [] });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita preço inválido (negativo, zero, NaN, infinito, string)", () => {
    for (const price of [-1, 0, NaN, Infinity, "10" as unknown]) {
      const resultado = validarCardapio({ ...MENU, bebidas: [{ name: "Suco", price }] });
      expect(resultado.ok).toBe(false);
    }
  });

  it("rejeita nome vazio", () => {
    const resultado = validarCardapio({ ...MENU, bebidas: [{ name: "", price: 5 }] });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita nome só com espaços", () => {
    const resultado = validarCardapio({ ...MENU, bebidas: [{ name: "   ", price: 5 }] });
    expect(resultado.ok).toBe(false);
  });

  it("rejeita item duplicado exato (mesmo nome, mesmo preço) na mesma seção", () => {
    const resultado = validarCardapio({
      ...MENU,
      bebidas: [...MENU.bebidas, { name: "Teste", price: 1 }, { name: "Teste", price: 1 }],
    });
    expect(resultado.ok).toBe(false);
  });

  it("aceita um item legítimo chamado 'Teste' com preço válido e sem duplicar — nunca bloqueia por nome", () => {
    const resultado = validarCardapio({ ...MENU, bebidas: [...MENU.bebidas, { name: "Teste", price: 4.5 }] });
    expect(resultado.ok).toBe(true);
  });

  it("mesmo nome com preços diferentes não é duplicata (produtos distintos legítimos)", () => {
    const resultado = validarCardapio({
      ...MENU,
      bebidas: [...MENU.bebidas, { name: "Suco Especial", price: 5 }, { name: "Suco Especial", price: 7 }],
    });
    expect(resultado.ok).toBe(true);
  });

  it("rejeita lista com mais itens que o limite plausível por seção", () => {
    const bebidas = Array.from({ length: 501 }, (_, i) => ({ name: `Item ${i}`, price: 1 + i }));
    const resultado = validarCardapio({ ...MENU, bebidas });
    expect(resultado.ok).toBe(false);
  });

  it("aceita lanches com sub-tamanhos válidos (ex.: Macarronada)", () => {
    const resultado = validarCardapio(MENU);
    expect(resultado.ok).toBe(true);
  });

  it("rejeita lanche com sub-tamanho de preço inválido", () => {
    const resultado = validarCardapio({
      ...MENU,
      lanches: [{ name: "Macarronada", price: 0, hasFlavors: false, flavorsKey: "", sizes: [{ code: "P", price: -5 }] }],
    });
    expect(resultado.ok).toBe(false);
  });
});

describe("POST /api/cardapio — rejeita payload inválido antes de gravar", () => {
  it("payload com preço inválido retorna 400 e não grava no Redis", async () => {
    const token = await tokenAdmin();
    const res = await POST(postReq({ ...MENU, bebidas: [{ name: "Suco", price: -1 }] }, token));
    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("payload com nome vazio retorna 400 e não grava no Redis", async () => {
    const token = await tokenAdmin();
    const res = await POST(postReq({ ...MENU, bebidas: [{ name: "", price: 5 }] }, token));
    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("payload com duplicata exata retorna 400 e não grava no Redis", async () => {
    const token = await tokenAdmin();
    const res = await POST(
      postReq({ ...MENU, bebidas: [...MENU.bebidas, { name: "Teste", price: 1 }, { name: "Teste", price: 1 }] }, token),
    );
    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("um único item duplicado simulando duplo-clique nunca é persistido", async () => {
    const token = await tokenAdmin();
    const res = await POST(
      postReq({ ...MENU, bebidas: [...MENU.bebidas, { name: "Refrigerante Novo", price: 8 }, { name: "Refrigerante Novo", price: 8 }] }, token),
    );
    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("cardápio legítimo continua sendo aceito normalmente (200)", async () => {
    const token = await tokenAdmin();
    const res = await POST(postReq(MENU, token));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(redisMock.set).toHaveBeenCalledWith("cardapio", MENU);
  });

  it("sem token retorna 401 e não grava no Redis", async () => {
    const res = await POST(postReq(MENU));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

describe("POST /api/cardapio — auditoria administrativa", () => {
  it("grava uma entrada de auditoria após uma atualização válida", async () => {
    const token = await tokenAdmin();
    const res = await POST(postReq(MENU, token));
    expect(res.status).toBe(200);
    expect(redisMock.lpush).toHaveBeenCalledTimes(1);
    const [chave, entradaSerializada] = redisMock.lpush.mock.calls[0];
    expect(chave).toBe("cardapioAuditoria");
    const entrada = JSON.parse(entradaSerializada as string);
    expect(entrada.admin).toBe("brito");
    expect(entrada.acao).toBe("atualizacao_cardapio");
    expect(typeof entrada.data).toBe("string");
    expect(Array.isArray(entrada.secoes)).toBe(true);
    // nunca deve logar token/sessão
    expect(JSON.stringify(entrada)).not.toContain(token);
  });

  it("não grava auditoria quando a validação rejeita o payload", async () => {
    const token = await tokenAdmin();
    await POST(postReq({ ...MENU, bebidas: [{ name: "", price: 5 }] }, token));
    expect(redisMock.lpush).not.toHaveBeenCalled();
  });
});
