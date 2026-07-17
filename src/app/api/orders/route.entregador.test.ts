import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  store,
  redisMock,
  enviarMock,
  criarTicketMock,
  invalidarTicketMock,
} = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    },
    enviarMock: vi.fn(async () => ({ ok: true as const })),
    criarTicketMock: vi.fn(async () => ({ ticket: "ticket-opaco-teste", expiraEm: "2099-01-01T00:00:00.000Z" })),
    invalidarTicketMock: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/auth", () => ({
  verifyToken: vi.fn(async () => ({ username: "admin", name: "Admin", role: "admin" })),
}));
vi.mock("@/lib/pedidoEdicao", () => ({
  adquirirMutexEdicao: vi.fn(async () => "mutex"),
  liberarMutexEdicao: vi.fn(async () => undefined),
  lockEdicaoAtivo: vi.fn(() => false),
  limparEdicaoExpiradaSeNecessario: vi.fn((pedido: unknown) => ({ pedido, mudou: false })),
  sanitizarPedidoParaPainel: vi.fn((pedido: unknown) => pedido),
}));
vi.mock("@/lib/fidelidade", () => ({
  creditarFidelidadePedido: vi.fn(async () => undefined),
  creditarPontosPedidoEntregue: vi.fn(async () => undefined),
  calcularPontosElegiveisPedido: vi.fn(() => 0),
  registrarMovimentoPontosIdempotente: vi.fn(async () => undefined),
  construirEventoIdPontos: vi.fn(() => "evento"),
  obterExtratoPontos: vi.fn(async () => []),
  derivarClienteIdPorTelefone: vi.fn(() => null),
  reverterResgateConfirmado: vi.fn(async () => undefined),
}));
vi.mock("@/lib/evolutionApi", () => ({
  obterConfigEvolution: vi.fn(() => ({
    baseUrl: "https://evolution.test",
    apiKey: "key",
    instanceName: "chefebot",
    webhookUrl: "https://x.test/api/whatsapp",
  })),
}));
vi.mock("@/lib/whatsappMensagem", () => ({ enviarTextoWhatsApp: enviarMock }));
vi.mock("@/lib/entregadorAuth", () => ({
  criarTicketAcessoEntregador: criarTicketMock,
  invalidarTicketAcesso: invalidarTicketMock,
  montarLinkAcessoEntregador: (ticket: string) => `https://chefebot-pjif.vercel.app/entregador?acesso=${ticket}`,
  normalizarTelefoneEntregador: (telefone: string) => `55${telefone.replace(/\D/g, "")}`,
}));

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

import { PATCH } from "./route";

const entregadorCadastrado = {
  id: "ent-1",
  nome: "Rafael",
  telefone: "86999990000",
  ativo: true,
};

function seed() {
  store.set("entregadores", [entregadorCadastrado]);
  store.set("pedidos", [{
    id: "ped-1",
    cliente: "Cliente",
    telefone: "86988880000",
    itens: ["Pizza"],
    total: 50,
    status: "em_preparo",
    horario: "12:00",
    endereco: "Rua 1",
  }]);
}

function request(entregador = { id: "ent-1", nome: "Falso", telefone: "11999999999", ativo: true }) {
  return new NextRequest("https://x.test/api/orders", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: "auth-token=admin" },
    body: JSON.stringify({ id: "ped-1", status: "saiu_entrega", entregador }),
  });
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  enviarMock.mockResolvedValue({ ok: true });
  seed();
});

describe("PATCH /api/orders — acesso seguro do entregador", () => {
  it("usa cadastro canônico, envia ticket opaco e nunca devolve o ticket", async () => {
    const res = await PATCH(request());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(enviarMock).toHaveBeenCalledTimes(1);
    expect(enviarMock.mock.calls[0][0]).toBe("5586999990000");
    expect(enviarMock.mock.calls[0][0]).not.toContain("11999999999");
    expect(enviarMock.mock.calls[0][1]).toContain("/entregador?acesso=ticket-opaco-teste");
    expect(enviarMock.mock.calls[0][1]).not.toContain("/entregador?id=");
    expect(JSON.stringify(data)).not.toContain("ticket-opaco-teste");

    const pedidos = store.get("pedidos") as Array<{ entregador: typeof entregadorCadastrado }>;
    expect(pedidos[0].entregador).toEqual(entregadorCadastrado);
    const fila = store.get("entregador:pedidos:ent-1") as Array<{ entregadorTelefone: string }>;
    expect(fila[0].entregadorTelefone).toBe(entregadorCadastrado.telefone);
  });

  it("falha do WhatsApp preserva atribuição e retorna aviso operacional claro", async () => {
    enviarMock.mockResolvedValue({ ok: false, motivo: "http_500" });
    const res = await PATCH(request());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("saiu_entrega");
    expect(data.avisoOperacional).toContain("acesso seguro");
    expect(invalidarTicketMock).toHaveBeenCalledWith("ticket-opaco-teste");
    expect((store.get("pedidos") as Array<{ status: string }>)[0].status).toBe("saiu_entrega");
  });

  it("entregador inativo é rejeitado antes de salvar a atribuição", async () => {
    store.set("entregadores", [{ ...entregadorCadastrado, ativo: false }]);
    const res = await PATCH(request());
    expect(res.status).toBe(409);
    const pedido = (store.get("pedidos") as Array<{ status: string; entregador?: unknown }>)[0];
    expect(pedido.status).toBe("em_preparo");
    expect(pedido.entregador).toBeUndefined();
    expect(enviarMock).not.toHaveBeenCalled();
  });
});
