import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const zsets = new Map<string, Map<string, number>>();
  return {
    store,
    zsets,
    estado: {
      participa: false,
      saldo: 12,
      config: {
        ativo: true,
        regraVersao: "estrelas-faixas-v1",
        metaEstrelas: 20,
        coberturaEconomicaAprovada: true,
        descricaoRecompensa: "Presente aprovado",
      } as Record<string, unknown>,
      recompensas: [] as Array<{ status: string }>,
    },
    redisMock: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
        if (opts?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      zadd: vi.fn(async (key: string, entry: { score: number; member: string }) => {
        const z = zsets.get(key) ?? new Map<string, number>();
        z.set(entry.member, entry.score);
        zsets.set(key, z);
        return 1;
      }),
      zrange: vi.fn(async (key: string, min: number | string, max: number | string) => {
        const lo = typeof min === "number" ? min : Number.NEGATIVE_INFINITY;
        const hi = typeof max === "number" ? max : Number.POSITIVE_INFINITY;
        return [...(zsets.get(key) ?? new Map()).entries()]
          .filter(([, score]) => score >= lo && score <= hi)
          .sort((a, b) => a[1] - b[1])
          .map(([member]) => member);
      }),
      zscore: vi.fn(async (key: string, member: string) => zsets.get(key)?.get(member) ?? null),
      zremrangebyscore: vi.fn(async (key: string, min: number | string, max: number | string) => {
        const z = zsets.get(key);
        if (!z) return 0;
        const lo = typeof min === "number" ? min : Number.NEGATIVE_INFINITY;
        const hi = typeof max === "number" ? max : Number.POSITIVE_INFINITY;
        let count = 0;
        for (const [member, score] of [...z.entries()]) {
          if (score >= lo && score <= hi) { z.delete(member); count++; }
        }
        return count;
      }),
      expire: vi.fn(async () => 1),
      eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
        if (store.get(keys[0]) === args[0]) {
          store.delete(keys[0]);
          return 1;
        }
        return 0;
      }),
    },
  };
});

vi.mock("./redis", () => ({ redis: h.redisMock }));
vi.mock("./consentimentoRanking", () => ({
  obterParticipacaoRanking: vi.fn(async () => h.estado.participa),
}));
vi.mock("./fidelidade", () => ({
  derivarClienteIdPorTelefone: vi.fn((telefone?: string) => telefone ? "cli_anon" : null),
  estrelasV1Ativa: vi.fn((config: { ativo?: boolean; regraVersao?: string }) =>
    config.ativo === true && config.regraVersao === "estrelas-faixas-v1"),
  metaEstrelasDaConfig: vi.fn((config: { metaEstrelas?: number }) => Number(config.metaEstrelas) > 0 ? Number(config.metaEstrelas) : 20),
  obterConfigFidelidadePontos: vi.fn(async () => h.estado.config),
  obterSaldoPontos: vi.fn(async () => ({ disponivel: h.estado.saldo })),
  obterRecompensasPontos: vi.fn(async () => h.estado.recompensas),
}));

import {
  POLITICA_CONVITE_RANKING_WHATSAPP,
  clienteTemOptOutConviteRankingWhatsapp,
  confirmarConviteRankingWhatsapp,
  consumirOptOutConviteRankingWhatsapp,
  ehComandoOptOutRankingWhatsapp,
  montarMensagemConviteRankingWhatsapp,
  prepararConviteRankingWhatsapp,
} from "./rankingConviteWhatsapp";

const PHONE = "5599999999999";
const DIA = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);

beforeEach(() => {
  h.store.clear();
  h.zsets.clear();
  vi.clearAllMocks();
  h.estado.participa = false;
  h.estado.saldo = 12;
  h.estado.config = {
    ativo: true,
    regraVersao: "estrelas-faixas-v1",
    metaEstrelas: 20,
    coberturaEconomicaAprovada: true,
    descricaoRecompensa: "Presente aprovado",
  };
  h.estado.recompensas = [];
});

describe("motor de convite do Ranking por WhatsApp", () => {
  test("usa a mesma cadência conservadora já adotada no projeto", () => {
    expect(POLITICA_CONVITE_RANKING_WHATSAPP).toEqual({
      cooldownDias: 14,
      maxConvites90Dias: 3,
      janelaDias: 90,
    });
  });

  test("monta mensagem factual de progresso sem inventar posição ou prêmio", () => {
    const msg = montarMensagemConviteRankingWhatsapp({
      situacao: "progresso_estrelas",
      saldoEstrelas: 12,
      metaEstrelas: 20,
    });
    expect(msg).toContain("*12 Estrelas*");
    expect(msg).toContain("faltam *8*");
    expect(msg).toContain("Ranking do Chefe");
    expect(msg).toContain("https://chefedapizza.com.br/cliente");
    expect(msg).toContain("SAIR RANKING");
    expect(msg).not.toContain("#1");
    expect(msg).not.toContain("ganhou");
  });

  test("presente só é citado quando o estado real traz recompensa disponível com cobertura", async () => {
    h.estado.recompensas = [{ status: "disponivel" }];
    const r = await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-1", agoraMs: T0 });
    expect(r.status).toBe("pronto");
    if (r.status !== "pronto") return;
    expect(r.situacao).toBe("presente_garantido");
    expect(r.mensagem).toContain("já conquistou um presente");
  });

  test("sem presente usa saldo e meta reais", async () => {
    const r = await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-2", agoraMs: T0 });
    expect(r.status).toBe("pronto");
    if (r.status !== "pronto") return;
    expect(r.situacao).toBe("progresso_estrelas");
    expect(r.mensagem).toContain("*12 Estrelas*");
    expect(r.mensagem).toContain("*8*");
  });

  test("não convida quem já participa", async () => {
    h.estado.participa = true;
    await expect(prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-3", agoraMs: T0 }))
      .resolves.toEqual({ status: "suprimido", motivo: "ja_participa" });
  });

  test("não convida sem Estrelas ativas ou sem progresso confirmado", async () => {
    h.estado.config.ativo = false;
    expect(await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-4", agoraMs: T0 }))
      .toEqual({ status: "suprimido", motivo: "estrelas_inativas" });

    h.estado.config.ativo = true;
    h.estado.saldo = 0;
    expect(await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-5", agoraMs: T0 }))
      .toEqual({ status: "suprimido", motivo: "sem_progresso_real" });
  });

  test("reserva antes do envio e o mesmo evento nunca duplica", async () => {
    const primeiro = await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-6", agoraMs: T0 });
    expect(primeiro.status).toBe("pronto");
    const segundo = await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-6", agoraMs: T0 + 1000 });
    expect(segundo).toEqual({ status: "suprimido", motivo: "evento_ja_reservado" });
  });

  test("aplica cooldown de 14 dias", async () => {
    expect((await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-a", agoraMs: T0 })).status).toBe("pronto");
    expect(await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-b", agoraMs: T0 + 13 * DIA }))
      .toEqual({ status: "suprimido", motivo: "cooldown_14_dias" });
    expect((await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-c", agoraMs: T0 + 15 * DIA })).status).toBe("pronto");
  });

  test("aplica teto de 3 convites em 90 dias", async () => {
    expect((await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "p1", agoraMs: T0 })).status).toBe("pronto");
    expect((await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "p2", agoraMs: T0 + 15 * DIA })).status).toBe("pronto");
    expect((await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "p3", agoraMs: T0 + 30 * DIA })).status).toBe("pronto");
    expect(await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "p4", agoraMs: T0 + 45 * DIA }))
      .toEqual({ status: "suprimido", motivo: "limite_3_convites_90_dias" });
  });

  test("SAIR RANKING é opt-out próprio, permanente e não confunde texto parecido", async () => {
    expect(ehComandoOptOutRankingWhatsapp("  SAÍR RANKING ")).toBe(true);
    expect(ehComandoOptOutRankingWhatsapp("sair")).toBe(false);
    expect(ehComandoOptOutRankingWhatsapp("quero sair do ranking")).toBe(false);
    expect(await consumirOptOutConviteRankingWhatsapp({ telefone: PHONE, resposta: "SAIR RANKING" })).toBe(true);
    expect(await clienteTemOptOutConviteRankingWhatsapp(PHONE)).toBe(true);
    expect(await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "p5", agoraMs: T0 }))
      .toEqual({ status: "suprimido", motivo: "opt_out" });
  });

  test("confirma envio idempotentemente sem apagar a reserva anti-duplicidade", async () => {
    const pronto = await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-7", agoraMs: T0 });
    expect(pronto.status).toBe("pronto");
    if (pronto.status !== "pronto") return;
    expect(await confirmarConviteRankingWhatsapp({ exposureId: pronto.exposureId, enviadoEmMs: T0 + 500 })).toBe(true);
    expect(await confirmarConviteRankingWhatsapp({ exposureId: pronto.exposureId, enviadoEmMs: T0 + 900 })).toBe(true);
    expect(await prepararConviteRankingWhatsapp({ telefone: PHONE, triggerEventId: "pedido-7", agoraMs: T0 + 1000 }))
      .toEqual({ status: "suprimido", motivo: "evento_ja_reservado" });
  });
});
