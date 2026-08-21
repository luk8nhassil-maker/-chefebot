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

describe("GET /api/cardapio — Sucos do Salão", () => {
  it("origem /salao sem sessão válida continua recebendo só o catálogo público", async () => {
    const data = await (await GET(req("http://localhost/salao"))).json();

    expect(data.catalog.sucos).toHaveLength(11);
    expect(data.catalog.sucos.some((p: { id: string }) => p.id.startsWith("salao-suco-"))).toBe(false);
    expect(data.catalog.sucos.find((p: { id: string }) => p.id === "suco-acerola")?.priceCents).toBe(700);
  });

  it("sessão válida + /salao recebe os 11 sucos de Copo oficiais e os 11 sabores de Jarra", async () => {
    sessao.ativa = true;
    const data = await (await GET(req("http://localhost/salao"))).json();

    const copos = data.catalog.sucos.filter((p: { id: string }) => p.id.startsWith("suco-"));
    const jarras = data.catalog.sucos.filter((p: { id: string }) => p.id.startsWith("salao-suco-"));

    expect(copos).toHaveLength(11);
    expect(jarras).toHaveLength(11);
    expect(copos.find((p: { id: string }) => p.id === "suco-acerola")).toMatchObject({
      name: "Acerola",
      strategy: "milk",
      priceCents: 700,
    });

    // IDs/tamanhos publicados anteriormente permanecem estáveis para não
    // quebrar comandas abertas. A fachada do Salão interpreta estes dois
    // sizeIds como Jarra P e Jarra G, respectivamente.
    expect(jarras.find((p: { id: string }) => p.id === "salao-suco-maracuja")?.sizes).toEqual([
      { id: "salao-suco-maracuja-copo", code: "Copo", priceCents: 2000 },
      { id: "salao-suco-maracuja-jarra", code: "Jarra", priceCents: 4000 },
    ]);
  });

  it("mesmo com sessão do Salão ativa, /cardapio continua sem revelar Jarra", async () => {
    sessao.ativa = true;
    const data = await (await GET(req("http://localhost/cardapio"))).json();

    expect(data.catalog.sucos).toHaveLength(11);
    expect(data.catalog.sucos.some((p: { id: string }) => p.id.startsWith("salao-suco-"))).toBe(false);
    expect(data.catalog.sucos.find((p: { id: string }) => p.id === "suco-maracuja")?.priceCents).toBe(1000);
  });

  it("?scope=salao sem sessão válida não revela os produtos de Jarra", async () => {
    const data = await (await GET(req("http://localhost/cardapio", "salao"))).json();

    expect(data.catalog.sucos.some((p: { id: string }) => p.id.startsWith("salao-suco-"))).toBe(false);
  });
});
