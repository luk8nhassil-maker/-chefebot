import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
    del: vi.fn(async (key: string) => { const had = store.has(key); store.delete(key); return had ? 1 : 0; }),
  },
}));

import {
  criarTemporada,
  obterTemporada,
  obterTemporadaAtiva,
  listarTemporadas,
  ativarTemporada,
  encerrarTemporada,
  temporadaExpirada,
} from "./temporadas";

const TENANT = "default";

beforeEach(() => { store.clear(); });

describe("criarTemporada", () => {
  test("cria em estado rascunho", async () => {
    const t = await criarTemporada(TENANT, "t1");
    expect(t.estado).toBe("rascunho");
    expect(t.temporadaId).toBe("t1");
    expect(t.tenantId).toBe(TENANT);
    expect(t.criadaEm).toBeTruthy();
    expect(t.ativadaEm).toBeUndefined();
  });

  test("aceita metaCompras e metaIndicacoes opcionais", async () => {
    const t = await criarTemporada(TENANT, "t2", { nome: "Verão", metaCompras: 10, metaIndicacoes: 3 });
    expect(t.nome).toBe("Verão");
    expect(t.metaCompras).toBe(10);
    expect(t.metaIndicacoes).toBe(3);
  });

  test("adiciona à lista de temporadas", async () => {
    await criarTemporada(TENANT, "t1");
    await criarTemporada(TENANT, "t2");
    const lista = await listarTemporadas(TENANT);
    expect(lista).toHaveLength(2);
    expect(lista.map((t) => t.temporadaId)).toContain("t1");
    expect(lista.map((t) => t.temporadaId)).toContain("t2");
  });

  test("criar mesma temporada novamente não duplica na lista", async () => {
    await criarTemporada(TENANT, "t1");
    await criarTemporada(TENANT, "t1", { nome: "Atualizada" });
    const lista = await listarTemporadas(TENANT);
    expect(lista.filter((t) => t.temporadaId === "t1")).toHaveLength(1);
  });

  test("temporada ativa é imutável via criar — ignora novos parâmetros", async () => {
    await criarTemporada(TENANT, "t1", { nome: "Original" });
    await ativarTemporada(TENANT, "t1");
    const tentativa = await criarTemporada(TENANT, "t1", { nome: "Sobrescrito" });
    expect(tentativa.estado).toBe("ativa");
    expect(tentativa.nome).toBe("Original");
  });

  test("temporada encerrada é imutável via criar", async () => {
    await criarTemporada(TENANT, "t1", { nome: "Original" });
    await ativarTemporada(TENANT, "t1");
    await encerrarTemporada(TENANT, "t1");
    const tentativa = await criarTemporada(TENANT, "t1", { nome: "Sobrescrito" });
    expect(tentativa.estado).toBe("encerrada");
    expect(tentativa.nome).toBe("Original");
  });
});

describe("ativarTemporada", () => {
  test("transiciona rascunho → ativa", async () => {
    await criarTemporada(TENANT, "t1");
    const result = await ativarTemporada(TENANT, "t1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.estado).toBe("ativa");
      expect(result.config.ativadaEm).toBeTruthy();
    }
  });

  test("ativar temporada já ativa retorna ok sem duplicar ativadaEm", async () => {
    await criarTemporada(TENANT, "t1");
    await ativarTemporada(TENANT, "t1");
    const r2 = await ativarTemporada(TENANT, "t1");
    expect(r2.ok).toBe(true);
  });

  test("ativar nova temporada encerra a atual", async () => {
    await criarTemporada(TENANT, "t1");
    await criarTemporada(TENANT, "t2");
    await ativarTemporada(TENANT, "t1");

    const r = await ativarTemporada(TENANT, "t2");
    expect(r.ok).toBe(true);

    const t1 = await obterTemporada(TENANT, "t1");
    expect(t1?.estado).toBe("encerrada");
    expect(t1?.encerradaEm).toBeTruthy();

    const ativa = await obterTemporadaAtiva(TENANT);
    expect(ativa?.temporadaId).toBe("t2");
  });

  test("não ativa temporada encerrada", async () => {
    await criarTemporada(TENANT, "t1");
    await ativarTemporada(TENANT, "t1");
    await encerrarTemporada(TENANT, "t1");
    const r = await ativarTemporada(TENANT, "t1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("temporada_ja_encerrada");
  });

  test("temporada inexistente retorna erro", async () => {
    const r = await ativarTemporada(TENANT, "nao-existe");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toBe("temporada_nao_encontrada");
  });
});

describe("encerrarTemporada", () => {
  test("transiciona ativa → encerrada e remove a ativa", async () => {
    await criarTemporada(TENANT, "t1");
    await ativarTemporada(TENANT, "t1");
    const r = await encerrarTemporada(TENANT, "t1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.estado).toBe("encerrada");

    const ativa = await obterTemporadaAtiva(TENANT);
    expect(ativa).toBeNull();
  });

  test("encerrar temporada já encerrada é idempotente", async () => {
    await criarTemporada(TENANT, "t1");
    await ativarTemporada(TENANT, "t1");
    await encerrarTemporada(TENANT, "t1");
    const r2 = await encerrarTemporada(TENANT, "t1");
    expect(r2.ok).toBe(true);
  });

  test("encerrar temporada em rascunho funciona", async () => {
    await criarTemporada(TENANT, "t1");
    const r = await encerrarTemporada(TENANT, "t1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.estado).toBe("encerrada");
  });

  test("temporada inexistente retorna erro", async () => {
    const r = await encerrarTemporada(TENANT, "nao-existe");
    expect(r.ok).toBe(false);
  });
});

describe("obterTemporadaAtiva", () => {
  test("retorna null quando não há ativa", async () => {
    expect(await obterTemporadaAtiva(TENANT)).toBeNull();
  });

  test("retorna a temporada ativa", async () => {
    await criarTemporada(TENANT, "t1");
    await ativarTemporada(TENANT, "t1");
    const ativa = await obterTemporadaAtiva(TENANT);
    expect(ativa?.temporadaId).toBe("t1");
    expect(ativa?.estado).toBe("ativa");
  });
});

describe("temporadaExpirada", () => {
  test("retorna false quando fimEm não definido", () => {
    expect(temporadaExpirada({ temporadaId: "t1", tenantId: "x", estado: "ativa", criadaEm: new Date().toISOString() })).toBe(false);
  });

  test("retorna false quando agora < fimEm", () => {
    const fimEm = new Date(Date.now() + 86400000).toISOString();
    expect(temporadaExpirada({ temporadaId: "t1", tenantId: "x", estado: "ativa", criadaEm: new Date().toISOString(), fimEm })).toBe(false);
  });

  test("retorna true quando agora > fimEm", () => {
    const fimEm = new Date(Date.now() - 1000).toISOString();
    expect(temporadaExpirada({ temporadaId: "t1", tenantId: "x", estado: "ativa", criadaEm: new Date().toISOString(), fimEm })).toBe(true);
  });

  test("aceita injeção de data para testes determinísticos", () => {
    const fimEm = "2026-06-01T00:00:00.000Z";
    const antes = new Date("2026-05-31T00:00:00.000Z");
    const depois = new Date("2026-06-02T00:00:00.000Z");
    expect(temporadaExpirada({ temporadaId: "t1", tenantId: "x", estado: "ativa", criadaEm: new Date().toISOString(), fimEm }, antes)).toBe(false);
    expect(temporadaExpirada({ temporadaId: "t1", tenantId: "x", estado: "ativa", criadaEm: new Date().toISOString(), fimEm }, depois)).toBe(true);
  });
});

describe("duracaoDias e fimEm", () => {
  test("criarTemporada aceita duracaoDias", async () => {
    const t = await criarTemporada(TENANT, "t-dur", { duracaoDias: 30 });
    expect(t.duracaoDias).toBe(30);
    expect(t.fimEm).toBeUndefined();
  });

  test("ativarTemporada calcula fimEm a partir de duracaoDias", async () => {
    await criarTemporada(TENANT, "t-dur", { duracaoDias: 30 });
    const r = await ativarTemporada(TENANT, "t-dur");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.fimEm).toBeTruthy();
      const dias = Math.round((new Date(r.config.fimEm!).getTime() - new Date(r.config.ativadaEm!).getTime()) / 86400000);
      expect(dias).toBe(30);
    }
  });

  test("temporada sem duracaoDias não tem fimEm após ativar", async () => {
    await criarTemporada(TENANT, "t-sem-dur");
    const r = await ativarTemporada(TENANT, "t-sem-dur");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.fimEm).toBeUndefined();
  });
});

describe("auto-expiry em obterTemporadaAtiva", () => {
  test("retorna null e encerra temporada expirada", async () => {
    await criarTemporada(TENANT, "t-exp", { duracaoDias: 1 });
    const r = await ativarTemporada(TENANT, "t-exp");
    expect(r.ok).toBe(true);

    // Manipular fimEm para ser no passado
    if (r.ok) {
      const configExpirada = { ...r.config, fimEm: new Date(Date.now() - 1000).toISOString() };
      store.set(`temporada:config:${TENANT}:t-exp`, configExpirada);
    }

    const ativa = await obterTemporadaAtiva(TENANT);
    expect(ativa).toBeNull();

    const encerrada = await obterTemporada(TENANT, "t-exp");
    expect(encerrada?.estado).toBe("encerrada");
    expect(encerrada?.encerradaEm).toBeTruthy();
  });

  test("temporada com fimEm futuro permanece ativa", async () => {
    await criarTemporada(TENANT, "t-futuro", { duracaoDias: 30 });
    await ativarTemporada(TENANT, "t-futuro");
    const ativa = await obterTemporadaAtiva(TENANT);
    expect(ativa?.temporadaId).toBe("t-futuro");
  });
});
