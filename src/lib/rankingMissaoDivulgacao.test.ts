import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  config: vi.fn(),
  temporadaAtiva: vi.fn(),
  temporada: vi.fn(),
  participa: vi.fn(),
  extrato: vi.fn(),
  refToken: vi.fn(),
  movimentos: vi.fn(),
  creditar: vi.fn(),
  sync: vi.fn(),
  expediente: vi.fn(),
}));

vi.mock("./redis", () => ({ redis: { get: mocks.redisGet, set: mocks.redisSet } }));
vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: mocks.config }));
vi.mock("./temporadas", () => ({
  obterTemporadaAtiva: mocks.temporadaAtiva,
  obterTemporada: mocks.temporada,
}));
vi.mock("./consentimentoRanking", () => ({ obterParticipacaoRanking: mocks.participa }));
vi.mock("./fidelidade", () => ({
  obterExtratoPontos: mocks.extrato,
  classificarOrigemMovimentoPontos: () => "pedido",
}));
vi.mock("./indicacaoToken", () => ({ obterOuCriarTokenIndicacao: mocks.refToken }));
vi.mock("./rankingBonusTemporada", () => ({
  obterMovimentosBonusTemporada: mocks.movimentos,
  creditarBonusCompeticao: mocks.creditar,
}));
vi.mock("./rankingScoreTemporadaSync", () => ({ sincronizarScoreTemporadaComBonus: mocks.sync }));
vi.mock("./expedienteOperacional", () => ({ chaveExpedienteOperacional: mocks.expediente }));

import {
  confirmarAberturaConviteDivulgacao,
  obterEstadoMissaoDivulgacao,
  obterOuCriarConviteDivulgacao,
  resolverConviteDivulgacao,
} from "./rankingMissaoDivulgacao";

const pedidoConfirmado = [{
  tipo: "confirmado",
  pedidoId: "pedido_1",
  eventoId: "confirmado:pedido_1",
}];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockResolvedValue({ missaoDivulgacaoAtiva: true, missaoDivulgacaoBonus: 3 });
  mocks.temporadaAtiva.mockResolvedValue({
    temporadaId: "temp_1",
    estado: "ativa",
    premioAprovado: true,
    premioDescricao: "1 Pizza Família",
  });
  mocks.temporada.mockResolvedValue({ temporadaId: "temp_1", estado: "ativa" });
  mocks.participa.mockResolvedValue(true);
  mocks.extrato.mockResolvedValue(pedidoConfirmado);
  mocks.refToken.mockResolvedValue("abcdefghijklmnopqrstuvwx");
  mocks.movimentos.mockResolvedValue([]);
  mocks.creditar.mockResolvedValue("creditado");
  mocks.sync.mockResolvedValue(undefined);
  mocks.expediente.mockReturnValue("2026-10-07");
  mocks.redisGet.mockResolvedValue(null);
  mocks.redisSet.mockResolvedValue("OK");
});

describe("missão diária de divulgação", () => {
  test("nasce fail-closed quando o admin não ativou", async () => {
    mocks.config.mockResolvedValue({ missaoDivulgacaoAtiva: false, missaoDivulgacaoBonus: 3 });
    const estado = await obterEstadoMissaoDivulgacao({ tenantId: "default", clienteId: "cli_1" });
    expect(estado).toMatchObject({ ativa: false, elegivel: false, bonus: 0, motivoBloqueio: "desligada" });
    expect(mocks.extrato).not.toHaveBeenCalled();
  });

  test("bloqueia quem ainda não fez pedido confirmado", async () => {
    mocks.extrato.mockResolvedValue([]);
    const estado = await obterEstadoMissaoDivulgacao({ tenantId: "default", clienteId: "cli_1" });
    expect(estado).toMatchObject({ ativa: true, elegivel: false, motivoBloqueio: "sem_pedido_confirmado" });
  });

  test("detecta bônus já confirmado no mesmo expediente", async () => {
    mocks.movimentos.mockResolvedValue([{
      tipo: "missao_divulgacao_diaria",
      eventoId: "missao_divulgacao_diaria:2026-10-07",
      pontos: 3,
    }]);
    const estado = await obterEstadoMissaoDivulgacao({ tenantId: "default", clienteId: "cli_1" });
    expect(estado.concluidaHoje).toBe(true);
  });

  test("gera um token diário e preserva o token oficial de indicação", async () => {
    const convite = await obterOuCriarConviteDivulgacao({ tenantId: "default", clienteId: "cli_1" });
    expect(convite.estado.elegivel).toBe(true);
    expect(convite.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(convite.refToken).toBe("abcdefghijklmnopqrstuvwx");
    expect(convite.premioDescricao).toBe("1 Pizza Família");
    expect(mocks.redisSet).toHaveBeenCalledTimes(2);
  });

  test("reutiliza o mesmo token do dia", async () => {
    const payload = {
      tenantId: "default",
      temporadaId: "temp_1",
      clienteId: "cli_1",
      expedienteId: "2026-10-07",
      refToken: "abcdefghijklmnopqrstuvwx",
      criadoEm: "2026-10-07T12:00:00.000Z",
    };
    mocks.redisGet
      .mockResolvedValueOnce("ABCDEFGHIJKLMNOPQRSTUVWX")
      .mockResolvedValueOnce(payload);
    const convite = await obterOuCriarConviteDivulgacao({ tenantId: "default", clienteId: "cli_1" });
    expect(convite.token).toBe("ABCDEFGHIJKLMNOPQRSTUVWX");
    expect(mocks.redisSet).not.toHaveBeenCalled();
  });

  test("abrir o próprio link autenticado não credita", async () => {
    const payload = {
      tenantId: "default", temporadaId: "temp_1", clienteId: "cli_1",
      expedienteId: "2026-10-07", refToken: "abcdefghijklmnopqrstuvwx", criadoEm: "x",
    };
    mocks.redisGet.mockResolvedValue(payload);
    const resultado = await confirmarAberturaConviteDivulgacao({
      token: "ABCDEFGHIJKLMNOPQRSTUVWX",
      visitanteClienteId: "cli_1",
    });
    expect(resultado.bonus).toBe("self_open");
    expect(mocks.creditar).not.toHaveBeenCalled();
  });

  test("abertura de outra pessoa credita no máximo pelo evento diário idempotente", async () => {
    const payload = {
      tenantId: "default", temporadaId: "temp_1", clienteId: "cli_1",
      expedienteId: "2026-10-07", refToken: "abcdefghijklmnopqrstuvwx", criadoEm: "x",
    };
    mocks.redisGet.mockResolvedValue(payload);
    const resultado = await confirmarAberturaConviteDivulgacao({
      token: "ABCDEFGHIJKLMNOPQRSTUVWX",
      visitanteClienteId: "cli_2",
    });
    expect(resultado).toEqual({
      valido: true,
      refToken: "abcdefghijklmnopqrstuvwx",
      bonus: "creditado",
    });
    expect(mocks.creditar).toHaveBeenCalledWith(expect.objectContaining({
      clienteId: "cli_1",
      eventoId: "missao_divulgacao_diaria:2026-10-07",
      tipo: "missao_divulgacao_diaria",
      pontos: 3,
    }));
    expect(mocks.sync).toHaveBeenCalledWith("default", "temp_1", "cli_1");

    mocks.creditar.mockResolvedValueOnce("ja_creditado");
    const repetido = await confirmarAberturaConviteDivulgacao({
      token: "ABCDEFGHIJKLMNOPQRSTUVWX",
      visitanteClienteId: "cli_3",
    });
    expect(repetido.bonus).toBe("ja_creditado");
  });

  test("token malformado nunca resolve", async () => {
    expect(await resolverConviteDivulgacao("invalido")).toBeNull();
    expect(mocks.redisGet).not.toHaveBeenCalled();
  });
});
