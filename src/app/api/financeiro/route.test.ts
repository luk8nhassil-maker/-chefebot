import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
  };
  return { store, redisMock };
});

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", () => ({ verifyToken: verifyTokenMock }));

import { GET, POST, PATCH, DELETE } from "./route";

function reqGET(qs = "") {
  return new NextRequest(`https://x.test/api/financeiro${qs}`, {
    headers: { cookie: "auth-token=tok" },
  });
}

function reqBody(method: string, body: unknown, comToken = true) {
  return new NextRequest("https://x.test/api/financeiro", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(comToken ? { cookie: "auth-token=tok" } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.clear();
  verifyTokenMock.mockReset();
  redisMock.get.mockClear();
  redisMock.set.mockClear();
});

describe("GET /api/financeiro", () => {
  it("401 sem cookie", async () => {
    const req = new NextRequest("https://x.test/api/financeiro");
    const res = await GET(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it("401 com token inválido", async () => {
    verifyTokenMock.mockResolvedValue(null);
    const res = await GET(reqGET());
    expect(res.status).toBe(401);
  });

  it("403 role sem permissão (entregador)", async () => {
    verifyTokenMock.mockResolvedValue({ role: "entregador" });
    const res = await GET(reqGET());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it("200 para financeiro", async () => {
    verifyTokenMock.mockResolvedValue({ role: "financeiro" });
    const res = await GET(reqGET("?mes=2026-07"));
    expect(res.status).toBe(200);
  });

  it("200 para contador (call site real: /contador lê /api/financeiro)", async () => {
    verifyTokenMock.mockResolvedValue({ role: "contador" });
    const res = await GET(reqGET());
    expect(res.status).toBe(200);
  });

  it("200 para admin e dev", async () => {
    for (const role of ["admin", "dev"]) {
      verifyTokenMock.mockResolvedValue({ role });
      const res = await GET(reqGET());
      expect(res.status).toBe(200);
    }
  });
});

describe("POST /api/financeiro (registrar/editar custo)", () => {
  const custo = { descricao: "Farinha", valor: "50", categoria: "ingredientes" };

  it("401 sem cookie", async () => {
    const res = await POST(reqBody("POST", custo, false));
    expect(res.status).toBe(401);
  });

  it("403 para contador (sem call site de escrita comprovado)", async () => {
    verifyTokenMock.mockResolvedValue({ role: "contador" });
    const res = await POST(reqBody("POST", custo));
    expect(res.status).toBe(403);
    expect(store.get("custos:2026-07")).toBeUndefined();
  });

  it("403 para atendente/entregador", async () => {
    for (const role of ["atendente", "entregador"]) {
      verifyTokenMock.mockResolvedValue({ role });
      const res = await POST(reqBody("POST", custo));
      expect(res.status).toBe(403);
    }
  });

  it("200 para financeiro e persiste o custo", async () => {
    verifyTokenMock.mockResolvedValue({ role: "financeiro" });
    const res = await POST(reqBody("POST", custo));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.custo.descricao).toBe("Farinha");
  });

  it("200 para admin", async () => {
    verifyTokenMock.mockResolvedValue({ role: "admin" });
    const res = await POST(reqBody("POST", custo));
    expect(res.status).toBe(200);
  });

  it("não escreve nada quando a autorização falha", async () => {
    verifyTokenMock.mockResolvedValue({ role: "contador" });
    await POST(reqBody("POST", custo));
    expect(redisMock.set).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/financeiro (fechar mês)", () => {
  const body = { mes: "2026-07" };

  it("401 sem cookie", async () => {
    const res = await PATCH(reqBody("PATCH", body, false));
    expect(res.status).toBe(401);
  });

  it("403 para financeiro (sem call site — só /contador fecha o mês)", async () => {
    verifyTokenMock.mockResolvedValue({ username: "ana", role: "financeiro" });
    const res = await PATCH(reqBody("PATCH", body));
    expect(res.status).toBe(403);
    expect(store.get("mes_status:2026-07")).toBeUndefined();
  });

  it("200 para contador e fecha o mês", async () => {
    verifyTokenMock.mockResolvedValue({ username: "carlos", role: "contador" });
    const res = await PATCH(reqBody("PATCH", body));
    expect(res.status).toBe(200);
    expect((store.get("mes_status:2026-07") as { fechado: boolean }).fechado).toBe(true);
  });

  it("200 para admin", async () => {
    verifyTokenMock.mockResolvedValue({ username: "brito", role: "admin" });
    const res = await PATCH(reqBody("PATCH", body));
    expect(res.status).toBe(200);
  });

  it("deriva fechadoPor do usuário autenticado, nunca do body — um body com fechadoPor: 'admin' não falsifica a identidade", async () => {
    verifyTokenMock.mockResolvedValue({ username: "carlos", role: "contador" });
    const res = await PATCH(reqBody("PATCH", { mes: "2026-07", fechadoPor: "admin" }));
    expect(res.status).toBe(200);
    const status = store.get("mes_status:2026-07") as { fechadoPor: string };
    expect(status.fechadoPor).toBe("carlos");
    expect(status.fechadoPor).not.toBe("admin");
  });

  it("o valor persistido de fechadoPor vem do JWT mesmo quando o body tenta sobrescrevê-lo com outro nome", async () => {
    verifyTokenMock.mockResolvedValue({ username: "maria", role: "admin" });
    const res = await PATCH(reqBody("PATCH", { mes: "2026-07", fechadoPor: "invasor" }));
    expect(res.status).toBe(200);
    const status = store.get("mes_status:2026-07") as { fechadoPor: string };
    expect(status.fechadoPor).toBe("maria");
  });
});

describe("DELETE /api/financeiro (remover custo)", () => {
  const body = { id: "1", mes: "2026-07" };

  it("401 sem cookie", async () => {
    const res = await DELETE(reqBody("DELETE", body, false));
    expect(res.status).toBe(401);
  });

  it("403 para contador", async () => {
    verifyTokenMock.mockResolvedValue({ role: "contador" });
    const res = await DELETE(reqBody("DELETE", body));
    expect(res.status).toBe(403);
  });

  it("200 para financeiro", async () => {
    store.set("custos:2026-07", [{ id: "1", descricao: "x", valor: 1, categoria: "outros", data: "01/07/2026", mes: "2026-07" }]);
    verifyTokenMock.mockResolvedValue({ role: "financeiro" });
    const res = await DELETE(reqBody("DELETE", body));
    expect(res.status).toBe(200);
  });
});

describe("respostas de erro não vazam dados sensíveis", () => {
  it("401 e 403 não incluem token, segredo ou stack", async () => {
    verifyTokenMock.mockResolvedValue({ role: "entregador" });
    const res = await GET(reqGET());
    const text = await res.text();
    expect(text).not.toMatch(/tok\b/);
    expect(text).not.toMatch(/AUTH_SECRET/i);
    expect(text).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // stack trace shape
  });
});
