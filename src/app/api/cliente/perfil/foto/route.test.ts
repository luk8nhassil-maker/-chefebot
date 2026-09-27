import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const salvarMock = vi.fn();
const lerMock = vi.fn();
const registrarMock = vi.fn();

vi.mock("@/lib/clienteAuth", () => ({
  lerSessaoCliente: vi.fn(async (req: NextRequest) =>
    req.headers.get("x-test-auth") === "ok" ? { clienteId: "cli_a", telefone: "11900000001" } : null),
}));
vi.mock("@/lib/clientes", () => ({
  buscarClientePorId: vi.fn(async () => ({
    clienteId: "cli_a",
    telefone: "11900000001",
    nome: "Ana",
    fotoPerfilPathname: "perfil/ref/avatar",
    fotoPerfilContentType: "image/webp",
  })),
  registrarFotoPerfilCliente: (...args: unknown[]) => registrarMock(...args),
}));
vi.mock("@/lib/perfilFotoStorage", async () => {
  const real = await vi.importActual<typeof import("@/lib/perfilFotoStorage")>("@/lib/perfilFotoStorage");
  return {
    ...real,
    salvarFotoPerfilBlob: (...args: unknown[]) => salvarMock(...args),
    lerFotoPerfilBlob: (...args: unknown[]) => lerMock(...args),
  };
});

import { GET, POST } from "./route";

function req(body?: FormData) {
  return new NextRequest("http://localhost/api/cliente/perfil/foto", {
    method: body ? "POST" : "GET",
    headers: { "x-test-auth": "ok" },
    ...(body ? { body } : {}),
  });
}

beforeEach(() => {
  salvarMock.mockReset();
  lerMock.mockReset();
  registrarMock.mockReset();
});

describe("/api/cliente/perfil/foto", () => {
  test("upload válido grava Blob antes de marcar a missão como concluída", async () => {
    salvarMock.mockResolvedValue({ pathname: "perfil/ref/avatar", etag: "e1" });
    registrarMock.mockResolvedValue({
      fotoPerfilAtualizadaEm: "2026-09-27T12:00:00.000Z",
      fotoPerfilMissaoConcluidaEm: "2026-09-27T12:00:00.000Z",
    });
    const webp = new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80,1]);
    const form = new FormData();
    form.set("foto", new File([webp], "foto.webp", { type: "image/webp" }));

    const res = await POST(req(form));
    expect(res.status).toBe(200);
    expect(salvarMock).toHaveBeenCalledTimes(1);
    expect(registrarMock).toHaveBeenCalledWith("11900000001", expect.objectContaining({ pathname: "perfil/ref/avatar" }));
    expect((await res.json()).missaoFotoPerfilConcluida).toBe(true);
  });

  test("arquivo que mente MIME é rejeitado antes do storage", async () => {
    const form = new FormData();
    form.set("foto", new File([new Uint8Array([1,2,3])], "foto.webp", { type: "image/webp" }));
    const res = await POST(req(form));
    expect(res.status).toBe(400);
    expect(salvarMock).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
  });

  test("GET exige sessão e serve somente a própria foto", async () => {
    lerMock.mockResolvedValue(new Response(new Uint8Array([1,2,3]), { status: 200, headers: { "content-type": "image/webp" } }));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("private");
    expect(lerMock).toHaveBeenCalledWith("perfil/ref/avatar");

    const semSessao = await GET(new NextRequest("http://localhost/api/cliente/perfil/foto"));
    expect(semSessao.status).toBe(401);
  });
});
