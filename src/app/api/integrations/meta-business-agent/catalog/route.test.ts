import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getMenu: vi.fn(),
  soldOut: vi.fn(),
  stock: vi.fn(),
  redisGet: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("@/lib/catalog/pizzas", () => ({ buildPizzaCatalog: vi.fn(() => ({ flavors: [{ id: "pizza-test", available: true }] })) }));
vi.mock("@/lib/catalog/simpleProducts", () => ({ buildSimpleCatalog: vi.fn(() => ({ bebidas: [{ id: "drink-test", available: true }] })) }));
vi.mock("@/lib/menu.server", () => ({ getMENUDinamico: mocks.getMenu }));
vi.mock("@/lib/estoque", () => ({
  obterEsgotadosEfetivos: mocks.soldOut,
  obterEstoqueItens: mocks.stock,
}));
vi.mock("@/lib/redis", () => ({ redis: { get: mocks.redisGet } }));
vi.mock("@/lib/previewSafety", () => ({ emPreviewVercel: mocks.preview }));

import { GET } from "./route";

const SECRET = "test_only_meta_agent_connector_secret_32_chars";
const env = {
  META_BUSINESS_AGENT_CONNECTOR_ENABLED: "true",
  META_BUSINESS_AGENT_CONNECTOR_SECRET: SECRET,
};

function request(authorization?: string) {
  return new NextRequest("https://example.test/api/integrations/meta-business-agent/catalog", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/integrations/meta-business-agent/catalog", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("META_BUSINESS_AGENT_CONNECTOR_ENABLED", env.META_BUSINESS_AGENT_CONNECTOR_ENABLED);
    vi.stubEnv("META_BUSINESS_AGENT_CONNECTOR_SECRET", env.META_BUSINESS_AGENT_CONNECTOR_SECRET);
    mocks.preview.mockReturnValue(false);
    mocks.getMenu.mockResolvedValue({ neighborhoods: [{ name: "Centro", fee: 3 }] });
    mocks.soldOut.mockResolvedValue([]);
    mocks.stock.mockResolvedValue({});
    mocks.redisGet.mockResolvedValue({ horaAbertura: 18, horaFechamento: 23 });
  });

  it("não revela nem consulta dados quando a integração está desligada", async () => {
    vi.stubEnv("META_BUSINESS_AGENT_CONNECTOR_ENABLED", "false");
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(404);
    expect(mocks.getMenu).not.toHaveBeenCalled();
  });

  it("bloqueia Preview antes de ler Redis ou catálogo", async () => {
    mocks.preview.mockReturnValue(true);
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(404);
    expect(mocks.getMenu).not.toHaveBeenCalled();
  });

  it("exige token Bearer correto", async () => {
    const response = await GET(request("Bearer invalid"));
    expect(response.status).toBe(401);
    expect(mocks.getMenu).not.toHaveBeenCalled();
  });

  it("retorna apenas dados de leitura e não inclui métodos de pagamento", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      businessName: "Chefe da Pizza",
      currency: "BRL",
      priceUnit: "centavos",
      pizzaCatalog: { flavors: [{ id: "pizza-test", available: true }] },
      productCatalog: { bebidas: [{ id: "drink-test", available: true }] },
      deliveryAreas: [{ name: "Centro", feeCents: 300 }],
    });
    expect(body).not.toHaveProperty("payments");
    expect(body).not.toHaveProperty("pix");
  });

  it("falha fechada quando a fonte oficial não está disponível", async () => {
    mocks.getMenu.mockRejectedValue(new Error("redis indisponível"));
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "catalog_unavailable" });
  });

  it("não inventa horário ou taxa quando os dados operacionais estão inválidos", async () => {
    mocks.redisGet.mockResolvedValue({ horaAbertura: 18, horaFechamento: 18 });
    const hoursResponse = await GET(request(`Bearer ${SECRET}`));
    expect(hoursResponse.status).toBe(503);

    mocks.redisGet.mockResolvedValue({ horaAbertura: 18, horaFechamento: 23 });
    mocks.getMenu.mockResolvedValue({ neighborhoods: [{ name: "Centro", fee: Number.NaN }] });
    const deliveryResponse = await GET(request(`Bearer ${SECRET}`));
    expect(deliveryResponse.status).toBe(503);
  });

  it("aceita fechamento às 24h, que é permitido na configuração do ChefeBot", async () => {
    mocks.redisGet.mockResolvedValue({ horaAbertura: 0, horaFechamento: 24 });
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect((await response.json()).operatingHours).toMatchObject({
      openingTime: "00:00",
      closingTime: "24:00",
    });
  });
});
