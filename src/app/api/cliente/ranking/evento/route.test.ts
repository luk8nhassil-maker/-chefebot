import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { registrar } = vi.hoisted(() => ({ registrar: vi.fn(async () => {}) }));

vi.mock("@/lib/clienteAuth", () => ({
  lerSessaoCliente: vi.fn(async (req: { cookies: { get(n: string): { value: string } | undefined } }) => {
    const token = req.cookies.get("cliente-token")?.value ?? "";
    if (token === "token-cli-a") return { clienteId: "cli_a", telefone: "11900000001" };
    return null;
  }),
}));

vi.mock("@/lib/rankingRetencaoTelemetria", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rankingRetencaoTelemetria")>(
    "@/lib/rankingRetencaoTelemetria",
  );
  return { ...actual, registrarEventoRankingRetencao: registrar };
});

import { POST } from "./route";

function req(body: unknown, token?: string) {
  const url = "http://localhost/api/cliente/ranking/evento";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `cliente-token=${token}`;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  registrar.mockClear();
});

describe("POST /api/cliente/ranking/evento", () => {
  test("401 sem sessão de cliente — nunca aceita evento anônimo", async () => {
    const res = await POST(req({ tipo: "ranking_aberto" }));
    expect(res.status).toBe(401);
    expect(registrar).not.toHaveBeenCalled();
  });

  test("204 e registra evento válido", async () => {
    const res = await POST(req({ tipo: "ranking_aberto" }, "token-cli-a"));
    expect(res.status).toBe(204);
    expect(registrar).toHaveBeenCalledWith("default", "ranking_aberto");
  });

  test("tipo fora da allowlist é descartado silenciosamente (204, sem gravar)", async () => {
    const res = await POST(req({ tipo: "evento_inventado" }, "token-cli-a"));
    expect(res.status).toBe(204);
    expect(registrar).not.toHaveBeenCalled();
  });

  test("body inválido não derruba a rota", async () => {
    const url = "http://localhost/api/cliente/ranking/evento";
    const malformado = new NextRequest(url, {
      method: "POST",
      headers: { cookie: "cliente-token=token-cli-a", "Content-Type": "application/json" },
      body: "{ nao e json",
    });
    const res = await POST(malformado);
    expect(res.status).toBe(204);
    expect(registrar).not.toHaveBeenCalled();
  });

  test("'entrou_top3' não é mais aceito aqui — virou fato server-side (correção do #445)", async () => {
    const res = await POST(req({ tipo: "entrou_top3" }, "token-cli-a"));
    expect(res.status).toBe(204);
    expect(registrar).not.toHaveBeenCalled();
  });

  test("um campo 'detalhe' enviado pelo cliente é ignorado — a rota não repassa nada além do tipo", async () => {
    await POST(req({ tipo: "cta_subir_clicado", detalhe: { qualquer: "coisa" } }, "token-cli-a"));
    expect(registrar).toHaveBeenCalledWith("default", "cta_subir_clicado");
  });
});
