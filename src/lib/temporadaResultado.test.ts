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

let regrasMock = new Map<string, { participa: boolean; aceitaRevelacao30d: boolean }>();
vi.mock("./consentimentoRanking", () => ({
  obterRegrasJogoSecretoParaClientes: vi.fn(async (ids: string[]) =>
    new Map(ids.map((id) => [id, regrasMock.get(id) ?? { participa: false, aceitaRevelacao30d: false }])),
  ),
}));

let clientesMock = new Map<string, {
  clienteId: string;
  telefone: string;
  nome?: string;
  fotoPerfilPathname?: string;
}>();
vi.mock("./clientes", () => ({
  buscarClientePorId: vi.fn(async (id: string) => clientesMock.get(id) ?? null),
  normalizarNomeCliente: (nome: unknown) => typeof nome === "string" ? nome.trim().replace(/\s+/g, " ") : "",
}));

import {
  garantirResultadoTemporada,
  obterResultadoTemporada,
  projetarResultadoTemporada,
} from "./temporadaResultado";

const TENANT = "default";
const TEMPORADA = "t2026-1";
const ENCERRADA_EM = "2026-10-01T00:00:00.000Z";

function encerrada(overrides: Partial<TemporadaMock> = {}): TemporadaMock {
  return {
    temporadaId: TEMPORADA,
    tenantId: TENANT,
    estado: "encerrada",
    criadaEm: "2026-09-01T00:00:00.000Z",
    encerradaEm: ENCERRADA_EM,
    ...overrides,
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  temporadaMock = null;
  rankingCompletoMock = [];
  regrasMock = new Map();
  clientesMock = new Map();
});

describe("garantirResultadoTemporada — regra do jogo secreto", () => {
  test("não arquiva temporada inexistente ou ainda ativa", async () => {
    expect(await garantirResultadoTemporada(TENANT, TEMPORADA)).toBeNull();
    temporadaMock = { ...encerrada(), estado: "ativa" };
    expect(await garantirResultadoTemporada(TENANT, TEMPORADA)).toBeNull();
  });

  test("só mantém no resultado público quem aceitou a revelação de 30 dias", async () => {
    temporadaMock = encerrada();
    rankingCompletoMock = [
      { clienteId: "cli_a", score: 100, posicao: 1 },
      { clienteId: "cli_b", score: 90, posicao: 2 },
      { clienteId: "cli_c", score: 80, posicao: 3 },
    ];
    regrasMock.set("cli_a", { participa: true, aceitaRevelacao30d: true });
    regrasMock.set("cli_b", { participa: true, aceitaRevelacao30d: false });
    regrasMock.set("cli_c", { participa: false, aceitaRevelacao30d: true });

    const resultado = await garantirResultadoTemporada(TENANT, TEMPORADA);
    expect(resultado?.participantesTopo).toEqual([
      { clienteId: "cli_a", score: 100, posicao: 1 },
    ]);
    expect(resultado?.regraJogoVersao).toBe("ranking-jogo-secreto-v1");
    expect(resultado?.revelacaoAte).toBe("2026-10-31T00:00:00.000Z");
  });

  test("prêmio só declara vencedor quando configuração também permite", async () => {
    temporadaMock = encerrada({
      premioAprovado: true,
      premioQuantidadePremiados: 1,
      premioDescricao: "1 Pizza Família",
    });
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    regrasMock.set("cli_a", { participa: true, aceitaRevelacao30d: true });

    const resultado = await garantirResultadoTemporada(TENANT, TEMPORADA);
    expect(resultado?.vencedorDeclarado).toBe(true);
    expect(resultado?.premioDescricao).toBe("1 Pizza Família");
  });

  test("continua idempotente e nunca recalcula snapshot já gravado", async () => {
    temporadaMock = encerrada();
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    regrasMock.set("cli_a", { participa: true, aceitaRevelacao30d: true });

    const primeiro = await garantirResultadoTemporada(TENANT, TEMPORADA);
    rankingCompletoMock = [{ clienteId: "cli_a", score: 999, posicao: 1 }];
    const segundo = await garantirResultadoTemporada(TENANT, TEMPORADA);

    expect(segundo).toEqual(primeiro);
    expect(segundo?.participantesTopo[0]?.score).toBe(100);
  });
});

describe("projetarResultadoTemporada — revelação por 30 dias", () => {
  test("dentro dos 30 dias revela primeiro nome e foto cadastrada", async () => {
    temporadaMock = encerrada({ premioAprovado: true, premioQuantidadePremiados: 1 });
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    regrasMock.set("cli_a", { participa: true, aceitaRevelacao30d: true });
    clientesMock.set("cli_a", {
      clienteId: "cli_a",
      telefone: "5511999990001",
      nome: "Ana Souza",
      fotoPerfilPathname: "perfil/a/avatar",
    });

    const bruto = await garantirResultadoTemporada(TENANT, TEMPORADA);
    const projetado = await projetarResultadoTemporada(
      bruto!,
      Date.parse("2026-10-10T00:00:00.000Z"),
    );

    expect(projetado.participantesTopo[0]?.identidade).toMatchObject({
      nomePublico: "Ana",
      revelado: true,
      participaCampanha: true,
    });
    expect(projetado.participantesTopo[0]?.identidade.fotoPerfilUrl).toContain(
      "temporadaId=t2026-1&posicao=1",
    );
  });

  test("quem sai durante a janela some e os demais sobem de posição", async () => {
    temporadaMock = encerrada();
    rankingCompletoMock = [
      { clienteId: "cli_a", score: 100, posicao: 1 },
      { clienteId: "cli_b", score: 90, posicao: 2 },
    ];
    regrasMock.set("cli_a", { participa: true, aceitaRevelacao30d: true });
    regrasMock.set("cli_b", { participa: true, aceitaRevelacao30d: true });
    const bruto = await garantirResultadoTemporada(TENANT, TEMPORADA);

    regrasMock.set("cli_a", { participa: false, aceitaRevelacao30d: false });
    clientesMock.set("cli_b", { clienteId: "cli_b", telefone: "5511999990002", nome: "Bia" });

    const projetado = await projetarResultadoTemporada(
      bruto!,
      Date.parse("2026-10-10T00:00:00.000Z"),
    );
    expect(projetado.participantesTopo).toHaveLength(1);
    expect(projetado.participantesTopo[0]?.posicao).toBe(1);
    expect(projetado.participantesTopo[0]?.identidade.nomePublico).toBe("Bia");
  });

  test("depois de 30 dias volta ao codinome e não expõe nome nem foto", async () => {
    temporadaMock = encerrada();
    rankingCompletoMock = [{ clienteId: "cli_a", score: 100, posicao: 1 }];
    regrasMock.set("cli_a", { participa: true, aceitaRevelacao30d: true });
    clientesMock.set("cli_a", {
      clienteId: "cli_a",
      telefone: "5511999990001",
      nome: "Ana Souza",
      fotoPerfilPathname: "perfil/a/avatar",
    });
    const bruto = await garantirResultadoTemporada(TENANT, TEMPORADA);

    const projetado = await projetarResultadoTemporada(
      bruto!,
      Date.parse("2026-11-05T00:00:00.000Z"),
    );
    const identidade = projetado.participantesTopo[0]?.identidade;
    expect(identidade?.nomePublico).toBeNull();
    expect(identidade?.fotoPerfilUrl).toBeNull();
    expect(identidade?.revelado).toBe(false);
    expect(identidade?.codinomeSecreto).toMatch(/\S+ \S+ \d{2}/);
  });
});

describe("obterResultadoTemporada", () => {
  test("retorna null para parâmetros vazios ou resultado inexistente", async () => {
    expect(await obterResultadoTemporada("", TEMPORADA)).toBeNull();
    expect(await obterResultadoTemporada(TENANT, "")).toBeNull();
    expect(await obterResultadoTemporada(TENANT, TEMPORADA)).toBeNull();
  });
});
