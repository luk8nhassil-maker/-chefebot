import { beforeEach, describe, expect, test, vi } from "vitest";

const { ativas, buscarCliente, participacao } = vi.hoisted(() => ({
  ativas: new Set<string>(),
  buscarCliente: vi.fn(),
  participacao: { ativa: null as boolean | null },
}));

vi.mock("./consentimentoRanking", () => ({
  obterFinalidadesAtivasRanking: vi.fn(async () => new Set(ativas)),
  obterFinalidadesAtivasRankingParaClientes: vi.fn(async (clienteIds: string[]) =>
    new Map(clienteIds.map((clienteId) => [clienteId, new Set(ativas)])),
  ),
  obterParticipacaoRanking: vi.fn(async () => participacao.ativa ?? (ativas.has("ranking_primeiro_nome") || ativas.has("ranking_telefone_mascarado"))),
  obterParticipacaoRankingParaClientes: vi.fn(async (clienteIds: string[]) =>
    new Map(clienteIds.map((clienteId) => [clienteId, participacao.ativa ?? (ativas.has("ranking_primeiro_nome") || ativas.has("ranking_telefone_mascarado"))])),
  ),
}));

vi.mock("./clientes", async () => {
  const actual = await vi.importActual<typeof import("./clientes")>("./clientes");
  return { ...actual, buscarClientePorId: buscarCliente };
});

import { projetarIdentidadePublicaRanking } from "./rankingPrivacidade";

beforeEach(() => {
  ativas.clear();
  participacao.ativa = null;
  buscarCliente.mockReset();
  buscarCliente.mockResolvedValue({
    clienteId: "cli_5511998765432",
    telefone: "5511998765432",
    nome: "  Ana   Maria  ",
  });
});

describe("projecao publica do ranking", () => {
  test("nao consulta perfil e retorna anonimo sem consentimento", async () => {
    await expect(projetarIdentidadePublicaRanking("cli_5511998765432")).resolves.toEqual({
      participaCampanha: false,
      nomePublico: null,
      telefoneMascarado: null,
      fotoPerfilUrl: null,
    });
    expect(buscarCliente).not.toHaveBeenCalled();
  });

  test("libera somente o primeiro nome quando essa finalidade esta ativa", async () => {
    ativas.add("ranking_primeiro_nome");
    await expect(projetarIdentidadePublicaRanking("cli_5511998765432")).resolves.toEqual({
      participaCampanha: true,
      nomePublico: "Ana",
      telefoneMascarado: null,
      fotoPerfilUrl: null,
    });
  });

  test("cliente ativa a disputa anonimamente, sem consultar nem expor perfil", async () => {
    participacao.ativa = true;
    await expect(projetarIdentidadePublicaRanking("cli_5511998765432")).resolves.toEqual({
      participaCampanha: true, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null,
    });
    expect(buscarCliente).not.toHaveBeenCalled();
  });

  test("saida explicita prevalece sobre autorizacoes legadas ainda existentes", async () => {
    participacao.ativa = false;
    ativas.add("ranking_primeiro_nome");
    await expect(projetarIdentidadePublicaRanking("cli_5511998765432")).resolves.toMatchObject({ participaCampanha: false, nomePublico: null });
  });

  test("mascara telefone no servidor e nunca libera foto", async () => {
    ativas.add("ranking_telefone_mascarado");
    ativas.add("ranking_foto_perfil");
    const identidade = await projetarIdentidadePublicaRanking("cli_5511998765432");
    expect(identidade.telefoneMascarado).toBe("(11) 9••••-5432");
    expect(identidade.telefoneMascarado).not.toContain("98765432");
    expect(identidade.fotoPerfilUrl).toBeNull();
  });

  test("falha de dependencia resulta em anonimizacao, nao em exposicao", async () => {
    ativas.add("ranking_primeiro_nome");
    buscarCliente.mockRejectedValueOnce(new Error("redis indisponivel"));
    await expect(projetarIdentidadePublicaRanking("cli_5511998765432")).resolves.toEqual({
      participaCampanha: false,
      nomePublico: null,
      telefoneMascarado: null,
      fotoPerfilUrl: null,
    });
  });
});
