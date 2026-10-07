import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { lerSessao, preferencias, ativas, participacao, regraJogo, ativar, registrar, revogarTodos, historico } = vi.hoisted(() => ({
  lerSessao: vi.fn(),
  preferencias: vi.fn(),
  ativas: vi.fn(),
  participacao: vi.fn(),
  regraJogo: vi.fn(),
  ativar: vi.fn(),
  registrar: vi.fn(),
  revogarTodos: vi.fn(),
  historico: vi.fn(),
}));

vi.mock("@/lib/clienteAuth", () => ({ lerSessaoCliente: lerSessao }));
vi.mock("@/lib/consentimentoRanking", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consentimentoRanking")>("@/lib/consentimentoRanking");
  return {
    ...actual,
    obterPreferenciasConsentimentoRanking: preferencias,
    obterFinalidadesAtivasRanking: ativas,
    obterParticipacaoRanking: participacao,
    obterRegraJogoSecretoRanking: regraJogo,
    registrarParticipacaoRanking: ativar,
    registrarConsentimentoRanking: registrar,
    revogarTodosConsentimentosRanking: revogarTodos,
    obterHistoricoConsentimentoRanking: historico,
  };
});
import { DELETE, GET, PATCH, POST } from "./route";
import { ErroConsentimentoRanking } from "@/lib/consentimentoRanking";

function req(method = "GET", body?: unknown, query = "") {
  return new NextRequest(`http://localhost/api/cliente/privacidade/ranking${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  lerSessao.mockResolvedValue({ clienteId: "cli_5511999990000", telefone: "5511999990000" });
  preferencias.mockResolvedValue([{ finalidade: "ranking_primeiro_nome", estado: "revogado" }]);
  ativas.mockResolvedValue(new Set());
  participacao.mockImplementation(async () => (await ativas()).size > 0);
  regraJogo.mockResolvedValue({ participa: false, aceitaRevelacao30d: false, regraJogoVersao: null });
  ativar.mockImplementation(async (_id: string, ativo: boolean, opcoes?: { aceitaRevelacao30d?: boolean }) => {
    participacao.mockResolvedValue(ativo);
    regraJogo.mockResolvedValue({
      participa: ativo,
      aceitaRevelacao30d: ativo && opcoes?.aceitaRevelacao30d === true,
      regraJogoVersao: ativo && opcoes?.aceitaRevelacao30d === true ? "ranking-jogo-secreto-v1" : null,
    });
  });
  historico.mockResolvedValue({ eventos: [], proximoOffset: null });
  registrar.mockResolvedValue({ estado: "concedido" });
  revogarTodos.mockResolvedValue([]);
});

describe("/api/cliente/privacidade/ranking", () => {
  test("exige sessao em todos os metodos", async () => {
    lerSessao.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req("POST"))).status).toBe(401);
    expect((await PATCH(req("PATCH", { finalidade: "ranking_primeiro_nome", estado: "revogado" }))).status).toBe(401);
    expect((await DELETE(req("DELETE"))).status).toBe(401);
  });

  test("GET e privado, no-store e so inclui historico quando solicitado", async () => {
    const res = await GET(req("GET", undefined, "?historico=1&offset=50"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(historico).toHaveBeenCalledWith("cli_5511999990000", 50, 50);
  });

  test("GET devolve participacao efetiva, nunca infere apenas pelo estado bruto salvo", async () => {
    preferencias.mockResolvedValueOnce([{ finalidade: "ranking_primeiro_nome", estado: "concedido", textoVersao: "antiga" }]);
    ativas.mockResolvedValueOnce(new Set());
    const inativo = await GET(req());
    expect(await inativo.json()).toMatchObject({ participaCampanha: false });

    preferencias.mockResolvedValueOnce([{ finalidade: "ranking_primeiro_nome", estado: "concedido", textoVersao: "atual" }]);
    ativas.mockResolvedValueOnce(new Set(["ranking_primeiro_nome"]));
    regraJogo.mockResolvedValueOnce({ participa: true, aceitaRevelacao30d: true, regraJogoVersao: "ranking-jogo-secreto-v1" });
    const ativo = await GET(req());
    expect(await ativo.json()).toMatchObject({
      participaCampanha: true,
      regraJogo: { versao: "ranking-jogo-secreto-v1", aceitaRevelacao30d: true, diasRevelacao: 30 },
    });
  });

  test("POST exige aceite explícito da regra de revelação", async () => {
    const semAceite = await POST(req("POST", {}));
    expect(semAceite.status).toBe(400);
    expect(await semAceite.json()).toMatchObject({ error: "regra_jogo_nao_aceita" });
    expect(ativar).not.toHaveBeenCalled();
  });

  test("POST ativa só o cliente autenticado com regra V2, sem conceder PII opcional", async () => {
    const res = await POST(req("POST", { aceitaRegraRevelacao30d: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      participaCampanha: true,
      regraJogo: {
        versao: "ranking-jogo-secreto-v1",
        aceitaRevelacao30d: true,
        diasRevelacao: 30,
      },
    });
    expect(ativar).toHaveBeenCalledWith("cli_5511999990000", true, { aceitaRevelacao30d: true });
    expect(registrar).not.toHaveBeenCalled();
  });

  test("PATCH usa apenas o cliente autenticado e a origem fica no servidor", async () => {
    participacao.mockResolvedValueOnce(true);
    const res = await PATCH(req("PATCH", {
      clienteId: "cli_de_outro_cliente",
      origem: "forjada",
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersao: "dpo-v1",
    }));
    expect(res.status).toBe(200);
    expect(registrar).toHaveBeenCalledWith({
      clienteId: "cli_5511999990000",
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersaoInformada: "dpo-v1",
    });
  });

  test("concessao de foto sem fonte oficial responde conflito", async () => {
    participacao.mockResolvedValueOnce(true);
    registrar.mockRejectedValueOnce(new ErroConsentimentoRanking("fonte_oficial_indisponivel"));
    const res = await PATCH(req("PATCH", {
      finalidade: "ranking_foto_perfil",
      estado: "concedido",
      textoVersao: "dpo-v1",
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "fonte_oficial_indisponivel" });
  });

  test("não transforma autorização de PII em ativação implícita do jogo", async () => {
    participacao.mockResolvedValueOnce(false);
    const res = await PATCH(req("PATCH", { finalidade: "ranking_primeiro_nome", estado: "concedido", textoVersao: "dpo-v1" }));
    expect(res.status).toBe(409);
    expect(registrar).not.toHaveBeenCalled();
  });

  test("DELETE revoga tudo, preservando a semantica separada de eliminacao", async () => {
    const res = await DELETE(req("DELETE"));
    expect(res.status).toBe(200);
    expect(revogarTodos).toHaveBeenCalledWith("cli_5511999990000");
  });
});
