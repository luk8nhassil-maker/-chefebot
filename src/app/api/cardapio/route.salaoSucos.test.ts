import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock, sessao } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  const sessao = { ativa: false };
  return { store, redisMock, sessao };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/salaoAuth", () => ({
  lerSessaoSalao: vi.fn(async () => (sessao.ativa ? { usuario: "terminal-salao" } : null)),
}));

import { GET } from "./route";

function req(referer: string, scope?: "salao") {
  const url = new URL("http://localhost/api/cardapio");
  if (scope) url.searchParams.set("scope", scope);
  return new NextRequest(url, { headers: { referer } });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  sessao.ativa = false;
});

describe("GET /api/cardapio — isolamento dos sucos do Salão", () => {
  it("requisição originada no Salão SEM sessão válida continua recebendo catálogo público", async () => {
    const data = await (await GET(req("http://localhost/salao"))).json();

    expect(data.catalog.sucos).toHaveLength(11);
    expect(data.catalog.sucos.some((p: { id: string }) => p.id.startsWith("salao-suco-"))).toBe(false);
    expect(data.catalog.sucos.find((p: { name: string }) => p.name === "Maracujá")?.strategy).toBe("milk");
  });

  it("sessão válida + origem /salao recebe somente os 11 sucos Copo/Jarra", async () => {
    sessao.ativa = true;
    const data = await (await GET(req("http://localhost/salao"))).json();

    expect(data.catalog.sucos).toHaveLength(11);
    expect(data.catalog.sucos.every((p: { id: string }) => p.id.startsWith("salao-suco-"))).toBe(true);
    expect(data.catalog.sucos.some((p: { id: string }) => p.id === "suco-maracuja")).toBe(false);

    const maracuja = data.catalog.sucos.find((p: { id: string }) => p.id === "salao-suco-maracuja");
    expect(maracuja?.strategy).toBe("size");
    expect(maracuja?.sizes).toEqual([
      { id: "salao-suco-maracuja-copo", code: "Copo", priceCents: 2000 },
      { id: "salao-suco-maracuja-jarra", code: "Jarra", priceCents: 4000 },
    ]);
  });

  it("mesmo com sessão do Salão ativa, abrir o link público /cardapio continua recebendo apenas os sucos públicos", async () => {
    sessao.ativa = true;
    const data = await (await GET(req("http://localhost/cardapio"))).json();

    expect(data.catalog.sucos).toHaveLength(11);
    expect(data.catalog.sucos.some((p: { id: string }) => p.id.startsWith("salao-suco-"))).toBe(false);
    expect(data.catalog.sucos.find((p: { name: string }) => p.name === "Maracujá")?.priceCents).toBe(1000);
  });

  it("?scope=salao sem sessão válida não revela os produtos exclusivos", async () => {
    const data = await (await GET(req("http://localhost/cardapio", "salao"))).json();

    expect(data.catalog.sucos.some((p: { id: string }) => p.id.startsWith("salao-suco-"))).toBe(false);
  });
});
