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
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
  return {
    store,
    redisMock,
    listarTemporadasMock: vi.fn(),
    obterResultadoTemporadaMock: vi.fn(),
    obterConfigGamificacaoMock: vi.fn(),
    creditarBonusMock: vi.fn(async (_params: { clienteId: string }) => "creditado" as const),
    registrarFatoMock: vi.fn(async () => true),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./temporadas", () => ({ listarTemporadas: listarTemporadasMock }));
vi.mock("./temporadaResultado", () => ({ obterResultadoTemporada: obterResultadoTemporadaMock }));
vi.mock("./rankingGamificacaoConfig", () => ({ obterConfigGamificacao: obterConfigGamificacaoMock }));
vi.mock("./rankingBonusTemporada", () => ({ creditarBonusCompeticao: creditarBonusMock }));
vi.mock("./rankingGamificacaoFatos", () => ({ registrarFatoRankingGamificacao: registrarFatoMock }));
vi.mock("./rankingScoreTemporadaSync", () => ({ sincronizarScoreTemporadaComBonus: vi.fn(async () => undefined) }));

import {
  obterTemporadaAnteriorEncerrada,
  aplicarCarryoverClienteSeNecessario,
  sincronizarStatusSocialCliente,
  obterStatusSocialVigente,
  reconciliarTransicaoTemporada,
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

describe("reconciliarTransicaoTemporada (blocker: independente do login do Top 10)", () => {
  const atual = temporada();
  const TOP10 = Array.from({ length: 10 }, (_, i) => ({ clienteId: `cli_${i + 1}`, posicao: i + 1, score: 1000 - i }));

  test("reconcilia carryover E status social de TODO o Top 10 numa única chamada, sem nenhum deles ter 'logado'", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }, { posicao: 2, bonus: 60 }] });
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: TOP10 });

    await reconciliarTransicaoTemporada(TENANT, atual);

    // #1 e #2 têm bônus configurado — os dois foram creditados sem que
    // "cli_1"/"cli_2" tivessem feito nenhuma chamada própria.
    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "cli_1", pontos: 100 }));
    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "cli_2", pontos: 60 }));
    // Status social também sincronizado para todo o Top 10.
    expect((await obterStatusSocialVigente(TENANT, "cli_1"))?.status).toBe("campeao");
    expect((await obterStatusSocialVigente(TENANT, "cli_3"))?.status).toBe("bronze");
    expect((await obterStatusSocialVigente(TENANT, "cli_10"))?.status).toBe("elite");
  });

  test("idempotente: uma segunda chamada não reprocessa o Top 10 de novo (marca já existe)", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }] });
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: TOP10 });

    await reconciliarTransicaoTemporada(TENANT, atual);
    obterResultadoTemporadaMock.mockClear();
    creditarBonusMock.mockClear();

    await reconciliarTransicaoTemporada(TENANT, atual);
    expect(obterResultadoTemporadaMock).not.toHaveBeenCalled();
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("sem temporada anterior, não faz nada", async () => {
    listarTemporadasMock.mockResolvedValue([]);
    await reconciliarTransicaoTemporada(TENANT, atual);
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });

  test("sem resultado arquivado ainda (corrida na ativação), solta a marca para a PRÓXIMA leitura tentar de novo", async () => {
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValueOnce(null);

    await reconciliarTransicaoTemporada(TENANT, atual);
    expect(creditarBonusMock).not.toHaveBeenCalled();

    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }] });
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: TOP10 });
    await reconciliarTransicaoTemporada(TENANT, atual);
    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "cli_1", pontos: 100 }));
  });

  test("dois workers concorrentes reconciliando a mesma transição: só um processa o laço", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }] });
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: TOP10 });

    await Promise.all([
      reconciliarTransicaoTemporada(TENANT, atual),
      reconciliarTransicaoTemporada(TENANT, atual),
    ]);

    // A marca (SET NX) garante que só UM dos dois workers processa o laço
    // inteiro — o outro vê a marca já existente e nem lê o resultado.
    const chamadasParaCli1 = creditarBonusMock.mock.calls.filter((c) => (c[0] as { clienteId: string }).clienteId === "cli_1");
    expect(chamadasParaCli1).toHaveLength(1);
  });

  test("BLOCKER: crash abrupto no meio do laço (marca 'em andamento' presa) nunca deixa o Top 10 travado para sempre — TTL libera o próximo worker a completar", async () => {
    obterConfigGamificacaoMock.mockResolvedValue({ carryoverAtivo: true, carryoverTabela: [{ posicao: 1, bonus: 100 }, { posicao: 2, bonus: 60 }] });
    listarTemporadasMock.mockResolvedValue([{ temporadaId: "temp_1", estado: "encerrada", encerradaEm: "2026-01-31T00:00:00.000Z" }]);
    obterResultadoTemporadaMock.mockResolvedValue({ participantesTopo: TOP10 });

    // Simula um worker anterior que morreu (SIGKILL/container encerrado) no
    // meio do laço, DEPOIS de marcar "em andamento" mas SEM nunca rodar seu
    // catch/finally — a marca ficaria presa no Redis real até o TTL expirar.
    store.set(`ranking:reconciliacao:andamento:${TENANT}:temp_1:temp_2`, true);

    // Enquanto a marca (TTL) ainda vale, um novo gatilho nunca reprocessa —
    // isso é o comportamento normal de exclusão mútua, não o bug.
    await reconciliarTransicaoTemporada(TENANT, atual);
    expect(creditarBonusMock).not.toHaveBeenCalled();
    expect(await obterStatusSocialVigente(TENANT, "cli_1")).toBeNull();

    // TTL expira de verdade no Redis (aqui, simulado apagando a marca) — o
    // PRÓXIMO gatilho (de QUALQUER cliente) precisa completar o Top 10
    // inteiro, nunca ficar parcialmente reconciliado para sempre.
    store.delete(`ranking:reconciliacao:andamento:${TENANT}:temp_1:temp_2`);
    await reconciliarTransicaoTemporada(TENANT, atual);

    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "cli_1", pontos: 100 }));
    expect(creditarBonusMock).toHaveBeenCalledWith(expect.objectContaining({ clienteId: "cli_2", pontos: 60 }));
    expect((await obterStatusSocialVigente(TENANT, "cli_10"))?.status).toBe("elite");
    // Só agora, com o Top 10 inteiro reconciliado, a marca "concluída" existe.
    expect(store.get(`ranking:reconciliacao:concluida:${TENANT}:temp_1:temp_2`)).toBe(true);

    // E uma terceira chamada depois disso é idempotente (nunca reprocessa).
    creditarBonusMock.mockClear();
    await reconciliarTransicaoTemporada(TENANT, atual);
    expect(creditarBonusMock).not.toHaveBeenCalled();
  });
});
