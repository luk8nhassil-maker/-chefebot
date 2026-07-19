import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jornadaChef", () => ({
  obterConfigJornadaChef: vi.fn(async () => ({ modoRollout: "canary", canaryClienteIds: ["cli_86999998888"] })),
  adicionarClienteCanario: vi.fn(async (telefone: string) => ({ clienteId: `cli_${telefone}`, identificadorMascarado: `…${telefone.slice(-4)}` })),
  removerClienteCanario: vi.fn(async () => undefined),
  listarClientesCanario: vi.fn((config: { canaryClienteIds: string[] }) =>
    config.canaryClienteIds.map((id: string) => ({ clienteId: id, identificadorMascarado: `…${id.slice(-4)}` }))
  ),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      const role = { "token-admin": "admin", "token-dev": "dev", "token-atendente": "atendente" }[token];
      return role ? { username: `dev-${role}`, name: `Dev QA (${role})`, role } : null;
    }),
  };
});

import { GET, POST, DELETE } from "./route";
import { adicionarClienteCanario, removerClienteCanario } from "@/lib/jornadaChef";

function req(method: string, token?: string, body?: unknown, search?: string) {
  const url = `http://localhost/api/admin/jornada-chef/canario${search ?? ""}`;
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `auth-token=${token}`;
  if (body) headers["Content-Type"] = "application/json";
  return new NextRequest(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}

describe("GET /api/admin/jornada-chef/canario", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(401);
  });

  test("admin/atendente conseguem listar — identificador sempre mascarado", async () => {
    const res = await GET(req("GET", "token-atendente"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.clientes[0].identificadorMascarado).toBe("…8888");
  });
});

describe("POST /api/admin/jornada-chef/canario", () => {
  test("atendente NAO consegue adicionar (403)", async () => {
    const res = await POST(req("POST", "token-atendente", { telefone: "86999997777" }));
    expect(res.status).toBe(403);
  });

  test("admin consegue adicionar por telefone — o campo de exibição é sempre o mascarado", async () => {
    const res = await POST(req("POST", "token-admin", { telefone: "86999997777" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.identificadorMascarado).toBe("…7777");
    expect(data).not.toHaveProperty("telefone");
    expect(vi.mocked(adicionarClienteCanario)).toHaveBeenCalledWith("86999997777");
  });

  test("sem telefone no body retorna 400", async () => {
    const res = await POST(req("POST", "token-admin", {}));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/jornada-chef/canario", () => {
  test("atendente NAO consegue remover (403)", async () => {
    const res = await DELETE(req("DELETE", "token-atendente", undefined, "?clienteId=cli_86999998888"));
    expect(res.status).toBe(403);
  });

  test("admin remove por clienteId", async () => {
    const res = await DELETE(req("DELETE", "token-admin", undefined, "?clienteId=cli_86999998888"));
    expect(res.status).toBe(200);
    expect(vi.mocked(removerClienteCanario)).toHaveBeenCalledWith("cli_86999998888");
  });

  test("sem clienteId retorna 400", async () => {
    const res = await DELETE(req("DELETE", "token-admin"));
    expect(res.status).toBe(400);
  });
});
