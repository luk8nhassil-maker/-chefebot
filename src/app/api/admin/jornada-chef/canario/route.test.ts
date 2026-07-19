import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jornadaChef", () => ({
  obterConfigJornadaChef: vi.fn(async () => ({ modoRollout: "canary", canaryClientes: [{ ref: "a".repeat(64), idPublico: "aaaaaaaaaaaa", labelMascarado: "…8888" }] })),
  adicionarClienteCanario: vi.fn(async (telefone: string) => ({ idPublico: "bbbbbbbbbbbb", labelMascarado: `…${telefone.slice(-4)}` })),
  removerClienteCanario: vi.fn(async () => undefined),
  listarClientesCanario: vi.fn((config: { canaryClientes: { idPublico: string; labelMascarado: string }[] }) =>
    config.canaryClientes.map((c) => ({ idPublico: c.idPublico, labelMascarado: c.labelMascarado }))
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

  test("admin/atendente conseguem listar — nunca clienteId, telefone ou HMAC completo", async () => {
    const res = await GET(req("GET", "token-atendente"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.clientes[0].labelMascarado).toBe("…8888");
    expect(Object.keys(data.clientes[0]).sort()).toEqual(["idPublico", "labelMascarado"]);
    expect(data.clientes[0].idPublico.length).toBeLessThan(64); // nunca o HMAC-SHA256 completo (64 hex)
    expect(JSON.stringify(data)).not.toContain("cli_");
  });
});

describe("POST /api/admin/jornada-chef/canario", () => {
  test("atendente NAO consegue adicionar (403)", async () => {
    const res = await POST(req("POST", "token-atendente", { telefone: "86999997777" }));
    expect(res.status).toBe(403);
  });

  test("admin consegue adicionar por telefone — resposta nunca inclui clienteId ou telefone", async () => {
    const res = await POST(req("POST", "token-admin", { telefone: "86999997777" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.labelMascarado).toBe("…7777");
    expect(data).not.toHaveProperty("clienteId");
    expect(data).not.toHaveProperty("telefone");
    expect(Object.keys(data).sort()).toEqual(["idPublico", "labelMascarado", "ok"]);
    expect(vi.mocked(adicionarClienteCanario)).toHaveBeenCalledWith("86999997777");
  });

  test("sem telefone no body retorna 400", async () => {
    const res = await POST(req("POST", "token-admin", {}));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/jornada-chef/canario", () => {
  test("atendente NAO consegue remover (403)", async () => {
    const res = await DELETE(req("DELETE", "token-atendente", undefined, "?idPublico=aaaaaaaaaaaa"));
    expect(res.status).toBe(403);
  });

  test("admin remove por idPublico (nunca clienteId ou telefone na URL)", async () => {
    const res = await DELETE(req("DELETE", "token-admin", undefined, "?idPublico=aaaaaaaaaaaa"));
    expect(res.status).toBe(200);
    expect(vi.mocked(removerClienteCanario)).toHaveBeenCalledWith("aaaaaaaaaaaa");
  });

  test("sem idPublico retorna 400", async () => {
    const res = await DELETE(req("DELETE", "token-admin"));
    expect(res.status).toBe(400);
  });
});
