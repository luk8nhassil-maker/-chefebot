import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jornadaChef", () => ({
  obterConfigJornadaChef: vi.fn(async () => ({ modoRollout: "off", metaPizzas: 12, limitePizzasPorPedido: 4, validadeRecompensaDias: 30, mensagensWhatsappAtivas: false, sequenciaRecompensas: [], canaryClienteIds: [], textos: { tituloTrilha: "Jornada do Chef", subtituloTrilha: "" } })),
  salvarConfigJornadaChef: vi.fn(async (input: { sequenciaRecompensas?: unknown[] }) => ({
    ok: true,
    config: { modoRollout: "on", metaPizzas: 12, limitePizzasPorPedido: 4, validadeRecompensaDias: 30, mensagensWhatsappAtivas: false, sequenciaRecompensas: input.sequenciaRecompensas ?? [], canaryClienteIds: [], textos: { tituloTrilha: "Jornada do Chef", subtituloTrilha: "" } },
  })),
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

import { GET, POST } from "./route";
import { salvarConfigJornadaChef } from "@/lib/jornadaChef";

function getRequest(token?: string) {
  const url = "http://localhost/api/jornada-chef/config";
  const init = token ? { headers: { cookie: `auth-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}
function postRequest(token: string | undefined, body: Record<string, unknown>) {
  const url = "http://localhost/api/jornada-chef/config";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("GET /api/jornada-chef/config", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  test("admin/dev/atendente conseguem ler a configuracao", async () => {
    for (const token of ["token-admin", "token-dev", "token-atendente"]) {
      const res = await GET(getRequest(token));
      expect(res.status).toBe(200);
    }
  });
});

describe("POST /api/jornada-chef/config", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(postRequest(undefined, { ativo: true }));
    expect(res.status).toBe(401);
  });

  test("atendente NAO consegue alterar a configuracao (403)", async () => {
    const res = await POST(postRequest("token-atendente", { ativo: true }));
    expect(res.status).toBe(403);
  });

  test("admin consegue salvar", async () => {
    const res = await POST(postRequest("token-admin", { ativo: true, sequenciaRecompensas: [] }));
    expect(res.status).toBe(200);
  });

  test("quando a lib rejeita a configuracao, a rota devolve 400 com o erro e os detalhes", async () => {
    vi.mocked(salvarConfigJornadaChef).mockResolvedValueOnce({ ok: false, erro: "invalido", detalhes: [{ indice: 0, mensagens: ["ruim"] }] });
    const res = await POST(postRequest("token-admin", { ativo: true, sequenciaRecompensas: [{}] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalido");
    expect(data.detalhes).toEqual([{ indice: 0, mensagens: ["ruim"] }]);
  });
});
