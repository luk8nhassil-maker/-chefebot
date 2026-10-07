import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  registrarLeadIndicacaoRadarVendas: vi.fn(),
}));

vi.mock("@/lib/radarVendasEntitlement.server", () => ({
  registrarLeadIndicacaoRadarVendas: mocks.registrarLeadIndicacaoRadarVendas,
}));

import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("https://chefedapizza.com.br/api/chefebot/indicacao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registrarLeadIndicacaoRadarVendas.mockResolvedValue({ ok: true, leadId: "x", duplicate: false });
});

describe("POST /api/chefebot/indicacao", () => {
  test("honeypot encerra sem gravar lead", async () => {
    const res = await POST(req({ website: "spam", ref: "x" }));
    expect(res.status).toBe(200);
    expect(mocks.registrarLeadIndicacaoRadarVendas).not.toHaveBeenCalled();
  });

  test("lead válido retorna 201 e não devolve telefone", async () => {
    const res = await POST(req({ ref: "token", nome: "Ana", pizzaria: "Pizza A", whatsapp: "99999999999" }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toEqual({ ok: true, duplicate: false });
    expect(JSON.stringify(body)).not.toContain("99999999999");
  });

  test("convite inválido responde 404", async () => {
    mocks.registrarLeadIndicacaoRadarVendas.mockResolvedValue({ ok: false, reason: "invalid_referral" });
    const res = await POST(req({ ref: "ruim", nome: "Ana", pizzaria: "Pizza A", whatsapp: "99999999999" }));
    expect(res.status).toBe(404);
  });
});
