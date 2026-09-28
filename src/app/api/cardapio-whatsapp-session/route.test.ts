import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  validarTokenCardapio: vi.fn(),
  mascararPhone: vi.fn(),
  mascararTelefoneExibicao: vi.fn(),
  derivarClienteIdPorTelefone: vi.fn(),
  criarVinculoCookieComportamento: vi.fn(),
  behaviorAnalyticsEnabled: vi.fn(),
  sincronizarCronometroInatividade: vi.fn(),
}));
vi.mock("@/lib/cardapioToken", () => ({
  validarTokenCardapio: mocks.validarTokenCardapio,
  mascararPhone: mocks.mascararPhone,
  mascararTelefoneExibicao: mocks.mascararTelefoneExibicao,
}));
vi.mock("@/lib/fidelidade", () => ({ derivarClienteIdPorTelefone: mocks.derivarClienteIdPorTelefone }));
vi.mock("@/lib/behaviorAnalytics", () => ({
  criarVinculoCookieComportamento: mocks.criarVinculoCookieComportamento,
  behaviorAnalyticsEnabled: mocks.behaviorAnalyticsEnabled,
}));
vi.mock("@/lib/inatividadeConversa", () => ({ sincronizarCronometroInatividade: mocks.sincronizarCronometroInatividade }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validarTokenCardapio.mockResolvedValue({ phone: "5544999999999" });
  mocks.mascararPhone.mockReturnValue("9999");
  mocks.mascararTelefoneExibicao.mockReturnValue("(44) 9••••-9999");
  mocks.derivarClienteIdPorTelefone.mockReturnValue("cli_5544999999999");
  mocks.criarVinculoCookieComportamento.mockReturnValue("pseudonym.signature");
  mocks.behaviorAnalyticsEnabled.mockReturnValue(true);
  mocks.sincronizarCronometroInatividade.mockResolvedValue(undefined);
});

describe("GET /api/cardapio-whatsapp-session", () => {
  test("associa o link validado com cookie HttpOnly restrito à telemetria e resposta sem telefone", async () => {
    const req = new NextRequest("https://chefedapizza.com.br/api/cardapio-whatsapp-session?t=opaque");
    const response = await GET(req);
    const body = await response.json();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(body).toEqual({ ok: true, origem: "whatsapp", phoneFinal: "9999", phoneMascarado: "(44) 9••••-9999" });
    expect(JSON.stringify(body)).not.toContain("5544999999999");
    expect(cookie).toContain("behavior-link-v1=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/comportamento");
    expect(cookie).not.toContain("5544999999999");
  });

  test("não cria identidade de telemetria com o gate desligado", async () => {
    mocks.behaviorAnalyticsEnabled.mockReturnValue(false);
    const response = await GET(new NextRequest("https://chefedapizza.com.br/api/cardapio-whatsapp-session?t=opaque"));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.criarVinculoCookieComportamento).not.toHaveBeenCalled();
  });
});
