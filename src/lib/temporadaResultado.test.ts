import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

type TemporadaMock = {
  temporadaId: string;
  tenantId: string;
  estado: "rascunho" | "ativa" | "encerrada";
  criadaEm: string;
  encerradaEm?: string;
  premioDescricao?: string;
  premioQuantidadePremiados?: number;
  premioAprovado?: boolean;
};

let temporadaMock: TemporadaMock | null = null;

vi.mock("./temporadas", () => ({
  obterTemporada: vi.fn(async () => temporadaMock),
}));

let rankingCompletoMock: Array<{ clienteId: string; score: number; posicao: number }> = [];

vi.mock("./rankingClientes", async () => {
  const actual = await vi.importActual<typeof import("./rankingClientes")>("./rankingClientes");
  return {
    ...actual,
    obterRankingCompleto: vi.fn(async () => rankingCompletoMock),
  };
});

let identidadesMock = new Map<string, { participaCampanha: boolean; nomePublico: string | null; telefoneMascarado: string | null; fotoPerfilUrl: null }>();

vi.mock("./rankingPrivacidade", () => ({
  projetarIdentidadesPublicasRanking: vi.fn(async (ids: string[]) => {
    const mapa = new Map<string, { participaCampanha: boolean; nomePublico: string | null; telefoneMascarado: string | null; fotoPerfilUrl: null }>();
    for (const id of ids) {
      mapa.set(id, identidadesMock.get(id) ?? { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null });
    }
    return mapa;
  }),
}));

import { garantirResultadoTemporada, obterResultadoTemporada, projetarResultadoTemporada } from "./temporadaResultado";

const TENANT = "default";
const TEMPORADA = "t2026-1";

beforeEach(() => {
  store.clear();
  temporadaMock = null;
  rankingCompletoMock = [];
  identidadesMock = new Map();
  vi.clearAllMocks();
});

describe("garantirResultadoTemporada", () => {
  test("retorna null quando a temporada não existe", async () => {
    expect(await garantirResultadoTemporada(TENANT, TEMPORADA)).toBeNull();
  });

  test("retorna null quando a temporada ainda não está encerrada", async () => {
    temporadaMock = { temporadaId: TEMPORADA, tenantId: TENANT, estado: "ativa", criadaEm: "2026-01-01T00:00:00.000Z" };
    expect(await garantirResultadoTemporada(TENANT, TEMPORADA)).toBeNull();
  });

  test("sem premioAprovado: arquiva o ranking mas nunca declara vencedor", async () => {
    temporadaMock = {
      temporadaId: TEMPORADA,
      tenantId: TENANT,
      estado: "encerrada",
      criadaEm: "2026-01-01T00:00:00.000Z",
      encerradaEm: "2026-09-25T00:00:00.000Z",
      // premioAprovado ausente — fail-closed.
      premioQuantidadePremiados: 3,
    };
    rankingCompletoMock = [
      { clienteId: "cli_a", score: 100, posicao: 1 },
      { clienteId: "cli_b", score: 80, posicao: 2 },
    ];
    identidadesMock.set("cli_a", { participaCampanha: true, nomePublico: "Ana", telefoneMascarado: "(11) 9••••-0001", fotoPerfilUrl: null });
    identidadesMock.set("cli_b", { participaCampanha: true, nomePublico: "Bia", telefoneMascarado: "(21) 9••••-0002", fotoPerfilUrl: null });

    const resultado = await garantirResultadoTemporada(TENANT, TEMPORADA);
    expect(resultado).not.toBeNull();
    expect(resultado!.vencedorDeclarado).toBe(false);
    expect(resultado!.premioAprovado).toBe(false);
    expect(resultado!.participantesTopo).toHaveLength(2);
  });

  test("sem premioQuantidadePremiados: arquiva mas não declara vencedor mesmo com premioAprovado", async () => {
    temporadaMock = {
      temporadaId: TEMPORADA,
      tenantId: TENANT,
      estado: "encerrada",
      criadaEm: "2026-01-01T00:00:00.000Z",
      premioAprovado: true,
      // premioQuantidadePremiados ausente — fail-closed, não inventa "1".
    };
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    identidadesMock.set("cli_a", { participaCampanha: true, nomePublico: "Ana", telefoneMascarado: null, fotoPerfilUrl: null });

    const resultado = await garantirResultadoTemporada(TENANT, TEMPORADA);
    expect(resultado!.vencedorDeclarado).toBe(false);
    expect(resultado!.premioQuantidadePremiados).toBeNull();
  });

  test("com premioAprovado e quantidade definidos, declara vencedor entre participantes", async () => {
    temporadaMock = {
      temporadaId: TEMPORADA,
      tenantId: TENANT,
      estado: "encerrada",
      criadaEm: "2026-01-01T00:00:00.000Z",
      encerradaEm: "2026-09-25T00:00:00.000Z",
      premioDescricao: "1 Pizza Família",
      premioQuantidadePremiados: 1,
      premioAprovado: true,
    };
    // 1º geral não participa; entre participantes, cli_b é o 1º colocado.
    rankingCompletoMock = [
      { clienteId: "nao_participa", score: 500, posicao: 1 },
      { clienteId: "cli_b", score: 80, posicao: 2 },
    ];
    identidadesMock.set("nao_participa", { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null });
    identidadesMock.set("cli_b", { participaCampanha: true, nomePublico: "Bia", telefoneMascarado: "(21) 9••••-0002", fotoPerfilUrl: null });

    const resultado = await garantirResultadoTemporada(TENANT, TEMPORADA);
    expect(resultado!.vencedorDeclarado).toBe(true);
    expect(resultado!.participantesTopo[0]).toMatchObject({ clienteId: "cli_b", posicao: 1 });

    const projetado = await projetarResultadoTemporada(resultado!);
    expect(projetado.vencedores).toHaveLength(1);
    expect(projetado.vencedores[0].identidade.nomePublico).toBe("Bia");
    // O não-participante nunca aparece no arquivo de vencedores.
    expect(JSON.stringify(projetado.vencedores)).not.toContain("nao_participa");
  });

  test("é idempotente: a segunda chamada não recalcula nem sobrescreve", async () => {
    temporadaMock = {
      temporadaId: TEMPORADA,
      tenantId: TENANT,
      estado: "encerrada",
      criadaEm: "2026-01-01T00:00:00.000Z",
      premioAprovado: true,
      premioQuantidadePremiados: 1,
    };
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    identidadesMock.set("cli_a", { participaCampanha: true, nomePublico: "Ana", telefoneMascarado: null, fotoPerfilUrl: null });

    const primeiro = await garantirResultadoTemporada(TENANT, TEMPORADA);

    // Muda o "estado do mundo" para provar que a segunda chamada não recalcula.
    rankingCompletoMock = [{ clienteId: "cli_a", score: 999, posicao: 1 }];
    const segundo = await garantirResultadoTemporada(TENANT, TEMPORADA);

    expect(segundo).toEqual(primeiro);
    expect(segundo!.participantesTopo[0].score).toBe(100);
  });

  test("mudar a config da temporada depois de encerrada não altera um resultado já gravado", async () => {
    temporadaMock = {
      temporadaId: TEMPORADA,
      tenantId: TENANT,
      estado: "encerrada",
      criadaEm: "2026-01-01T00:00:00.000Z",
      premioAprovado: true,
      premioQuantidadePremiados: 1,
    };
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    identidadesMock.set("cli_a", { participaCampanha: true, nomePublico: "Ana", telefoneMascarado: null, fotoPerfilUrl: null });
    await garantirResultadoTemporada(TENANT, TEMPORADA);

    // "Admin" tenta mudar a config depois — não deve afetar o já arquivado.
    temporadaMock = { ...temporadaMock, premioAprovado: false };
    const resultado = await garantirResultadoTemporada(TENANT, TEMPORADA);
    expect(resultado!.premioAprovado).toBe(true);
    expect(resultado!.vencedorDeclarado).toBe(true);
  });
});

describe("obterResultadoTemporada", () => {
  test("retorna null para parâmetros vazios ou sem resultado gravado", async () => {
    expect(await obterResultadoTemporada("", TEMPORADA)).toBeNull();
    expect(await obterResultadoTemporada(TENANT, "")).toBeNull();
    expect(await obterResultadoTemporada(TENANT, TEMPORADA)).toBeNull();
  });
});

describe("projetarResultadoTemporada", () => {
  test("identidade reflete o consentimento ATUAL, não o do momento do encerramento", async () => {
    temporadaMock = {
      temporadaId: TEMPORADA,
      tenantId: TENANT,
      estado: "encerrada",
      criadaEm: "2026-01-01T00:00:00.000Z",
      premioAprovado: true,
      premioQuantidadePremiados: 1,
    };
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    identidadesMock.set("cli_a", { participaCampanha: true, nomePublico: "Ana", telefoneMascarado: "(11) 9••••-0001", fotoPerfilUrl: null });
    const resultado = await garantirResultadoTemporada(TENANT, TEMPORADA);

    // Depois do encerramento, cli_a revoga o consentimento.
    identidadesMock.set("cli_a", { participaCampanha: false, nomePublico: null, telefoneMascarado: null, fotoPerfilUrl: null });
    const projetado = await projetarResultadoTemporada(resultado!);
    expect(projetado.participantesTopo[0].identidade.participaCampanha).toBe(false);
    expect(projetado.participantesTopo[0].identidade.nomePublico).toBeNull();
    // Vencedor não é mais exibível — mas a posição/score do resultado arquivado não muda.
    expect(projetado.participantesTopo[0].posicao).toBe(1);
    expect(projetado.participantesTopo[0].score).toBe(100);
  });
});
