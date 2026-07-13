import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const extratosPorCliente = new Map<string, unknown[]>();
let configPontos: Record<string, unknown> | null = null;
let pizzasAntigasPorCliente = new Map<string, number>();
let recompensasPorCliente = new Map<string, unknown[]>();

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  // telefone "cli_a"/"cli_b" (sem dígitos) é proposital: derivarClienteIdPorTelefone
  // não consegue derivar nada dele (menos de 10 dígitos), então a rota cai no
  // fallback `cliente.clienteId` — é isso que faz `extratosPorCliente.set("cli_a", ...)`
  // bater com o clienteIdPontos resolvido de fato.
  resolverSessaoCliente: vi.fn(async (req: NextRequest) => {
    const token = req.cookies.get("cliente-token")?.value;
    if (token === "token-cliente-a") {
      return { cliente: { clienteId: "cli_a", telefone: "cli_a", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" }, deveRenovar: false };
    }
    if (token === "token-cliente-b") {
      return { cliente: { clienteId: "cli_b", telefone: "cli_b", nome: "Cliente B", createdAt: "", updatedAt: "", lastLoginAt: "" }, deveRenovar: false };
    }
    return null;
  }),
  definirCookieSessaoCliente: vi.fn(),
}));

vi.mock("@/lib/fidelidade", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fidelidade")>("@/lib/fidelidade");
  return {
    ...actual,
    obterExtratoPontos: vi.fn(async (clienteId: string) => extratosPorCliente.get(clienteId) ?? []),
    obterConfigFidelidadePontos: vi.fn(async () => configPontos ?? actual.CONFIG_FIDELIDADE_PONTOS_PADRAO),
    obterSaldoAntigoPizzas: vi.fn(async (clienteId: string) => pizzasAntigasPorCliente.get(clienteId) ?? 0),
    obterRecompensasPontos: vi.fn(async (clienteId: string) => recompensasPorCliente.get(clienteId) ?? []),
  };
});

import { GET } from "./route";

function mov(overrides: Record<string, unknown>) {
  return {
    movimentoId: `mov_${Math.random().toString(36).slice(2, 8)}`,
    clienteId: "cli_a",
    createdAt: new Date().toISOString(),
    motivo: "teste",
    ...overrides,
  };
}

function requestComCookie(token?: string, query = "") {
  const url = `http://localhost/api/cliente/fidelidade${query}`;
  const init = token ? { headers: { cookie: `cliente-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

beforeEach(() => {
  extratosPorCliente.clear();
  pizzasAntigasPorCliente = new Map();
  recompensasPorCliente = new Map();
  configPontos = null;
});

describe("GET /api/cliente/fidelidade — autenticacao", () => {
  test("requisicao sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie());
    expect(res.status).toBe(401);
  });

  test("token invalido/adulterado retorna 401", async () => {
    const res = await GET(requestComCookie("token-adulterado"));
    expect(res.status).toBe(401);
  });

  test("cliente autenticado consulta somente os proprios dados", async () => {
    extratosPorCliente.set("cli_a", [mov({ clienteId: "cli_a", tipo: "confirmado", pontos: 30 })]);
    extratosPorCliente.set("cli_b", [mov({ clienteId: "cli_b", tipo: "confirmado", pontos: 999 })]);

    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.saldoPontos).toBe(30);
  });

  test("nao e possivel informar outro clienteId via query — a sessao sempre vence", async () => {
    extratosPorCliente.set("cli_a", [mov({ clienteId: "cli_a", tipo: "confirmado", pontos: 30 })]);
    extratosPorCliente.set("cli_b", [mov({ clienteId: "cli_b", tipo: "confirmado", pontos: 999 })]);

    const res = await GET(requestComCookie("token-cliente-a", "?clienteId=cli_b"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.saldoPontos).toBe(30); // continua os dados de cli_a, nunca de cli_b
  });
});

describe("GET /api/cliente/fidelidade — calculo de saldo pelo extrato", () => {
  test("previsto nao entra no saldo", async () => {
    extratosPorCliente.set("cli_a", [mov({ tipo: "previsto", pontos: 50, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(0);
  });

  test("cancelado nao entra no saldo", async () => {
    extratosPorCliente.set("cli_a", [mov({ tipo: "cancelado", pontos: 50, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(0);
  });

  test("confirmado entra no saldo", async () => {
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 45, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(45);
  });

  test("estornado reduz o saldo", async () => {
    extratosPorCliente.set("cli_a", [
      mov({ tipo: "confirmado", pontos: 80, pedidoId: "p1" }),
      mov({ tipo: "estornado", pontos: 80, pedidoId: "p1" }),
    ]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(0);
  });

  test("resgatado reduz o saldo", async () => {
    extratosPorCliente.set("cli_a", [
      mov({ tipo: "confirmado", pontos: 720, pedidoId: "p1" }),
      mov({ tipo: "resgatado", pontos: 500 }),
    ]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(220);
  });

  test("ajuste positivo e negativo funcionam", async () => {
    extratosPorCliente.set("cli_a", [
      mov({ tipo: "confirmado", pontos: 100, pedidoId: "p1" }),
      mov({ tipo: "ajuste", pontos: 20 }),
      mov({ tipo: "ajuste", pontos: -50 }),
    ]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(70);
  });
});

describe("GET /api/cliente/fidelidade — pontos previstos separados", () => {
  test("previsto de pedido ainda nao resolvido aparece separado do saldo", async () => {
    extratosPorCliente.set("cli_a", [
      mov({ tipo: "confirmado", pontos: 45, pedidoId: "p1" }),
      mov({ tipo: "previsto", pontos: 12, pedidoId: "p2" }),
    ]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(45);
    expect(body.pontosPrevistos).toBe(12);
  });

  test("previsto de pedido ja confirmado nao conta mais como previsto (evita contar 2x)", async () => {
    extratosPorCliente.set("cli_a", [
      mov({ tipo: "previsto", pontos: 45, pedidoId: "p1" }),
      mov({ tipo: "confirmado", pontos: 45, pedidoId: "p1" }),
    ]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.saldoPontos).toBe(45);
    expect(body.pontosPrevistos).toBe(0);
  });
});

describe("GET /api/cliente/fidelidade — meta e progresso", () => {
  test("meta explicita em pontos e retornada", async () => {
    configPontos = { ativo: true, metaPontos: 500, descricaoRecompensa: "Desconto" };
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.metaPontos).toBe(500);
  });

  test("progresso percentual nunca ultrapassa 100, mesmo com saldo acima da meta", async () => {
    configPontos = { ativo: true, metaPontos: 100, descricaoRecompensa: "x" };
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 500, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.progressoPercentual).toBe(100);
    expect(body.progressoPercentual).toBeLessThanOrEqual(100);
  });

  test("pontos faltantes nunca ficam negativos, mesmo com saldo acima da meta", async () => {
    configPontos = { ativo: true, metaPontos: 100, descricaoRecompensa: "x" };
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 500, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.pontosFaltantes).toBe(0);
    expect(body.pontosFaltantes).toBeGreaterThanOrEqual(0);
  });

  test("meta atingida e retornada corretamente (saldo >= meta)", async () => {
    configPontos = { ativo: true, metaPontos: 720, descricaoRecompensa: "x" };
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 720, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.metaAtingida).toBe(true);
  });

  test("meta nao atingida quando saldo abaixo da meta", async () => {
    configPontos = { ativo: true, metaPontos: 720, descricaoRecompensa: "x" };
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 100, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.metaAtingida).toBe(false);
    expect(body.pontosFaltantes).toBe(620);
  });
});

describe("GET /api/cliente/fidelidade — extrato: ordenacao e limites", () => {
  test("extrato vem ordenado do mais recente para o mais antigo", async () => {
    extratosPorCliente.set("cli_a", [
      mov({ tipo: "confirmado", pontos: 10, pedidoId: "p1", createdAt: "2026-01-01T00:00:00.000Z" }),
      mov({ tipo: "confirmado", pontos: 20, pedidoId: "p2", createdAt: "2026-03-01T00:00:00.000Z" }),
      mov({ tipo: "confirmado", pontos: 30, pedidoId: "p3", createdAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.extrato.map((m: { pontos: number }) => m.pontos)).toEqual([20, 30, 10]);
  });

  test("limite padrao (sem parametro) funciona", async () => {
    const movimentos = Array.from({ length: 30 }, (_, i) => mov({ tipo: "ajuste", pontos: 1, createdAt: new Date(2026, 0, i + 1).toISOString() }));
    extratosPorCliente.set("cli_a", movimentos);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.extrato).toHaveLength(20);
  });

  test("limite customizado dentro do maximo e respeitado", async () => {
    const movimentos = Array.from({ length: 30 }, (_, i) => mov({ tipo: "ajuste", pontos: 1, createdAt: new Date(2026, 0, i + 1).toISOString() }));
    extratosPorCliente.set("cli_a", movimentos);
    const res = await GET(requestComCookie("token-cliente-a", "?limit=5"));
    const body = await res.json();
    expect(body.extrato).toHaveLength(5);
  });

  test("limite maximo e respeitado mesmo pedindo um valor muito maior", async () => {
    const movimentos = Array.from({ length: 300 }, (_, i) => mov({ tipo: "ajuste", pontos: 1, createdAt: new Date(2026, 0, 1, 0, i).toISOString() }));
    extratosPorCliente.set("cli_a", movimentos);
    const res = await GET(requestComCookie("token-cliente-a", "?limit=5000"));
    const body = await res.json();
    expect(body.extrato.length).toBeLessThanOrEqual(100);
  });

  test("parametro de limite invalido (nao numerico ou negativo) cai para o padrao", async () => {
    const movimentos = Array.from({ length: 30 }, (_, i) => mov({ tipo: "ajuste", pontos: 1, createdAt: new Date(2026, 0, i + 1).toISOString() }));
    extratosPorCliente.set("cli_a", movimentos);
    const resInvalido = await GET(requestComCookie("token-cliente-a", "?limit=abc"));
    const bodyInvalido = await resInvalido.json();
    expect(bodyInvalido.extrato).toHaveLength(20);

    const resNegativo = await GET(requestComCookie("token-cliente-a", "?limit=-5"));
    const bodyNegativo = await resNegativo.json();
    expect(bodyNegativo.extrato).toHaveLength(20);
  });
});

describe("GET /api/cliente/fidelidade — compatibilidade com modelo antigo", () => {
  test("dados antigos (pizzas) sao retornados separados em 'legado', nunca somados aos pontos", async () => {
    pizzasAntigasPorCliente.set("cli_a", 7);
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 45, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.legado.pizzasAcumuladas).toBe(7);
    expect(body.saldoPontos).toBe(45); // nao inclui as 7 pizzas
  });

  test("API retorna movimentos legados de pontos junto com movimentos novos", async () => {
    extratosPorCliente.set("cli_a", [
      mov({ movimentoId: "legado", tipo: "confirmado", pontos: 45, pedidoId: "p_legado", createdAt: "2026-07-11T20:00:00.000Z" }),
      mov({ movimentoId: "novo", tipo: "confirmado", pontos: 20, pedidoId: "p_novo", createdAt: "2026-07-12T20:00:00.000Z" }),
    ]);

    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();

    expect(body.saldoPontos).toBe(65);
    expect(body.extrato.map((m: { id: string }) => m.id)).toEqual(["novo", "legado"]);
  });
});

describe("GET /api/cliente/fidelidade — recompensas abertas e historico (CTA no front)", () => {
  test("expõe ativo, descricaoRecompensa e separa recompensas abertas de historico", async () => {
    configPontos = { ativo: true, metaPontos: 60, descricaoRecompensa: "1 Pizza Família" };
    recompensasPorCliente.set("cli_a", [
      { recompensaId: "rcp_aberta", status: "disponivel", createdAt: "2026-01-01T00:00:00.000Z" },
      { recompensaId: "rcp_notificada", status: "notificada", createdAt: "2026-01-02T00:00:00.000Z" },
      { recompensaId: "rcp_usada", status: "resgatada", createdAt: "2026-01-03T00:00:00.000Z" },
      { recompensaId: "rcp_vencida", status: "expirada", createdAt: "2026-01-04T00:00:00.000Z" },
    ]);

    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();

    expect(body.ativo).toBe(true);
    expect(body.descricaoRecompensa).toBe("1 Pizza Família");
    expect(body.recompensas.map((r: { recompensaId: string }) => r.recompensaId).sort()).toEqual(
      ["rcp_aberta", "rcp_notificada"].sort()
    );
    expect(body.recompensasHistorico.map((r: { recompensaId: string }) => r.recompensaId).sort()).toEqual(
      ["rcp_usada", "rcp_vencida"].sort()
    );
  });

  test("recompensa expirada nunca aparece na lista de recompensas abertas, mesmo com saldo alto", async () => {
    configPontos = { ativo: true, metaPontos: 60, descricaoRecompensa: "1 Pizza Família" };
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 1000, pedidoId: "p1" })]);
    recompensasPorCliente.set("cli_a", [
      { recompensaId: "rcp_vencida", status: "expirada", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();

    expect(body.metaAtingida).toBe(true);
    expect(body.recompensas).toHaveLength(0); // sem recompensa aberta -> front nunca mostra CTA
  });

  test("sem fidelidade ativa: ativo=false, mesmo com recompensa aberta cadastrada", async () => {
    configPontos = { ativo: false, metaPontos: 60, descricaoRecompensa: "1 Pizza Família" };
    recompensasPorCliente.set("cli_a", [
      { recompensaId: "rcp_aberta", status: "disponivel", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();

    expect(body.ativo).toBe(false);
    expect(body.recompensas).toHaveLength(1); // dado bruto exposto; front so mostra CTA se ativo && metaAtingida && recompensas.length>0
  });
});

describe("GET /api/cliente/fidelidade — nenhuma informacao sensivel exposta", () => {
  test("resposta nao contem clienteId, telefone, token ou chaves internas do Redis", async () => {
    extratosPorCliente.set("cli_a", [mov({ tipo: "confirmado", pontos: 45, pedidoId: "p1" })]);
    const res = await GET(requestComCookie("token-cliente-a"));
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain("cli_a");
    expect(texto).not.toContain("11900000001");
    expect(texto).not.toContain("token-cliente-a");
    expect(texto).not.toContain("fidelidade:pontos:");
  });
});
