import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import type { EventoAnalitico } from "@/lib/historicoAnalitico";

vi.mock("@/lib/auth", () => ({ verifyToken: vi.fn() }));

vi.mock("@/lib/historicoAnalitico", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/historicoAnalitico")>();
  return {
    ...original,
    consultarEventosPorPeriodo: vi.fn(async () => []),
    consultarEventosAntesDe: vi.fn(async () => []),
  };
});

import { verifyToken } from "@/lib/auth";
import { consultarEventosAntesDe, consultarEventosPorPeriodo } from "@/lib/historicoAnalitico";

const mockVerify = verifyToken as ReturnType<typeof vi.fn>;
const mockPeriodo = consultarEventosPorPeriodo as ReturnType<typeof vi.fn>;
const mockAntes = consultarEventosAntesDe as ReturnType<typeof vi.fn>;

function req(cookie = "auth-token=test") {
  return new NextRequest("http://localhost/api/admin/pesquisa-preferencia/dry-run", {
    headers: cookie ? { cookie } : {},
  });
}

function evento(clienteId: string, pedidoId: string, criadoEmMs: number): EventoAnalitico {
  return {
    pedidoId,
    clienteId,
    tenantId: "default",
    criadoEmMs,
    expedienteId: "exp",
    valorElegivelCents: 5000,
    statusAnalitico: "entregue",
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
  };
}

beforeEach(() => {
  mockVerify.mockReset();
  mockPeriodo.mockReset();
  mockAntes.mockReset();
  mockPeriodo.mockResolvedValue([]);
  mockAntes.mockResolvedValue([]);
});

describe("GET /api/admin/pesquisa-preferencia/dry-run", () => {
  it("rejeita acesso sem sessão admin/dev", async () => {
    mockVerify.mockResolvedValue(null);
    const res = await GET(req(""));
    expect(res.status).toBe(401);
  });

  it("aceita admin e mantém modo dry-run somente leitura", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    const agora = Date.now();
    mockPeriodo.mockResolvedValue([
      evento("cid_a", "p1", agora - 10 * 86400000),
      evento("cid_a", "p2", agora - 5 * 86400000),
    ]);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.modo).toBe("dry-run");
    expect(body.periodoDias).toBe(90);\n    expect(body.segurancaContato.envioAutomaticoAtivo).toBe(false);\n    expect(body.segurancaContato.elegibilidadeFinalCalculada).toBe(false);\n    expect(body.segurancaContato.politica).toEqual({ cooldownDias: 14, maxContatosEm90Dias: 3 });
    expect(res.headers.get("x-chefebot-research-mode")).toBe("dry-run");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(mockPeriodo).toHaveBeenCalledTimes(1);
    expect(mockAntes).toHaveBeenCalledTimes(1);
  });

  it("aceita role dev", async () => {
    mockVerify.mockResolvedValue({ role: "dev" });
    const res = await GET(req());
    expect(res.status).toBe(200);
  });

  it("não expõe identificador interno nem campos pessoais", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    mockPeriodo.mockResolvedValue([evento("cid_interno_x", "p1", Date.now() - 86400000)]);

    const res = await GET(req());
    const texto = await res.text();

    expect(texto).not.toContain("cid_interno_x");
    expect(texto).not.toContain("clienteId");
    expect(texto).not.toContain("telefone");
    expect(texto).not.toContain("endereco");\n    expect(texto).not.toContain("cid_interno_x");
  });

  it("combina histórico anterior e janela atual sem expor registros", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    mockAntes.mockResolvedValue([evento("cid_antigo", "old1", Date.now() - 150 * 86400000)]);
    mockPeriodo.mockResolvedValue([evento("cid_antigo", "new1", Date.now() - 3 * 86400000)]);

    const res = await GET(req());
    const body = await res.json();

    expect(body.cobertura.clientesObservados).toBe(1);
    expect(JSON.stringify(body)).not.toContain("cid_antigo");
  });

  it("responde 500 sem detalhes internos quando a leitura falha", async () => {
    mockVerify.mockResolvedValue({ role: "admin" });
    mockPeriodo.mockRejectedValue(new Error("read failure"));

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "Falha ao calcular dry-run de pesquisa" });
  });
});
