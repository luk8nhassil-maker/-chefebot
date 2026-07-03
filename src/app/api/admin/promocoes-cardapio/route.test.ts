import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
  };
  return { store, redisMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", () => ({ verifyToken: verifyTokenMock }));

import { GET, POST } from "./route";
import { PUT, DELETE } from "./[id]/route";
import { PROMOS_KEY, type Promocao } from "@/lib/promocoes";

function req(body: unknown, comToken = true) {
  return {
    json: async () => body,
    cookies: { get: (name: string) => (comToken && name === "auth-token" ? { value: "tok" } : undefined) },
  } as never;
}

const promoValida = {
  active: true,
  featured: true,
  title: "Pizza G + Guaraná 1L grátis",
  description: "Combo da casa.",
  type: "combo_fixed_price",
  mainItems: [{ productId: "pizza:G", productName: "Pizza G", category: "pizza", quantity: 1, customerMustChooseFlavor: true }],
  freeItems: [{ productId: "bebida:Guarana 1L", productName: "Guarana 1L", category: "bebida", quantity: 1, priceImpact: 0 }],
  promotionalPrice: 49.9,
  includedText: "",
};

beforeEach(() => {
  store.clear();
  verifyTokenMock.mockReset();
  verifyTokenMock.mockResolvedValue({ role: "admin" });
});

describe("POST /api/admin/promocoes-cardapio", () => {
  it("bloqueia sem autenticação", async () => {
    verifyTokenMock.mockResolvedValue(null);
    const res = await POST(req(promoValida, false));
    expect(res.status).toBe(401);
  });

  it("bloqueia role não permitida", async () => {
    verifyTokenMock.mockResolvedValue({ role: "entregador" });
    const res = await POST(req(promoValida));
    expect(res.status).toBe(401);
  });

  it("salva promoção válida e materializa o preço", async () => {
    const res = await POST(req(promoValida));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.promo.id).toMatch(/^promo_/);
    expect(data.promo.promotionalPrice).toBe(49.9);
    const salvas = store.get(PROMOS_KEY) as Promocao[];
    expect(salvas).toHaveLength(1);
  });

  it("rejeita promoção ativa incompleta (sem título)", async () => {
    const res = await POST(req({ ...promoValida, title: "" }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.erros.join(" ")).toMatch(/Título/);
    expect(store.get(PROMOS_KEY)).toBeUndefined();
  });

  it("permite salvar rascunho inativo incompleto", async () => {
    const res = await POST(req({ ...promoValida, active: false, title: "" }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/promocoes-cardapio", () => {
  it("bloqueia sem autenticação e lista com auth", async () => {
    await POST(req(promoValida));
    expect((await GET(req(null, false))).status).toBe(401);
    const res = await GET(req(null));
    const data = await res.json();
    expect(data).toHaveLength(1);
  });
});

describe("PUT/DELETE /api/admin/promocoes-cardapio/[id]", () => {
  it("atualiza promoção existente", async () => {
    const criada = (await (await POST(req(promoValida))).json()).promo as Promocao;
    const res = await PUT(req({ title: "Novo nome do combo" }), { params: Promise.resolve({ id: criada.id }) });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.promo.title).toBe("Novo nome do combo");
    expect(data.promo.id).toBe(criada.id);
  });

  it("rejeita update que deixaria promoção ativa inválida", async () => {
    const criada = (await (await POST(req(promoValida))).json()).promo as Promocao;
    const res = await PUT(req({ description: "" }), { params: Promise.resolve({ id: criada.id }) });
    expect(res.status).toBe(400);
  });

  it("DELETE desativa em vez de apagar", async () => {
    const criada = (await (await POST(req(promoValida))).json()).promo as Promocao;
    const res = await DELETE(req(null), { params: Promise.resolve({ id: criada.id }) });
    expect((await res.json()).ok).toBe(true);
    const salvas = store.get(PROMOS_KEY) as Promocao[];
    expect(salvas).toHaveLength(1);
    expect(salvas[0].active).toBe(false);
  });
});
