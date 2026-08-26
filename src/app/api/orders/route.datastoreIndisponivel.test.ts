// Reprodução do incidente de /pedidos preso em "Carregando...".
//
// O painel só termina o loading quando GET /api/orders devolve um array. Com
// o datastore fora, a rota lançava e o Next devolvia um 500 SEM CORPO — que o
// painel engolia. Este teste fixa o novo contrato do backend: falha de leitura
// vira uma resposta JSON legível e classificada, nunca uma exceção crua.

import { beforeEach, describe, expect, test, vi } from "vitest";

const { redisMock, definirFalhaDeLeitura } = vi.hoisted(() => {
  let falha: Error | null = null;
  const redisMock = {
    get: vi.fn(async () => {
      if (falha) throw falha;
      return [];
    }),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    eval: vi.fn(async () => 0),
    expire: vi.fn(async () => 1),
  };
  return { redisMock, definirFalhaDeLeitura: (e: Error | null) => { falha = e } };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/auth")>()),
  verifyToken: vi.fn(async () => ({ username: "kellyne", name: "Kellyne", role: "admin" })),
}));

import { GET } from "./route";

function requisicaoDoPainel(comCookie = true) {
  return {
    url: "https://chefedapizza.com.br/api/orders",
    cookies: { get: (nome: string) => (comCookie && nome === "auth-token" ? { value: "token-de-teste" } : undefined) },
  } as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  definirFalhaDeLeitura(null);
  vi.clearAllMocks();
});

describe("GET /api/orders — datastore indisponível", () => {
  const falhas: Array<[string, Error]> = [
    ["cota estourada", new Error("ERR max requests limit exceeded")],
    ["credencial recusada", new Error("Unauthorized")],
    ["conta suspensa por cobrança", new Error("database disabled due to billing")],
    ["rede fora", new Error("fetch failed")],
    ["erro não catalogado", new Error("algo inesperado")],
  ];

  for (const [nome, erro] of falhas) {
    test(`${nome}: a rota NÃO lança — devolve resposta HTTP`, async () => {
      definirFalhaDeLeitura(erro);
      await expect(GET(requisicaoDoPainel())).resolves.toBeDefined();
    });

    test(`${nome}: responde 503 com corpo JSON classificado, nunca 500 vazio`, async () => {
      definirFalhaDeLeitura(erro);
      const resposta = await GET(requisicaoDoPainel());
      expect(resposta.status).toBe(503);
      const corpo = await resposta.json();
      expect(corpo.code).toBe("DATASTORE_INDISPONIVEL");
      expect(typeof corpo.classe).toBe("string");
      expect(corpo.classe.length).toBeGreaterThan(0);
    });

    test(`${nome}: NUNCA devolve uma lista vazia disfarçada de sucesso`, async () => {
      definirFalhaDeLeitura(erro);
      const resposta = await GET(requisicaoDoPainel());
      const corpo = await resposta.json();
      expect(Array.isArray(corpo)).toBe(false);
      expect(resposta.ok).toBe(false);
    });
  }

  test("o corpo do erro não carrega credencial nem endpoint do datastore", async () => {
    definirFalhaDeLeitura(new Error("Unauthorized for https://x-12345.upstash.io token AXbcDEFghiJKLmnoPQRstuVWXyz1234567890"));
    const resposta = await GET(requisicaoDoPainel());
    const texto = JSON.stringify(await resposta.json());
    expect(texto).not.toContain("upstash.io");
    expect(texto).not.toContain("AXbcDEFghiJKLmnoPQRstuVWXyz1234567890");
  });

  test("sem cookie continua sendo 401 — autenticação antes de qualquer leitura", async () => {
    definirFalhaDeLeitura(new Error("Unauthorized"));
    const resposta = await GET(requisicaoDoPainel(false));
    expect(resposta.status).toBe(401);
    expect(redisMock.get).not.toHaveBeenCalled();
  });
});

describe("GET /api/orders — caminho saudável preservado", () => {
  test("datastore respondendo devolve a lista (array) com 200", async () => {
    const resposta = await GET(requisicaoDoPainel());
    expect(resposta.status).toBe(200);
    expect(Array.isArray(await resposta.json())).toBe(true);
  });

  test("lista realmente vazia continua sendo 200 com [] — 'nenhum pedido' é legítimo", async () => {
    redisMock.get.mockImplementationOnce(async () => null);
    const resposta = await GET(requisicaoDoPainel());
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
  });
});
