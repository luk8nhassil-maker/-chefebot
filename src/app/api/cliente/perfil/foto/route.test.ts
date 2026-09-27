import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { salvarMock, obterMock, missaoMock } = vi.hoisted(() => ({
  salvarMock: vi.fn(),
  obterMock: vi.fn(),
  missaoMock: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({
  lerSessaoCliente: vi.fn(async (req: { cookies: { get(n: string): { value: string } | undefined } }) => {
    const token = req.cookies.get("cliente-token")?.value ?? "";
    return token === "ok" ? { clienteId: "cli_a", telefone: "11900000001" } : null;
  }),
}));

vi.mock("@/lib/clientes", () => ({
  buscarClientePorId: vi.fn(async (id: string) => id === "cli_a"
    ? { clienteId: "cli_a", telefone: "11900000001", nome: "A" }
    : null),
}));

vi.mock("@/lib/fidelidade", () => ({
  derivarClienteIdPorTelefone: vi.fn((telefone: string) => `hashed_${telefone}`),
}));

vi.mock("@/lib/fotoPerfilCliente", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fotoPerfilCliente")>("@/lib/fotoPerfilCliente");
  return {
    ...actual,
    obterFotoPerfilCliente: obterMock,
    missaoFotoPerfilConcluida: missaoMock,
    salvarFotoPerfilCliente: salvarMock,
  };
});

import { GET, PUT } from "./route";

function req(method: "GET" | "PUT", token?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `cliente-token=${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new NextRequest("http://localhost/api/cliente/perfil/foto", {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  obterMock.mockResolvedValue(null);
  missaoMock.mockResolvedValue(false);
  salvarMock.mockResolvedValue({
    foto: { dataUrl: "data:image/jpeg;base64,/9j/2Q==", updatedAt: "2026-09-27T12:00:00.000Z" },
    missao: { concluida: true, concluidaEm: "2026-09-27T12:00:00.000Z" },
  });
});

describe("/api/cliente/perfil/foto", () => {
  test("GET e PUT exigem sessão do próprio cliente", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await PUT(req("PUT", undefined, { dataUrl: "x" }))).status).toBe(401);
  });

  test("GET devolve somente a própria foto e o estado da missão", async () => {
    obterMock.mockResolvedValue({ dataUrl: "data:image/jpeg;base64,/9j/2Q==", updatedAt: "2026-09-27T12:00:00.000Z" });
    missaoMock.mockResolvedValue(true);
    const res = await GET(req("GET", "ok"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.missaoConcluida).toBe(true);
    expect(body.foto.dataUrl).toMatch(/^data:image\/jpeg/);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  test("PUT usa a identidade canônica do servidor e conclui a missão", async () => {
    const dataUrl = "data:image/jpeg;base64,/9j/2Q==";
    const res = await PUT(req("PUT", "ok", { dataUrl }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.missaoConcluida).toBe(true);
    expect(salvarMock).toHaveBeenCalledWith("hashed_11900000001", dataUrl);
  });

  test("PUT não aceita imagem inválida", async () => {
    const { ErroFotoPerfil } = await import("@/lib/fotoPerfilCliente");
    salvarMock.mockRejectedValueOnce(new ErroFotoPerfil("formato_invalido"));
    const res = await PUT(req("PUT", "ok", { dataUrl: "data:image/png;base64,AAAA" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/imagem/i);
  });
});
