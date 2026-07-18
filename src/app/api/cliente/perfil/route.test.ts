import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

const BEARER_VALIDO = "f".repeat(32);

function resolverSessaoFake(req: { cookies: { get(n: string): { value: string } | undefined }; headers: { get(n: string): string | null } }) {
  if (req.cookies.get("cliente-token")?.value === "token-cliente-a") return { clienteId: "cli_a", telefone: "11900000001" };
  if (req.headers.get("authorization") === `Bearer ${"f".repeat(32)}`) return { clienteId: "cli_a", telefone: "11900000001" };
  return null;
}

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  lerSessaoCliente: vi.fn(async (req: { cookies: { get(n: string): { value: string } | undefined }; headers: { get(n: string): string | null } }) => resolverSessaoFake(req)),
  lerSessaoClienteDiagnosticada: vi.fn(async (req: { cookies: { get(n: string): { value: string } | undefined }; headers: { get(n: string): string | null } }) => {
    const payload = resolverSessaoFake(req);
    const cookiePresente = !!req.cookies.get("cliente-token")?.value;
    const auth = req.headers.get("authorization");
    const authorizationPresente = !!auth;
    const formatoBearer = auth === `Bearer ${"f".repeat(32)}` ? "opaco" : auth ? "outro" : "nenhum";
    return {
      payload,
      diagnostico: {
        cookiePresente,
        cookieValido: !!payload && cookiePresente,
        authorizationPresente,
        formatoBearer,
        jweValido: false,
        opacoValido: !!payload && formatoBearer === "opaco",
        fonte: payload ? (cookiePresente ? "cookie" : "opaco") : "nenhuma",
      },
    };
  }),
}));

const { ativarFidelidadeClienteMock } = vi.hoisted(() => ({
  ativarFidelidadeClienteMock: vi.fn(async (telefone: string, nome: string) => ({
    clienteId: `cli_${telefone}`,
    telefone,
    nome,
    createdAt: "",
    updatedAt: "",
    lastLoginAt: "",
    fidelidadeAtivadaEm: "2026-01-01T00:00:00.000Z",
  })),
}));

vi.mock("@/lib/clientes", async () => {
  const real = await vi.importActual<typeof import("@/lib/clientes")>("@/lib/clientes");
  return {
    normalizarNomeCliente: real.normalizarNomeCliente,
    ativarFidelidadeCliente: ativarFidelidadeClienteMock,
    buscarClientePorId: vi.fn(async (clienteId: string) => {
      if (clienteId === "cli_a") {
        return { clienteId: "cli_a", telefone: "11900000001", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" };
      }
      return null;
    }),
  };
});

vi.mock("@/lib/fidelidade", () => ({
  obterProgressoFidelidade: vi.fn(async () => ({
    ativo: true,
    progresso: 3,
    meta: 10,
    faltam: 7,
    tipoRecompensa: "pizza_gratis",
    descricaoRecompensa: "Pizza grátis",
    recompensasDisponiveis: [],
  })),
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async () => [
      { id: "p1", clienteId: "cli_a", numero: 1, data: "01/01", total: 50, status: "entregue" },
      { id: "p2", clienteId: "cli_b", numero: 2, data: "01/01", total: 60, status: "entregue" },
    ]),
  },
}));

import { GET, PATCH } from "./route";
import { buscarClientePorId } from "@/lib/clientes";

function requestComCookie(token?: string) {
  const url = "http://localhost/api/cliente/perfil";
  const init = token ? { headers: { cookie: `cliente-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

describe("GET /api/cliente/perfil", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie());
    expect(res.status).toBe(401);
  });

  test("token invalido retorna 401", async () => {
    const res = await GET(requestComCookie("token-adulterado"));
    expect(res.status).toBe(401);
  });

  test("sessao opaca via Authorization: Bearer tambem autentica (fallback sem cookie)", async () => {
    const res = await GET(new NextRequest("http://localhost/api/cliente/perfil", { headers: { authorization: `Bearer ${BEARER_VALIDO}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cliente.telefone).toBe("11900000001");
  });

  test("cliente logado recebe apenas seus proprios dados e pedidos (nunca de outro cliente)", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.cliente.telefone).toBe("11900000001");
    // desacoplado: o perfil NUNCA embute fidelidade (falha de pontos nao pode
    // derrubar este endpoint nem parecer logout)
    expect(body.fidelidade).toBeUndefined();
    expect(body.ultimosPedidos).toHaveLength(1);
    expect(body.ultimosPedidos[0].id).toBe("p1");
  });
});

function requestPatch(token: string | undefined, body: unknown) {
  const init: RequestInit = {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { cookie: `cliente-token=${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
  return new NextRequest("http://localhost/api/cliente/perfil", init as ConstructorParameters<typeof NextRequest>[1]);
}

describe("PATCH /api/cliente/perfil — completa so o nome do dono da sessao", () => {
  test("sem sessao retorna 401", async () => {
    const res = await PATCH(requestPatch(undefined, { nome: "Maria" }));
    expect(res.status).toBe(401);
  });

  test("nome valido e normalizado e salvo no telefone da sessao (nunca do body)", async () => {
    const res = await PATCH(requestPatch("token-cliente-a", { nome: "  Maria   da Silva ", telefone: "11999990000" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.cliente.nome).toBe("Maria da Silva");
    expect(body.next).toBe("points");
    // o telefone usado e sempre o da sessao autenticada; a primeira ativacao
    // grava nome + fidelidadeAtivadaEm na mesma escrita
    expect(ativarFidelidadeClienteMock).toHaveBeenCalledWith("11900000001", "Maria da Silva");
  });

  test("nome vazio/curto retorna 400", async () => {
    const res = await PATCH(requestPatch("token-cliente-a", { nome: "   " }));
    expect(res.status).toBe(400);
  });

  test("PATCH nunca usa buscarClientePorId como gate — sessao valida basta para gravar", async () => {
    // Incidente em produção: esse gate (leitura por clienteId antes de
    // gravar) 401ava um PATCH com sessão válida por atraso de réplica do
    // Redis. O telefone vem direto do payload da sessão autenticada.
    (buscarClientePorId as ReturnType<typeof vi.fn>).mockClear();
    const res = await PATCH(requestPatch("token-cliente-a", { nome: "Maria" }));
    expect(res.status).toBe(200);
    expect(buscarClientePorId).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/cliente/perfil — diagnóstico de autenticação (sem PII no log)", () => {
  function requestPatchComTrace(trace: string | undefined, auth?: string) {
    const init: RequestInit = {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(trace ? { "x-chefebot-trace": trace } : {}),
        ...(auth ? { authorization: auth } : {}),
      },
      body: JSON.stringify({ nome: "Maria" }),
    };
    return new NextRequest("http://localhost/api/cliente/perfil", init as ConstructorParameters<typeof NextRequest>[1]);
  }

  test("resposta ao navegador continua genérica (nunca expõe o diagnóstico)", async () => {
    const res = await PATCH(requestPatchComTrace("P3-ABC123"));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Nao autorizado" });
  });

  test("log registra trace válido e o motivo categórico, sem PII", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await PATCH(requestPatchComTrace("P3-ABC123", "Bearer valor-qualquer"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("perfil3-auth"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("trace=P3-ABC123"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("authorization_presente=1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("formato_bearer=outro"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("fonte=nenhuma"));
    const texto = logSpy.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(texto).not.toContain("valor-qualquer");
    logSpy.mockRestore();
  });

  test("trace invalido/ausente vira '-' no log, nunca é ecoado cru", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await PATCH(requestPatchComTrace("5599974000691"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("trace=-"));
    const texto = logSpy.mock.calls.map((c) => c.join(" ")).join(" | ");
    expect(texto).not.toContain("5599974000691");
    logSpy.mockRestore();
  });

  test("authorization ausente e identificado no log (authorization_presente=0, formato=nenhum)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await PATCH(requestPatchComTrace(undefined));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("authorization_presente=0"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("formato_bearer=nenhum"));
    logSpy.mockRestore();
  });

  test("sessao valida (200) nunca gera o log de diagnóstico de falha", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await PATCH(requestPatch("token-cliente-a", { nome: "Maria" }));
    expect(res.status).toBe(200);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("perfil3-auth"));
    logSpy.mockRestore();
  });
});
