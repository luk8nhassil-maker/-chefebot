import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mock = vi.hoisted(() => ({
  db: new Map<string, unknown>(),
  emPreview: false,
  sets: 0,
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => mock.db.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      mock.sets++; mock.db.set(key, value); return "OK";
    }),
  },
}));
vi.mock("@/lib/previewSafety", () => ({
  emPreviewVercel: () => mock.emPreview,
}));
vi.mock("@/lib/apiAuth", () => ({
  autenticarRequisicao: async (req: NextRequest) => {
    const token = req.cookies.get("auth-token")?.value;
    if (token === "admin-a") return { role: "admin", username: "donoA", name: "Dono A" };
    if (token === "admin-b") return { role: "admin", username: "donoB", name: "Dono B" };
    if (token === "atendente") return { role: "atendente", username: "func", name: "Atendente" };
    if (token === "dev") return { role: "dev", username: "dev", name: "Dev" };
    return null;
  },
  exigirRole: (user: { role: string } | null, roles: string[]) => {
    if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (!roles.includes(user.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    return null;
  },
}));
import { GET, PUT } from "./route";

const payload = {
  cnpj: "11.222.333/0001-81",
  razaoSocial: "Empresa Sintética de Teste",
  nomeFantasia: "Pizza Fictícia",
  inscricaoEstadual: "",
  uf: "MA",
  municipio: "Cidade de Teste",
  regimeTributario: "nao_informado",
  declaracaoResponsavel: true,
};
const url = "http://localhost/api/fiscal/cadastro";
function req(method: "GET" | "PUT", token?: string, body?: unknown, origin?: string) {
  return new NextRequest(url, {
    method, headers: {
      host: "localhost", // o servidor exige Host real para conferir a origem
      ...(token ? { cookie: "auth-token=" + token } : {}),
      ...(method === "PUT" ? { "content-type": "application/json", ...(origin === undefined
        ? { origin: "http://localhost" } : origin ? { origin } : {}) } : {}),
    },
    ...(method === "PUT" ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => { mock.db.clear(); mock.emPreview = false; mock.sets = 0; });

describe("cadastro fiscal do próprio empresário — sem chamadas WLG", () => {
  it("nega leitura e escrita sem autenticação", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect((await PUT(req("PUT", undefined, payload))).status).toBe(401);
    expect(mock.sets).toBe(0);
  });
  it("atendente e dev não cadastram dados fiscais em nome do dono", async () => {
    for (const token of ["atendente", "dev"]) {
      expect((await GET(req("GET", token))).status).toBe(403);
      expect((await PUT(req("PUT", token, payload))).status).toBe(403);
    }
    expect(mock.sets).toBe(0);
  });
  it("o próprio dono salva e lê apenas seu rascunho, nunca autoriza emissão", async () => {
    const response = await PUT(req("PUT", "admin-a", payload));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.situacao).toBe("rascunho_pendente_vinculo");
    expect(saved.cadastro.cnpj).toBe("11222333000181");
    expect(saved.cadastro.titularConta).toBe("donoA");
    expect(saved.cadastro.empresaId).toBeUndefined();
    expect(saved.cadastro.podeEmitir).toBeUndefined();
    expect((await GET(req("GET", "admin-a"))).status).toBe(200);
    const consultaOutroDono = await (await GET(req("GET", "admin-b"))).json();
    expect(consultaOutroDono).toMatchObject({
      situacao: "nao_iniciado", cadastro: null,
    });
    expect(mock.db.size).toBe(1);
  });
  it("duas contas não compartilham chave, rascunho ou dados", async () => {
    expect((await PUT(req("PUT", "admin-a", payload))).status).toBe(200);
    expect((await PUT(req("PUT", "admin-b", {
      ...payload, nomeFantasia: "Outra empresa",
    }))).status).toBe(200);
    const a = await (await GET(req("GET", "admin-a"))).json();
    const b = await (await GET(req("GET", "admin-b"))).json();
    expect(a.cadastro.nomeFantasia).toBe("Pizza Fictícia");
    expect(b.cadastro.nomeFantasia).toBe("Outra empresa");
    expect(mock.db.size).toBe(2);
    expect([...mock.db.keys()].every(k => /^fiscal:cadastro-dono:v1:[a-f0-9]{64}$/.test(k))).toBe(true);
  });
  it("bloqueia adulteração do status, credenciais e dados desconhecidos", async () => {
    for (const extra of [
      { clientSecret: "NAO_SALVAR" },
      { certificadoA1: "NAO_SALVAR" },
      { empresaId: "empresa-estranha" },
      { situacao: "autorizada" },
    ]) {
      const r = await PUT(req("PUT", "admin-a", { ...payload, ...extra }));
      expect(r.status).toBe(400);
    }
    expect(mock.sets).toBe(0);
  });
  it("valida CNPJ e declaração; nunca deduz tributos", async () => {
    expect((await PUT(req("PUT", "admin-a", { ...payload, cnpj: "00000000000000" }))).status).toBe(400);
    expect((await PUT(req("PUT", "admin-a", { ...payload, declaracaoResponsavel: false }))).status).toBe(400);
    expect((await PUT(req("PUT", "admin-a", { ...payload, uf: "XX" }))).status).toBe(400);
    expect(mock.sets).toBe(0);
  });
  it("sem Origin ou com Origin de outro site, proíbe escrita (CSRF)", async () => {
    expect((await PUT(req("PUT", "admin-a", payload, ""))).status).toBe(403);
    expect((await PUT(req("PUT", "admin-a", payload, "https://site-invasor.test"))).status).toBe(403);
    expect(mock.sets).toBe(0);
  });
  it("Preview proíbe leitura e escrita no Redis de produção", async () => {
    mock.emPreview = true;
    expect((await GET(req("GET", "admin-a"))).status).toBe(403);
    expect((await PUT(req("PUT", "admin-a", payload))).status).toBe(403);
    expect(mock.sets).toBe(0);
  });
  it("não sobrescreve registro associado a outro titular", async () => {
    await PUT(req("PUT", "admin-a", payload));
    const chave = [...mock.db.keys()][0];
    mock.db.set(chave, { ...mock.db.get(chave) as object, titularConta: "outro-dono" });
    expect((await GET(req("GET", "admin-a"))).status).toBe(503);
    expect((await PUT(req("PUT", "admin-a", payload))).status).toBe(409);
    expect(mock.sets).toBe(1);
  });
});
