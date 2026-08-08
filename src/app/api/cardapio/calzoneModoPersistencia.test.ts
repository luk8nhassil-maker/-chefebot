import { vi, describe, it, expect, beforeEach } from "vitest";
import { MENU } from "@/lib/menu";

// Integração server-side do BLOQUEIO 2 (auditoria independente pós-6ª
// rodada): "Salvar Cardápio" (POST /api/cardapio, corpo completo vindo de
// Configurações) não pode apagar o flavorsMode do Calzone que foi definido
// pelo endpoint dedicado (POST /api/cardapio/calzone-flavors-mode). A causa
// raiz era o cliente não incluir `lanches` no corpo de "Salvar Cardápio" —
// corrigida em src/app/configuracoes/page.tsx (salvarCardapio agora envia
// `{ ...cardapio, lanches }`). Este teste simula a MESMA sequência via as
// rotas reais, sem depender do componente React.

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

import { GET, POST as postCardapio } from "./route";
import { POST as postCalzoneModo } from "./calzone-flavors-mode/route";
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

describe("REGRESSÃO (BLOQUEIO 2) — 'Salvar Cardápio' preserva flavorsMode do Calzone definido pelo endpoint dedicado", () => {
  it("own -> editar outro dado do cardápio -> Salvar Cardápio -> GET continua own", async () => {
    const token = await tokenAdmin();

    // 1. Define Calzone como "own".
    const resModo = await postCalzoneModo(postReq({ modo: "own" }, token));
    expect(resModo.status).toBe(200);

    // 2. Simula a tela Configurações: carrega o cardápio atual (mesmo
    // formato que o cliente recebe de GET /api/cardapio), altera um bairro,
    // e reenvia — igual a salvarCardapio em src/app/configuracoes/page.tsx.
    const antes = await (await GET()).json();
    const corpoSalvar = {
      saltyFlavors: antes.saltyFlavors,
      sweetFlavors: antes.sweetFlavors,
      bebidas: antes.bebidas,
      sucos: antes.sucos,
      neighborhoods: [...antes.neighborhoods, { name: "Bairro Novo", fee: 12 }],
      sizes: antes.sizes,
      borders: antes.borders,
      lanches: antes.lanches,
    };

    // 3. Clica "Salvar Cardápio".
    const resSalvar = await postCardapio(postReq(corpoSalvar, token));
    expect(resSalvar.status).toBe(200);

    // 4. "Recarrega" — GET de novo.
    const depois = await (await GET()).json();
    // 5. Calzone DEVE continuar "own".
    const calzone = depois.lanches.find((l: { name: string }) => l.name === "Calzone");
    expect(calzone.flavorsMode).toBe("own");
    // A edição de bairro também sobreviveu.
    expect(depois.neighborhoods).toContainEqual({ name: "Bairro Novo", fee: 12 });
    // Mini-Pizza permanece own (inalterado).
    const miniPizza = depois.lanches.find((l: { name: string }) => l.name === "Mini-Pizza");
    expect(miniPizza.flavorsMode).toBe("own");
  });

  it("alternar de volta para pizza -> editar outro dado -> Salvar Cardápio -> GET continua pizza", async () => {
    const token = await tokenAdmin();

    await postCalzoneModo(postReq({ modo: "own" }, token));
    await postCalzoneModo(postReq({ modo: "pizza" }, token));

    const antes = await (await GET()).json();
    const corpoSalvar = {
      saltyFlavors: [...antes.saltyFlavors, "Sabor Novo De Teste"],
      sweetFlavors: antes.sweetFlavors,
      bebidas: antes.bebidas,
      sucos: antes.sucos,
      neighborhoods: antes.neighborhoods,
      sizes: antes.sizes,
      borders: antes.borders,
      lanches: antes.lanches,
    };
    const resSalvar = await postCardapio(postReq(corpoSalvar, token));
    expect(resSalvar.status).toBe(200);

    const depois = await (await GET()).json();
    const calzone = depois.lanches.find((l: { name: string }) => l.name === "Calzone");
    expect(calzone.flavorsMode).toBe("pizza");
    expect(depois.saltyFlavors).toContain("Sabor Novo De Teste");
  });

  it("cardápio legado válido (nunca usou o endpoint dedicado) continua compatível: Salvar Cardápio sem flavorsMode mantém Calzone em modo pizza (padrão)", async () => {
    const token = await tokenAdmin();
    const antes = await (await GET()).json();
    const corpoSalvar = {
      saltyFlavors: antes.saltyFlavors,
      sweetFlavors: antes.sweetFlavors,
      bebidas: antes.bebidas,
      sucos: antes.sucos,
      neighborhoods: antes.neighborhoods,
      sizes: antes.sizes,
      borders: antes.borders,
      lanches: antes.lanches,
    };
    const resSalvar = await postCardapio(postReq(corpoSalvar, token));
    expect(resSalvar.status).toBe(200);

    const depois = await (await GET()).json();
    const calzone = depois.lanches.find((l: { name: string }) => l.name === "Calzone");
    expect(calzone.flavorsMode).toBe("pizza");
    const calzoneNoCatalogo = depois.catalog.lanches.find((l: { name: string }) => l.name === "Calzone");
    expect(calzoneNoCatalogo.strategy).toBe("single_flavor");
  });
});

describe("MENU real (linha de base)", () => {
  it("Calzone e Mini-Pizza continuam com flavorsMode explícito no cardápio-base", () => {
    expect(MENU.lanches.find((l) => l.name === "Calzone")!.flavorsMode).toBe("pizza");
    expect(MENU.lanches.find((l) => l.name === "Mini-Pizza")!.flavorsMode).toBe("own");
  });
});
