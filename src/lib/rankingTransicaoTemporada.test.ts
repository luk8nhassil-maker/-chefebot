import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, listarTemporadasMock, obterResultadoTemporadaMock, obterConfigGamificacaoMock, creditarBonusMock, registrarFatoMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
  };
  return {
    store,
    redisMock,
    listarTemporadasMock: vi.fn(),
    obterResultadoTemporadaMock: vi.fn(),
    obterConfigGamificacaoMock: vi.fn(),
    creditarBonusMock: vi.fn(async () => "creditado" as const),
    registrarFatoMock: vi.fn(async () => true),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./temporadas", () => ({ listarTemporadas: listarTemporadasMock }));
vi.mock("./temporadaResultado", () => ({ obterResultadoTemporada: obterResultadoTemporadaMock }));
vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
vi.mock("./rankingBonusTemporada", () => ({ creditarBonusCompeticao: creditarBonusMock }));
vi.mock("./rankingGamificacaoFatos", () => ({ registrarFatoRankingGamificacao: registrarFatoMock }));

import {
  obterTemporadaAnteriorEncerrada,
  aplicarCarryoverClienteSeNecessario,
  sincronizarStatusSocialCliente,
  obterStatusSocialVigente,
} from "./rankingTransicaoTemporada";
import type { ConfigTemporada } from "./temporadas";

const TENANT = "default";

function temporada(overrides: Partial<ConfigTemporada> = {}): ConfigTemporada {
  return {
    temporadaId: "temp_2",
    tenantId: TENANT,
    estado: "ativa",
    criadaEm: "2026-02-01T00:00:00.000Z",
    ativadaEm: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  creditarBonusMock.mockResolvedValue("creditado");
  registrarFatoMock.mockResolvedValue(true);
});

describe("obterTemporadaAnteriorEncerrada", () => {
  test("encontra a temporada encerrada mais recente antes da ativação atual", async () => {
    listarTemporadasMock.mockResolvedValue([
      { temporadaId: "temp_0", estado: "encerrada", encerradaEm: "2026-01-01T00:00:00.000Z" },
      { temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" },
      { temporadaId: "temp_2", estado: "ativa" },
    ]);
    const atual = temporada();
    const anterior = await obterTemporadaAnteriorEncerrada(TENANT, atual);
    expect(anterior?.temporadaId).toBe("temp_1");
  });

  test("nunca escolhe a própria temporada atual", async () => {
    listarTemporadasMock.mockResolvedValue([temporada({ estado: "ativa" })]);
    expect(await obterTemporadaAnteriorEncerrada(TENANT, temporada())).toBeNull();
  });

  test("ignora temporadas encerradas DEPOIS da ativação atual (nunca escolhe o futuro)", async () => {
    listarTemporadasMock.mockResolvedValue([
      { temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-05-01T00:00:00.000Z" },
    ]);
    expect(await obterTemporadaAnteriorEncerrada(TENANT, temporada())).toBeNull();
  });

  test("sem temporada ativadaEm, retorna null (fail-closed)", async () => {
    expect(await obterTemporadaAnteriorEncerrada(TENANT, temporada({ ativadaEm: undefined }))).toBeNull();
  });
});

describe("aplicarCarryoverClienteSeNecessario", () => {
  const atual = temporada();

  test("sem config de carryover ativa, não credita nada", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: false, carryoverTabela: [] });
    await aplicarCarryoverClienteSeNecessario(TENANT, atual, "cli_a");
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("cliente no Top 10 da temporada anterior recebe o bônus configurado, com eventoId idempotente", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }] });
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: [{ clienteId: "cli_a", posicao: 1, score: 500 }] });

    await aplicarCarryoverClienteSeNecessario(TENANT, atual, "cli_a");

    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      temporadaId: "temp_2",
      clienteId: "cli_a",
      eventoId: "carryover:temp_1:temp_2:cli_a",
      tipo: "carryover",
      pontos: 100,
    }));
  });

  test("cliente fora do Top 10 anterior não recebe nada", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }] });
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: [{ clienteId: "cli_a", posicao: 1 }] });

    await aplicarCarryoverClienteSeNecessario(TENANT, atual, "cli_b");
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("posição sem linha configurada na tabela não credita (fail-closed)", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }] });
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: [{ clienteId: "cli_a", posicao: 5 }] });

    await aplicarCarryoverClienteSeNecessario(TENANT, atual, "cli_a");
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("sem temporada anterior, não credita nada", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }] });
    listarTemporadasMock.mockResolvedValue([]);
    await aplicarCarryoverClienteSeNecessario(TENANT, atual, "cli_a");
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });
});

describe("sincronizarStatusSocialCliente / obterStatusSocialVigente", () => {
  const atual = temporada();

  test("sem temporada anterior, retorna o status já salvo (ou null) sem recalcular", async () => {
    listarTemporadasMock.mockResolvedValue([]);
    const resultado = await sincronizarStatusSocialCliente(TENANT, atual, "cli_a");
    expect(resultado).toBeNull();
    expect(obterResultadoTemporadaMock).not.toHaveBeenCalled();
  });

  test("cliente #1 na temporada anterior vira Campeão e dispara o fato virou_campeao", async () => {
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: [{ clienteId: "cli_a", posicao: 1 }] });

    const resultado = await sincronizarStatusSocialCliente(TENANT, atual, "cli_a");
    expect(resultado).toEqual(expect.objectContaining({ status: "campeao", temporadaOrigemId: "temp_1" }));
    expect(registrarFatoMock).toHaveBeenCalledWith("virou_campeao", "cli_a:temp_1");
  });

  test("cliente fora do Top 10 anterior fica sem status (null), sem disparar o fato", async () => {
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: [{ clienteId: "cli_a", posicao: 1 }] });

    const resultado = await sincronizarStatusSocialCliente(TENANT, atual, "cli_b");
    expect(resultado).toEqual(expect.objectContaining({ status: null }));
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });

  test("mesma origem já sincronizada não recalcula (idempotente, no-op)", async () => {
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: [{ clienteId: "cli_a", posicao: 1 }] });

    await sincronizarStatusSocialCliente(TENANT, atual, "cli_a");
    obterResultadoTemporadaMock.mockClear();
    registrarFatoMock.mockClear();

    const resultado = await sincronizarStatusSocialCliente(TENANT, atual, "cli_a");
    expect(resultado?.status).toBe("campeao");
    expect(obterResultadoTemporadaMock).not.toHaveBeenCalled();
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });

  test("obterStatusSocialVigente lê o que já foi persistido", async () => {
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: [{ clienteId: "cli_a", posicao: 2 }] });
    await sincronizarStatusSocialCliente(TENANT, atual, "cli_a");
    expect((await obterStatusSocialVigente(TENANT, "cli_a"))?.status).toBe("prata");
  });
});
