import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  sessao: vi.fn(),
  cliente: vi.fn(),
  derivar: vi.fn(),
  token: vi.fn(),
  resolver: vi.fn(),
  candidatura: vi.fn(),
  divulgacao: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({ lerSessaoCliente: mocks.sessao }));
vi.mock("@/lib/clientes", () => ({ buscarClientePorId: mocks.cliente }));
vi.mock("@/lib/fidelidade", () => ({ derivarClienteIdPorTelefone: mocks.derivar }));
vi.mock("@/lib/indicacaoToken", () => ({
  obterOuCriarTokenIndicacao: mocks.token,
  resolverTokenIndicacao: mocks.resolver,
  salvarCandidaturaIndicacao: mocks.candidatura,
}));
vi.mock("@/lib/rankingMissaoDivulgacaoDiaria", () => ({
  creditarMissaoDivulgacaoDiaria: mocks.divulgacao,
}));

import { GET, POST } from "./route";

function req(method: "GET" | "POST", body?: unknown) {
  return new NextRequest("https://chefedapizza.com.br/api/cliente/indicacao", {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessao.mockResolvedValue({ clienteId: "perfil_indicado" });
  mocks.cliente.mockResolvedValue({ clienteId: "perfil_indicado", telefone: "5599999990002" });
  mocks.derivar.mockReturnValue("cli_indicado");
  mocks.token.mockResolvedValue("tok_abc");
  mocks.resolver.mockResolvedValue("cli_indicador");
  mocks.candidatura.mockResolvedValue("registrado");
  mocks.divulgacao.mockResolvedValue({ status: "creditado", pontos: 3, temporadaId: "temp_1" });
});

describe("/api/cliente/indicacao", () => {
  test("GET mantém token opaco do fluxo existente", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "tok_abc" });
    expect(mocks.token).toHaveBeenCalledWith("cli_indicado");
  });

  test("candidatura nova tenta bônus diário depois de salvar a origem", async () => {
    const res = await POST(req("POST", { ref: "tok_ref" }));
    expect(res.status).toBe(200);
    expect(mocks.candidatura).toHaveBeenCalledWith("cli_indicado", "cli_indicador");
    expect(mocks.divulgacao).toHaveBeenCalledWith({
      indicadorId: "cli_indicador",
      indicadoId: "cli_indicado",
    });
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "registrado",
      missaoDivulgacao: { status: "creditado", pontos: 3 },
    });
  });

  test("candidatura já existente não tenta pagar bônus de novo", async () => {
    mocks.candidatura.mockResolvedValue("ja_existe");
    const body = await (await POST(req("POST", { ref: "tok_ref" }))).json();
    expect(body.status).toBe("ja_existe");
    expect(body.missaoDivulgacao).toBeNull();
    expect(mocks.divulgacao).not.toHaveBeenCalled();
  });

  test("falha no bônus nunca desfaz a candidatura", async () => {
    mocks.divulgacao.mockRejectedValue(new Error("temporario"));
    const res = await POST(req("POST", { ref: "tok_ref" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("registrado");
    expect(body.missaoDivulgacao).toEqual({ status: "indisponivel", pontos: 0 });
  });

  test("self-referral continua bloqueado antes da missão", async () => {
    mocks.candidatura.mockResolvedValue("self_referral");
    const res = await POST(req("POST", { ref: "tok_ref" }));
    expect(res.status).toBe(400);
    expect(mocks.divulgacao).not.toHaveBeenCalled();
  });
});
