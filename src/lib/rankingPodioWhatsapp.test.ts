import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const estado = {
    temporada: { temporadaId: "temp_1", tenantId: "default", estado: "ativa" } as Record<string, unknown> | null,
    ranking: [] as Array<{ clienteId: string; score: number; posicao: number }>,
    participacoes: new Map<string, boolean>(),
    clientes: new Map<string, { clienteId: string; telefone: string; nome?: string }>(),
    optOut: new Set<string>(),
    coroa: { maxGapEstrelas: 5 } as { maxGapEstrelas: number } | null,
    envioOk: true,
  };

  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
  };

  return { store, estado, redisMock };
});

vi.mock("./redis", () => ({ redis: h.redisMock }));
vi.mock("./temporadas", () => ({
  obterTemporadaAtiva: vi.fn(async () => h.estado.temporada),
}));
vi.mock("./rankingClientes", () => ({
  obterRankingCompleto: vi.fn(async () => h.estado.ranking),
  reindexarPorFiltro: vi.fn((
    entradas: Array<{ clienteId: string; score: number; posicao: number }>,
    incluir: (id: string) => boolean,
  ) => entradas.filter((e) => incluir(e.clienteId)).map((e, index) => ({ ...e, posicao: index + 1 }))),
}));
vi.mock("./consentimentoRanking", () => ({
  obterParticipacaoRankingParaClientes: vi.fn(async (ids: string[]) =>
    new Map(ids.map((id) => [id, h.estado.participacoes.get(id) === true]))),
}));
vi.mock("./clientes", () => ({
  buscarClientePorId: vi.fn(async (id: string) => h.estado.clientes.get(id) ?? null),
}));
vi.mock("./rankingConviteWhatsapp", () => ({
  clienteTemOptOutConviteRankingWhatsapp: vi.fn(async (phone: string) => h.estado.optOut.has(phone)),
}));
const enviarTextoWhatsAppMock = vi.hoisted(() => vi.fn());
vi.mock("./whatsappMensagem", () => ({
  enviarTextoWhatsApp: enviarTextoWhatsAppMock,
}));
vi.mock("./rankingCoroaDinamica", () => ({
  obterReferenciaCoroaDinamica: vi.fn(async () => h.estado.coroa),
}));

import {
  acaoPedidoParaUltrapassar,
  ehHorarioDisparoPodioWhatsapp,
  montarMensagemPodioWhatsapp,
  processarPodioWhatsapp18h,
} from "./rankingPodioWhatsapp";

const T18 = Date.parse("2026-09-27T21:00:00.000Z");
const DIA = 24 * 60 * 60 * 1000;

function seedTop3() {
  h.estado.ranking = [
    { clienteId: "fora", score: 200, posicao: 1 },
    { clienteId: "a", score: 100, posicao: 2 },
    { clienteId: "b", score: 95, posicao: 3 },
    { clienteId: "c", score: 90, posicao: 4 },
  ];
  h.estado.participacoes = new Map([
    ["fora", false],
    ["a", true],
    ["b", true],
    ["c", true],
  ]);
  h.estado.clientes = new Map([
    ["a", { clienteId: "a", telefone: "86999990001", nome: "Ana Silva" }],
    ["b", { clienteId: "b", telefone: "86999990002", nome: "Bruno" }],
    ["c", { clienteId: "c", telefone: "86999990003", nome: "Carla" }],
  ]);
}

beforeEach(() => {
  h.store.clear();
  h.estado.temporada = { temporadaId: "temp_1", tenantId: "default", estado: "ativa" };
  h.estado.ranking = [];
  h.estado.participacoes = new Map();
  h.estado.clientes = new Map();
  h.estado.optOut = new Set();
  h.estado.coroa = { maxGapEstrelas: 5 };
  h.estado.envioOk = true;
  enviarTextoWhatsAppMock.mockReset().mockImplementation(async () => ({
    ok: h.estado.envioOk,
    motivo: h.estado.envioOk ? undefined : "http_500",
    latenciaMs: 1,
    tentativas: 1,
  }));
});

describe("Ranking Pódio WhatsApp — matemática e copy", () => {
  test("18h usa o fuso operacional da pizzaria", () => {
    expect(ehHorarioDisparoPodioWhatsapp(T18)).toBe(true);
    expect(ehHorarioDisparoPodioWhatsapp(T18 - 60 * 60 * 1000)).toBe(false);
    expect(ehHorarioDisparoPodioWhatsapp(T18 + 60 * 60 * 1000)).toBe(false);
  });

  test("mapeia somente faixas que um pedido normal realmente consegue cobrir", () => {
    expect(acaoPedidoParaUltrapassar(1)).toEqual({ estrelas: 3, minimoElegivelCents: null });
    expect(acaoPedidoParaUltrapassar(3)).toEqual({ estrelas: 3, minimoElegivelCents: null });
    expect(acaoPedidoParaUltrapassar(4)).toEqual({ estrelas: 5, minimoElegivelCents: 4000 });
    expect(acaoPedidoParaUltrapassar(6)).toEqual({ estrelas: 7, minimoElegivelCents: 7000 });
    expect(acaoPedidoParaUltrapassar(8)).toEqual({ estrelas: 9, minimoElegivelCents: 10000 });
    expect(acaoPedidoParaUltrapassar(10)).toEqual({ estrelas: 12, minimoElegivelCents: 15000 });
    expect(acaoPedidoParaUltrapassar(12)).toEqual({ estrelas: 12, minimoElegivelCents: 15000 });
    expect(acaoPedidoParaUltrapassar(13)).toBeNull();
  });

  test("#2 recebe distância real e faixa mínima capaz de ultrapassar", () => {
    const msg = montarMensagemPodioWhatsapp({
      posicao: 2,
      score: 95,
      posicaoAnterior: 2,
      alvoPosicao: 1,
      necessarioParaUltrapassar: 6,
      vantagemSobreSegundo: null,
      coroaAmeacada: false,
      nome: "Bruno",
    });
    expect(msg).toContain("Faltam *6 Estrelas* para ultrapassar o #1");
    expect(msg).toContain("R$ 70,00");
    expect(msg).toContain("já pode colocar você no *#1*");
    expect(msg).toContain("SAIR RANKING");
  });

  test("distância acima de 12 nunca promete que um único pedido resolve", () => {
    const msg = montarMensagemPodioWhatsapp({
      posicao: 3,
      score: 20,
      posicaoAnterior: 3,
      alvoPosicao: 2,
      necessarioParaUltrapassar: 13,
      vantagemSobreSegundo: null,
      coroaAmeacada: false,
    });
    expect(msg).toContain("13 Estrelas");
    expect(msg).toContain("exige mais de um pedido normal");
    expect(msg).not.toContain("já pode colocar você");
    expect(msg).not.toContain("R$");
  });

  test("#1 recebe alerta de Coroa somente com ameaça matemática real", () => {
    const msg = montarMensagemPodioWhatsapp({
      posicao: 1,
      score: 100,
      posicaoAnterior: 1,
      alvoPosicao: null,
      necessarioParaUltrapassar: null,
      vantagemSobreSegundo: 4,
      coroaAmeacada: true,
    });
    expect(msg).toContain("Sua Coroa entrou em disputa");
    expect(msg).toContain("#2 está a *4 Estrelas*");
  });
});

describe("Ranking Pódio WhatsApp — execução diária", () => {
  test("ignora não participante e envia apenas para Top 3 reindexado da campanha", async () => {
    seedTop3();

    const r = await processarPodioWhatsapp18h({ agoraMs: T18 });

    expect(r.participantesTop3).toBe(3);
    expect(r.enviados).toBe(3);
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(3);

    const chamadas = enviarTextoWhatsAppMock.mock.calls.map(([phone, msg]) => ({
      phone,
      msg: String(msg),
    }));
    expect(chamadas.map((c) => c.phone)).toEqual([
      "5586999990001",
      "5586999990002",
      "5586999990003",
    ]);
    expect(chamadas.some((c) => c.phone.includes("fora"))).toBe(false);
    expect(chamadas[0].msg).toContain("*#1*");
    expect(chamadas[0].msg).toContain("Coroa entrou em disputa");
    expect(chamadas[1].msg).toContain("*#2*");
    expect(chamadas[1].msg).toContain("R$ 70,00");
    expect(chamadas[2].msg).toContain("*#3*");
  });

  test("mesmo cenário no dia seguinte fica em silêncio para não virar spam", async () => {
    seedTop3();
    expect((await processarPodioWhatsapp18h({ agoraMs: T18 })).enviados).toBe(3);
    enviarTextoWhatsAppMock.mockClear();

    const r = await processarPodioWhatsapp18h({ agoraMs: T18 + DIA });

    expect(r.enviados).toBe(0);
    expect(r.motivos.cenario_inalterado).toBe(3);
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("mudança real do Pódio no dia seguinte gera mensagens individuais novas", async () => {
    seedTop3();
    await processarPodioWhatsapp18h({ agoraMs: T18 });
    enviarTextoWhatsAppMock.mockClear();

    h.estado.ranking = [
      { clienteId: "fora", score: 200, posicao: 1 },
      { clienteId: "b", score: 101, posicao: 2 },
      { clienteId: "a", score: 100, posicao: 3 },
      { clienteId: "c", score: 90, posicao: 4 },
    ];

    const r = await processarPodioWhatsapp18h({ agoraMs: T18 + DIA });
    expect(r.enviados).toBe(3);

    const textos = enviarTextoWhatsAppMock.mock.calls.map(([, msg]) => String(msg));
    expect(textos.some((m) => m.includes("assumiu o *#1*"))).toBe(true);
    expect(textos.some((m) => m.includes("a disputa mudou: agora você está em *#2*"))).toBe(true);
  });

  test("SAIR RANKING silencia também a comunicação competitiva do Pódio", async () => {
    seedTop3();
    h.estado.optOut.add("5586999990002");

    const r = await processarPodioWhatsapp18h({ agoraMs: T18 });

    expect(r.enviados).toBe(2);
    expect(r.motivos.opt_out).toBe(1);
    expect(enviarTextoWhatsAppMock.mock.calls.map(([phone]) => phone)).not.toContain("5586999990002");
  });

  test("falha do provider é reservada antes do envio e não duplica no retry do mesmo dia", async () => {
    seedTop3();
    h.estado.envioOk = false;

    const primeiro = await processarPodioWhatsapp18h({ agoraMs: T18 });
    expect(primeiro.falhas).toBe(3);
    expect(enviarTextoWhatsAppMock).toHaveBeenCalledTimes(3);

    enviarTextoWhatsAppMock.mockClear();
    const segundo = await processarPodioWhatsapp18h({ agoraMs: T18 + 5 * 60 * 1000 });
    expect(segundo.enviados).toBe(0);
    expect(segundo.motivos.ja_reservado_no_dia).toBe(3);
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });

  test("fora das 18h nunca toca no provider", async () => {
    seedTop3();
    const r = await processarPodioWhatsapp18h({ agoraMs: T18 - 60 * 60 * 1000 });
    expect(r.motivos.fora_horario).toBe(1);
    expect(enviarTextoWhatsAppMock).not.toHaveBeenCalled();
  });
});
