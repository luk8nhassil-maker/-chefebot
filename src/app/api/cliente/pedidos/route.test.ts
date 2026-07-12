import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/clienteAuth", () => ({
  CLIENTE_COOKIE: "cliente-token",
  verificarTokenCliente: vi.fn(async (token: string) => {
    if (token === "token-cliente-a") return { clienteId: "cli_a", telefone: "11900000001" };
    if (token === "token-cliente-b") return { clienteId: "cli_b", telefone: "11900000002" };
    if (token === "token-cliente-fantasma") return { clienteId: "cli_fantasma", telefone: "11900000099" };
    return null;
  }),
}));

vi.mock("@/lib/clientes", () => ({
  buscarClientePorId: vi.fn(async (clienteId: string) => {
    if (clienteId === "cli_a") return { clienteId: "cli_a", telefone: "11900000001", nome: "Cliente A", createdAt: "", updatedAt: "", lastLoginAt: "" };
    if (clienteId === "cli_b") return { clienteId: "cli_b", telefone: "11900000002", nome: "Cliente B", createdAt: "", updatedAt: "", lastLoginAt: "" };
    // cli_fantasma: token válido mas cliente não existe mais no cadastro.
    return null;
  }),
  // clientePedidos.ts usa sanitizeTelefoneCliente para comparar telefone de
  // pedidos antigos sem clienteId — mesma implementação real (só dígitos).
  sanitizeTelefoneCliente: (telefone: string) => (telefone || "").replace(/\D/g, ""),
}));

const PEDIDOS_FIXTURE = [
  // Pedido recente do cliente A, criado depois da Área do Cliente (clienteId direto).
  {
    id: "1700000000000",
    clienteId: "cli_a",
    telefone: "11900000001",
    numero: 10,
    cliente: "Ana",
    data: "10/01/2026",
    horario: "20:00",
    total: 55.9,
    status: "entregue",
    tipoEntrega: "delivery",
    itens: ["1x Pizza G - Calabresa"],
    pagamento: "Pix",
    bairro: "Centro",
    statusToken: "segredo-token-1",
    acompanhamentoToken: "segredo-acomp-1",
    pix: { qrCode: "segredo-pix" },
  },
  // Pedido do cliente B — nunca deve aparecer para o cliente A.
  {
    id: "1700000000001",
    clienteId: "cli_b",
    telefone: "11900000002",
    numero: 11,
    total: 60,
    status: "entregue",
    itens: ["1x Pizza M - Frango"],
  },
  // Pedido antigo, anterior à Área do Cliente: sem clienteId, mas telefone
  // bate com o do cliente A (verificado por OTP) — deve ser incluído.
  {
    id: "1600000000000",
    telefone: "(11) 90000-0001",
    numero: 3,
    total: 40,
    status: "cancelado",
    itens: ["1x Lanche X"],
  },
  // Pedido antigo de outro telefone — nunca deve aparecer para o cliente A.
  {
    id: "1600000000001",
    telefone: "11900000009",
    numero: 4,
    total: 30,
    status: "entregue",
    itens: ["1x Suco"],
  },
  // Pedido arquivado do cliente A — deve continuar aparecendo (histórico completo).
  {
    id: "1650000000000",
    clienteId: "cli_a",
    numero: 7,
    total: 45,
    status: "cancelado",
    isArchived: true,
    itens: ["1x Pizza P - Portuguesa"],
  },
  // Mesmo id repetido na fonte (anomalia defensiva) — nunca deve duplicar na resposta.
  {
    id: "1700000000000",
    clienteId: "cli_a",
    numero: 10,
    total: 55.9,
    status: "entregue",
    itens: ["1x Pizza G - Calabresa"],
  },
];

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn(async () => PEDIDOS_FIXTURE) },
}));

import { GET } from "./route";

function requestComCookie(token?: string, query = "") {
  const url = `http://localhost/api/cliente/pedidos${query}`;
  const init = token ? { headers: { cookie: `cliente-token=${token}` } } : undefined;
  return new NextRequest(url, init);
}

describe("GET /api/cliente/pedidos — autenticação", () => {
  test("sem cookie retorna 401", async () => {
    const res = await GET(requestComCookie());
    expect(res.status).toBe(401);
  });

  test("token inválido/adulterado retorna 401", async () => {
    const res = await GET(requestComCookie("token-adulterado"));
    expect(res.status).toBe(401);
  });

  test("token válido mas cliente inexistente no cadastro retorna 401", async () => {
    const res = await GET(requestComCookie("token-cliente-fantasma"));
    expect(res.status).toBe(401);
  });

  test("nunca aceita clienteId/telefone por query string para trocar de cliente", async () => {
    const res = await GET(requestComCookie("token-cliente-a", "?clienteId=cli_b&telefone=11900000002"));
    const body = await res.json();
    expect(res.status).toBe(200);
    // Mesmo com query maliciosa, só os pedidos do cliente A (do cookie) voltam.
    expect(body.pedidos.every((p: { id: string }) => ["1700000000000", "1600000000000", "1650000000000"].includes(p.id))).toBe(true);
    expect(body.pedidos.some((p: { id: string }) => p.id === "1700000000001")).toBe(false);
  });
});

describe("GET /api/cliente/pedidos — associação por clienteId e telefone verificado", () => {
  test("retorna só os pedidos do cliente autenticado (por clienteId)", async () => {
    const res = await GET(requestComCookie("token-cliente-b"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pedidos).toHaveLength(1);
    expect(body.pedidos[0].id).toBe("1700000000001");
  });

  test("inclui pedido antigo sem clienteId quando o telefone verificado coincide", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.pedidos.some((p: { id: string }) => p.id === "1600000000000")).toBe(true);
  });

  test("exclui pedidos com outro telefone (sem clienteId)", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    expect(body.pedidos.some((p: { id: string }) => p.id === "1600000000001")).toBe(false);
  });

  test("deduplica pedidos com o mesmo id (anomalia defensiva) e inclui ativos + arquivados", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    const ids = body.pedidos.map((p: { id: string }) => p.id);
    expect(ids.filter((id: string) => id === "1700000000000")).toHaveLength(1);
    expect(body.pedidos.some((p: { id: string; isArchived?: boolean }) => p.id === "1650000000000" && p.isArchived === true)).toBe(true);
  });

  test("não limita a cinco/dez pedidos — retorna o histórico completo do cliente", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    // Cliente A tem 3 pedidos únicos na fonte (1700000000000, 1600000000000, 1650000000000).
    expect(body.pedidos).toHaveLength(3);
  });

  test("ordena do mais novo para o mais antigo (timestamp numérico do id)", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    const ids = body.pedidos.map((p: { id: string }) => p.id);
    expect(ids).toEqual(["1700000000000", "1650000000000", "1600000000000"]);
  });
});

describe("GET /api/cliente/pedidos — sanitização (nunca vaza dado sensível)", () => {
  test("resposta nunca contém telefone, clienteId, tokens ou metadados de Pix", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain("11900000001");
    expect(texto).not.toContain("cli_a");
    expect(texto).not.toContain("clienteId");
    expect(texto).not.toContain("telefone");
    expect(texto).not.toContain("statusToken");
    expect(texto).not.toContain("acompanhamentoToken");
    expect(texto).not.toContain("segredo");
    expect(texto).not.toContain("pix");
  });

  test("mantém os campos públicos esperados no resumo", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    const body = await res.json();
    const p = body.pedidos.find((x: { id: string }) => x.id === "1700000000000");
    expect(p).toMatchObject({
      id: "1700000000000",
      numero: 10,
      cliente: "Ana",
      data: "10/01/2026",
      horario: "20:00",
      total: 55.9,
      status: "entregue",
      tipoEntrega: "delivery",
      pagamento: "Pix",
      bairro: "Centro",
    });
    expect(Array.isArray(p.itens)).toBe(true);
  });

  test("responde com Cache-Control: no-store", async () => {
    const res = await GET(requestComCookie("token-cliente-a"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
