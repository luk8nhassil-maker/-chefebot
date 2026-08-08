import { vi, describe, it, expect, beforeEach } from "vitest";
import { MENU } from "@/lib/menu";

// Endpoint dedicado da correção da regra comercial do Calzone: alterna
// `flavorsMode` ("pizza" reaproveita a Pizza | "own" usa calzoneFlavors)
// sem apagar nenhuma outra seção já persistida do cardápio (ver comentário
// no próprio route.ts sobre por que não reusa POST /api/cardapio com um
// corpo parcial `{ lanches }`).

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

import { POST } from "./route";
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

describe("POST /api/cardapio/calzone-flavors-mode", () => {
  it("sem token: 401, nunca grava", async () => {
    const res = await POST(postReq({ modo: "own" }));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("modo inválido: 400, nunca grava", async () => {
    const token = await tokenAdmin();
    const res = await POST(postReq({ modo: "outro-valor" }, token));
    expect(res.status).toBe(400);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("altera SÓ o flavorsMode do Calzone, preservando o resto do cardápio já persistido (sizes, sabores, bairros etc.)", async () => {
    const cardapioPersistidoAntes = {
      ...MENU,
      neighborhoods: [{ name: "Bairro Customizado", fee: 99 }],
    };
    store.set("cardapio", cardapioPersistidoAntes);

    const token = await tokenAdmin();
    const res = await POST(postReq({ modo: "own" }, token));
    expect(res.status).toBe(200);

    const cardapioGravado = store.get("cardapio") as typeof MENU;
    // A customização de bairro sobrevive — não foi apagada pela troca do modo.
    expect(cardapioGravado.neighborhoods).toEqual([{ name: "Bairro Customizado", fee: 99 }]);
    // Só o Calzone mudou; os demais lanches continuam intactos.
    const calzone = cardapioGravado.lanches.find((l) => l.name === "Calzone")!;
    expect(calzone.flavorsMode).toBe("own");
    const miniPizza = cardapioGravado.lanches.find((l) => l.name === "Mini-Pizza")!;
    expect(miniPizza.flavorsMode).toBe("own"); // inalterado
    expect(cardapioGravado.lanches.length).toBe(MENU.lanches.length);
  });

  it("cardápio genuinamente vazio (nunca customizado): parte do fallback estático MENU e grava o Calzone atualizado", async () => {
    const token = await tokenAdmin();
    const res = await POST(postReq({ modo: "own" }, token));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, modo: "own" });

    const cardapioGravado = store.get("cardapio") as typeof MENU;
    expect(cardapioGravado.lanches.find((l) => l.name === "Calzone")!.flavorsMode).toBe("own");
  });

  it("alternar de volta para 'pizza' funciona normalmente", async () => {
    store.set("cardapio", { ...MENU, lanches: MENU.lanches.map((l) => (l.name === "Calzone" ? { ...l, flavorsMode: "own" as const } : l)) });
    const token = await tokenAdmin();
    const res = await POST(postReq({ modo: "pizza" }, token));
    expect(res.status).toBe(200);
    const cardapioGravado = store.get("cardapio") as typeof MENU;
    expect(cardapioGravado.lanches.find((l) => l.name === "Calzone")!.flavorsMode).toBe("pizza");
  });
});
