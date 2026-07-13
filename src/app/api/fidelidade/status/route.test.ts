import { vi, describe, test, expect } from "vitest";

let configMock: { ativo: boolean } = { ativo: false };

vi.mock("@/lib/fidelidade", () => ({
  obterConfigFidelidadePontos: vi.fn(async () => configMock),
}));

import { GET } from "./route";

describe("GET /api/fidelidade/status — endpoint público, sem autenticação", () => {
  test("programa desativado -> ativo:false", async () => {
    configMock = { ativo: false };
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ativo: false });
  });

  test("programa ativado -> ativo:true", async () => {
    configMock = { ativo: true };
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ ativo: true });
  });

  test("nunca expõe nenhum outro campo (meta, recompensa, dados de cliente)", async () => {
    configMock = { ativo: true };
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["ativo"]);
  });
});
