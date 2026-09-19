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
