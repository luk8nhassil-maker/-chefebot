import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyTokenMock, anthropicCreateMock } = vi.hoisted(() => ({
  verifyTokenMock: vi.fn(),
  anthropicCreateMock: vi.fn(async () => ({ content: [{ text: "resposta" }] })),
}));

vi.mock("@/lib/auth", () => ({ verifyToken: verifyTokenMock }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreateMock };
  },
}));

import { POST } from "./route";

function req(body: unknown, comToken = true) {
  return new NextRequest("https://x.test/api/anthropic", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(comToken ? { cookie: "auth-token=tok" } : {}),
    },
    body: JSON.stringify(body),
  });
}

const payload = { system: "s", messages: [{ role: "user", content: "oi" }] };

beforeEach(() => {
  verifyTokenMock.mockReset();
  anthropicCreateMock.mockClear();
});

describe("POST /api/anthropic", () => {
  it("401 sem cookie — não chama a API da Anthropic", async () => {
    const res = await POST(req(payload, false));
    expect(res.status).toBe(401);
    expect(anthropicCreateMock).not.toHaveBeenCalled();
  });

  it("401 com token inválido", async () => {
    verifyTokenMock.mockResolvedValue(null);
    const res = await POST(req(payload));
    expect(res.status).toBe(401);
    expect(anthropicCreateMock).not.toHaveBeenCalled();
  });

  it("403 role sem permissão (atendente, financeiro, entregador) — não chama a API", async () => {
    for (const role of ["atendente", "financeiro", "entregador"]) {
      verifyTokenMock.mockResolvedValue({ role });
      const res = await POST(req(payload));
      expect(res.status).toBe(403);
    }
    expect(anthropicCreateMock).not.toHaveBeenCalled();
  });

  it("200 para contador (único call site real: /contador)", async () => {
    verifyTokenMock.mockResolvedValue({ role: "contador" });
    const res = await POST(req(payload));
    expect(res.status).toBe(200);
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
  });

  it("200 para admin e dev", async () => {
    for (const role of ["admin", "dev"]) {
      verifyTokenMock.mockResolvedValue({ role });
      const res = await POST(req(payload));
      expect(res.status).toBe(200);
    }
  });

  it("401/403 não vazam token, segredo ou stack trace", async () => {
    verifyTokenMock.mockResolvedValue({ role: "atendente" });
    const res = await POST(req(payload));
    const text = await res.text();
    expect(text).not.toMatch(/tok\b/);
    expect(text).not.toMatch(/ANTHROPIC_API_KEY/i);
    expect(text).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/);
  });
});
