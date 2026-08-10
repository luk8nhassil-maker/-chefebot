import { vi, describe, it, expect, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Garante que o PATCH /api/cardapio (marcar esgotado/disponível) exige login
// com role admin/atendente/dev, enquanto o GET continua público.
// ─────────────────────────────────────────────────────────────────────────────

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import { GET, PATCH } from "./route";
import { createToken } from "@/lib/auth";

// Monta um request fake com cookie opcional e body JSON.
function patchReq(body: unknown, token?: string) {
  return {
    cookies: { get: (name: string) => (name === "auth-token" && token ? { value: token } : undefined) },
    json: async () => body,
  } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("PATCH /api/cardapio — autorização", () => {
  it("sem token retorna 401 e não grava no Redis", async () => {
    const res = await PATCH(patchReq({ nome: "Calabresa", esgotado: true }));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("token com role inválida retorna 401", async () => {
    const token = await createToken({ username: "joao", name: "Joao", role: "entregador" as never });
    const res = await PATCH(patchReq({ nome: "Calabresa", esgotado: true }, token));
    expect(res.status).toBe(401);
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("token de admin marca produto como esgotado (200)", async () => {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    const res = await PATCH(patchReq({ nome: "Calabresa", esgotado: true }, token));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.esgotados).toContain("Calabresa");
    expect(store.get("esgotados")).toContain("Calabresa");
  });

  it("token de atendente também é autorizado", async () => {
    const token = await createToken({ username: "kellyne", name: "Kellyne", role: "atendente" });
    const res = await PATCH(patchReq({ nome: "Bacon", esgotado: true }, token));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/cardapio — público", () => {
  it("retorna 200 sem nenhuma autenticação", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    // menu base sempre presente + listas de esgotados
    expect(Array.isArray(data.saltyFlavors)).toBe(true);
    expect(Array.isArray(data.esgotados)).toBe(true);
  });
});

describe("Esgotado reflete no cardápio público (GET) após PATCH", () => {
  async function marcar(nome: string, esgotado: boolean) {
    const token = await createToken({ username: "brito", name: "Brito", role: "admin" });
    const res = await PATCH(patchReq({ nome, esgotado }, token));
    expect(res.status).toBe(200);
  }

  it("ao marcar um sabor como esgotado, o GET público passa a listá-lo em esgotados", async () => {
    await marcar("Calabresa", true);
    const data = await (await GET()).json();
    expect(data.esgotados).toContain("Calabresa");
    // o sabor continua no cardápio base; o cliente o trata como bloqueado via lista de esgotados
    expect(data.saltyFlavors).toContain("Calabresa");
  });

  it("ao desmarcar (disponível), o GET público remove o item de esgotados", async () => {
    await marcar("Calabresa", true);
    expect((await (await GET()).json()).esgotados).toContain("Calabresa");
    await marcar("Calabresa", false);
    expect((await (await GET()).json()).esgotados).not.toContain("Calabresa");
  });

  it("uma borda marcada como esgotada também aparece em esgotados", async () => {
    await marcar("Catupiry", true);
    const data = await (await GET()).json();
    expect(data.esgotados).toContain("Catupiry");
  });

  it("GET expõe o catálogo oficial de pizzas (Fase 2), com sabor esgotado refletido em tempo real", async () => {
    const antes = await (await GET()).json();
    const calabresaAntes = antes.pizzaCatalog.flavors.find((f: { name: string }) => f.name === "Calabresa");
    expect(calabresaAntes.available).toBe(true);

    await marcar("Calabresa", true);
    const depois = await (await GET()).json();
    const calabresaDepois = depois.pizzaCatalog.flavors.find((f: { name: string }) => f.name === "Calabresa");
    expect(calabresaDepois.available).toBe(false);
  });

  it("GET expõe o catálogo oficial dos demais produtos configuráveis (cardápio 2026) com IDs estáveis para Calzone/Macarronada", async () => {
    const data = await (await GET()).json();
    expect(data.catalog).toBeDefined();
    const calzone = data.catalog.calzone.find((l: { name: string }) => l.name === "Calzone");
    expect(calzone?.id).toBe("product-calzone");
    expect(calzone?.available).toBe(true);
    expect(calzone?.strategy).toBe("flavor_priced");
    const macarronada = data.catalog.macarronadas.find((l: { name: string }) => l.name === "Macarronada de Carne");
    expect(macarronada?.strategy).toBe("size");
    expect(Array.isArray(macarronada?.sizes)).toBe(true);
    // Calzone: lista OFICIAL e fixa de sabores do cardápio 2026 (decisão
    // comercial aprovada) — nunca mais reaproveita a lista da Pizza nem uma
    // configuração dinâmica (flavorsMode/calzoneFlavors, removida).
    expect(Array.isArray(calzone?.flavors)).toBe(true);
    expect(calzone.flavors.length).toBeGreaterThan(0);
    expect(calzone.flavors.some((f: { name: string }) => f.name === "Calabresa")).toBe(true);
    // "4 Queijos" é um sabor de pizza válido, mas fora da lista oficial do
    // Calzone — nunca aceito, mesmo sendo um flavorId oficial em outro produto.
    expect(calzone.flavors.some((f: { name: string }) => f.name === "4 Queijos")).toBe(false);
  });

  it("GET reflete em tempo real um sabor de Calzone esgotado no catálogo dos produtos configuráveis", async () => {
    const antes = await (await GET()).json();
    const calzoneAntes = antes.catalog.calzone.find((l: { name: string }) => l.name === "Calzone");
    const calabresaCalzoneAntes = calzoneAntes.flavors.find((f: { name: string }) => f.name === "Calabresa");
    expect(calabresaCalzoneAntes.available).toBe(true);

    await marcar("Calabresa", true);
    const depois = await (await GET()).json();
    const calzoneDepois = depois.catalog.calzone.find((l: { name: string }) => l.name === "Calzone");
    const calabresaCalzoneDepois = calzoneDepois.flavors.find((f: { name: string }) => f.name === "Calabresa");
    expect(calabresaCalzoneDepois.available).toBe(false);
  });

  it("GET reflete em tempo real um produto inteiro (ex.: Calzone) esgotado no catálogo dos produtos configuráveis", async () => {
    await marcar("Calzone", true);
    const data = await (await GET()).json();
    const calzone = data.catalog.calzone.find((l: { name: string }) => l.name === "Calzone");
    expect(calzone.available).toBe(false);
  });
});
