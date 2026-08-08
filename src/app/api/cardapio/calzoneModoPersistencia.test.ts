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

describe("REGRESSÃO (BLOQUEIO 2, auditoria independente pós-7ª rodada) — 'Salvar Cardápio' preserva calzoneFlavors/miniPizzaFlavors/payments customizados", () => {
  // A 7ª rodada corrigiu a tela Configurações para incluir `lanches` no
  // corpo de "Salvar Cardápio". A 8ª rodada corrige o mesmo problema para
  // calzoneFlavors/miniPizzaFlavors/payments: o tipo `Cardapio` em
  // src/app/configuracoes/page.tsx agora é um contrato explícito que também
  // carrega essas 3 seções (mesmo a tela não as editando diretamente), então
  // o corpo simulado aqui replica EXATAMENTE esse contrato — não o payload
  // menor (pré-correção) dos testes acima.
  function corpoSalvarCompleto(cardapioAtual: Record<string, unknown>, patch: Record<string, unknown> = {}) {
    return {
      saltyFlavors: cardapioAtual.saltyFlavors,
      sweetFlavors: cardapioAtual.sweetFlavors,
      bebidas: cardapioAtual.bebidas,
      sucos: cardapioAtual.sucos,
      neighborhoods: cardapioAtual.neighborhoods,
      sizes: cardapioAtual.sizes,
      borders: cardapioAtual.borders,
      calzoneFlavors: cardapioAtual.calzoneFlavors,
      miniPizzaFlavors: cardapioAtual.miniPizzaFlavors,
      payments: cardapioAtual.payments,
      lanches: cardapioAtual.lanches,
      ...patch,
    };
  }

  it("calzoneFlavors customizado + Calzone em own + editar bairro + Salvar Cardápio -> GET mantém flavorsMode, calzoneFlavors exato, e catálogo derivado dessa lista", async () => {
    const token = await tokenAdmin();

    // 1. Persiste um calzoneFlavors customizado (só 2 sabores, diferente do
    // MENU estático) via "Salvar Cardápio" — simula uma customização já
    // salva antes desta correção existir.
    const inicial = await (await GET()).json();
    const calzoneFlavorsCustomizado = ["Calabresa", "Frango Catupiry"];
    const resCustomiza = await postCardapio(
      postReq(corpoSalvarCompleto(inicial, { calzoneFlavors: calzoneFlavorsCustomizado }), token)
    );
    expect(resCustomiza.status).toBe(200);

    // 2. Coloca o Calzone em "own" pelo endpoint dedicado.
    const resModo = await postCalzoneModo(postReq({ modo: "own" }, token));
    expect(resModo.status).toBe(200);

    // 3. Simula a tela Configurações: carrega o cardápio atual e edita outro
    // dado (um bairro), reenviando o contrato completo — igual a
    // salvarCardapio em src/app/configuracoes/page.tsx.
    const antes = await (await GET()).json();
    expect(antes.calzoneFlavors).toEqual(calzoneFlavorsCustomizado);
    const resSalvar = await postCardapio(
      postReq(
        corpoSalvarCompleto(antes, { neighborhoods: [...antes.neighborhoods, { name: "Bairro Novo Calzone", fee: 9 }] }),
        token
      )
    );
    expect(resSalvar.status).toBe(200);

    // 4. GET depois: flavorsMode own, calzoneFlavors EXATO, catálogo
    // derivado dessa lista customizada (nada de MENU estático).
    const depois = await (await GET()).json();
    const calzone = depois.lanches.find((l: { name: string }) => l.name === "Calzone");
    expect(calzone.flavorsMode).toBe("own");
    expect(depois.calzoneFlavors).toEqual(calzoneFlavorsCustomizado);
    expect(depois.neighborhoods).toContainEqual({ name: "Bairro Novo Calzone", fee: 9 });

    const calzoneNoCatalogo = depois.catalog.lanches.find((l: { name: string }) => l.name === "Calzone");
    expect(calzoneNoCatalogo.strategy).toBe("single_flavor");
    const nomesNoCatalogo = calzoneNoCatalogo.flavors.map((f: { name: string }) => f.name).sort();
    expect(nomesNoCatalogo).toEqual([...calzoneFlavorsCustomizado].sort());
  });

  it("miniPizzaFlavors customizado sobrevive a Salvar Cardápio (editar outro dado)", async () => {
    const token = await tokenAdmin();
    const inicial = await (await GET()).json();
    const miniPizzaFlavorsCustomizado = ["Napolitana", "Peruana"];
    const resCustomiza = await postCardapio(
      postReq(corpoSalvarCompleto(inicial, { miniPizzaFlavors: miniPizzaFlavorsCustomizado }), token)
    );
    expect(resCustomiza.status).toBe(200);

    const antes = await (await GET()).json();
    expect(antes.miniPizzaFlavors).toEqual(miniPizzaFlavorsCustomizado);
    const resSalvar = await postCardapio(
      postReq(corpoSalvarCompleto(antes, { sweetFlavors: [...antes.sweetFlavors, "Sabor Doce Novo De Teste"] }), token)
    );
    expect(resSalvar.status).toBe(200);

    const depois = await (await GET()).json();
    expect(depois.miniPizzaFlavors).toEqual(miniPizzaFlavorsCustomizado);
    expect(depois.sweetFlavors).toContain("Sabor Doce Novo De Teste");
    const miniPizzaNoCatalogo = depois.catalog.lanches.find((l: { name: string }) => l.name === "Mini-Pizza");
    const nomesNoCatalogo = miniPizzaNoCatalogo.flavors.map((f: { name: string }) => f.name).sort();
    expect(nomesNoCatalogo).toEqual([...miniPizzaFlavorsCustomizado].sort());
  });

  it("payments customizado sobrevive a Salvar Cardápio (editar outro dado)", async () => {
    const token = await tokenAdmin();
    const inicial = await (await GET()).json();
    const paymentsCustomizado = ["Pix", "Dinheiro"];
    const resCustomiza = await postCardapio(
      postReq(corpoSalvarCompleto(inicial, { payments: paymentsCustomizado }), token)
    );
    expect(resCustomiza.status).toBe(200);

    const antes = await (await GET()).json();
    expect(antes.payments).toEqual(paymentsCustomizado);
    const resSalvar = await postCardapio(
      postReq(corpoSalvarCompleto(antes, { borders: [...antes.borders, { label: "Borda Nova De Teste", priceSmall: 5, priceLarge: 8 }] }), token)
    );
    expect(resSalvar.status).toBe(200);

    const depois = await (await GET()).json();
    expect(depois.payments).toEqual(paymentsCustomizado);
    expect(depois.borders).toContainEqual({ label: "Borda Nova De Teste", priceSmall: 5, priceLarge: 8 });
  });
});

describe("MENU real (linha de base)", () => {
  it("Calzone e Mini-Pizza continuam com flavorsMode explícito no cardápio-base", () => {
    expect(MENU.lanches.find((l) => l.name === "Calzone")!.flavorsMode).toBe("pizza");
    expect(MENU.lanches.find((l) => l.name === "Mini-Pizza")!.flavorsMode).toBe("own");
  });
});
