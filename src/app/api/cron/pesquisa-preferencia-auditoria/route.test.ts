import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoAnalitico } from "@/lib/historicoAnalitico";

vi.mock("@/lib/historicoAnalitico", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/historicoAnalitico")>();
  return {
    ...original,
    consultarEventosPorPeriodo: vi.fn(async () => []),
    consultarEventosAntesDe: vi.fn(async () => []),
  };
});

import { consultarEventosAntesDe, consultarEventosPorPeriodo } from "@/lib/historicoAnalitico";
import { GET } from "./route";

const mockPeriodo = consultarEventosPorPeriodo as ReturnType<typeof vi.fn>;
const mockAntes = consultarEventosAntesDe as ReturnType<typeof vi.fn>;
const SEGREDO = "cron-segredo-teste";

function req(auth?: string) {
  return new Request("http://localhost/api/cron/pesquisa-preferencia-auditoria", {
    headers: auth ? { authorization: auth } : {},
  });
}

function evento(
  clienteId: string,
  pedidoId: string,
  dia: number,
  expedienteId: string
): EventoAnalitico {
  const base = Date.UTC(2026, 8, 1, 12, 0, 0);
  return {
    pedidoId,
    clienteId,
    tenantId: "default",
    criadoEmMs: base + dia * 86400000,
    expedienteId,
    valorElegivelCents: 5000,
    statusAnalitico: "entregue",
    canal: "app",
    estrelasGeradas: 5,
    schemaVersao: 1,
    regraVersao: "estrelas-faixas-v1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPeriodo.mockResolvedValue([]);
  mockAntes.mockResolvedValue([]);
  process.env.CRON_SECRET = SEGREDO;
  process.env.VERCEL_GIT_COMMIT_SHA = "sha-teste";
});

describe("GET /api/cron/pesquisa-preferencia-auditoria", () => {
  it("rejeita sem bearer correto", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer errado"))).status).toBe(401);
  });

  it("rejeita mesmo Bearer literal quando CRON_SECRET está ausente", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer undefined"));
    expect(res.status).toBe(401);
  });

  it("retorna somente agregados do dry-run e commit do deployment", async () => {
    const agora = Date.now();
    mockPeriodo.mockResolvedValue([
      { ...evento("cid_a", "p1", 0, "exp-a"), criadoEmMs: agora - 3 * 86400000 },
      { ...evento("cid_a", "p2", 1, "exp-b"), criadoEmMs: agora - 2 * 86400000 },
      { ...evento("cid_a", "p3", 2, "exp-c"), criadoEmMs: agora - 1 * 86400000 },
      { ...evento("cid_b", "p4", 0, "exp-a"), criadoEmMs: agora - 1 * 86400000 },
    ]);

    const res = await GET(req(`Bearer ${SEGREDO}`));
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.modo).toBe("dry-run");
    expect(body.somenteLeitura).toBe(true);
    expect(body.periodoDias).toBe(90);
    expect(body.deploymentCommitSha).toBe("sha-teste");
    expect(body.cobertura.pedidosValidosObservados).toBe(4);
    expect(body.cobertura.ocasioesCompraObservadas).toBe(4);
    expect(body.cobertura.clientesComHistoricoSuficienteParaQueda).toBe(1);
    expect(body.momentos.M1.quantidade).toBe(2);
    expect(body.segurancaContato.envioAutomaticoAtivo).toBe(false);
    expect(body.segurancaContato.elegibilidadeFinalCalculada).toBe(false);
    expect(res.headers.get("x-chefebot-audit-mode")).toBe("read-only");
    expect(res.headers.get("cache-control")).toContain("no-store");

    expect(serialized).not.toContain("cid_a");
    expect(serialized).not.toContain("cid_b");
    expect(serialized).not.toContain("clienteId");
    expect(serialized).not.toContain("telefone");
    expect(serialized).not.toContain("endereco");
  });

  it("combina histórico anterior e janela atual sem expor registros", async () => {
    const agora = Date.now();
    mockAntes.mockResolvedValue([
      { ...evento("cid_antigo", "old", 0, "exp-old"), criadoEmMs: agora - 120 * 86400000 },
    ]);
    mockPeriodo.mockResolvedValue([
      { ...evento("cid_antigo", "new", 1, "exp-new"), criadoEmMs: agora - 2 * 86400000 },
    ]);

    const res = await GET(req(`Bearer ${SEGREDO}`));
    const body = await res.json();

    expect(body.cobertura.clientesObservados).toBe(1);
    expect(body.cobertura.ocasioesCompraObservadas).toBe(2);
    expect(JSON.stringify(body)).not.toContain("cid_antigo");
  });

  it("responde erro higienizado quando a leitura falha", async () => {
    mockPeriodo.mockRejectedValue(new Error("redis token secreto"));
    const res = await GET(req(`Bearer ${SEGREDO}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      error: "Falha ao calcular auditoria agregada de pesquisa",
    });
  });
});
