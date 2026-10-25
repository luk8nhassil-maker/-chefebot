import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: new Map<string, string>(),
  isPreview: false,
  writes: 0,
}));
vi.mock("@/lib/redis", () => ({
  redis: {
    set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && state.values.has(key)) return null;
      state.writes++;
      state.values.set(key, JSON.stringify(value));
      return "OK";
    }),
    get: vi.fn(async (key: string) => {
      const raw = state.values.get(key);
      return raw ? JSON.parse(raw) : null;
    }),
    eval: vi.fn(async (_script: string, keys: string[], args: (string | number)[]) => {
      const raw = state.values.get(keys[0]);
      if (!raw) return 0;
      const existing = JSON.parse(raw);
      if (existing.versao !== Number(args[0])) return 0;
      state.writes++;
      state.values.set(keys[0], String(args[1]));
      return 1;
    }),
  },
}));
vi.mock("@/lib/previewSafety", () => ({
  bloquearOperacaoRealEmPreview: () => {
    if (state.isPreview) throw new Error("Preview: Redis real proibido");
  },
}));

import {
  lerFiscalAtomico, reservarFiscalAtomico, transicionarFiscalAtomico,
} from "./wlgLedgerPersistente.server";

beforeEach(() => {
  state.values.clear();
  state.writes = 0;
  state.isPreview = false;
});

const op = "9cd3a690-3d1a-4877-a982-b93044dfa370";

describe("WLG — ledger durável e atômico (Redis simulado)", () => {
  it("duas requisições da mesma conta só conseguem uma reserva", async () => {
    const [a, b] = await Promise.all([
      reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"),
      reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(state.writes).toBe(1);
    const persisted = await lerFiscalAtomico("pizzaria-a", "conta-1");
    expect(persisted?.registro.situacao).toBe("reservada");
  });
  it("não compartilha registros de duas pizzarias com mesmo número de pedido", async () => {
    await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a");
    await reservarFiscalAtomico("pizzaria-b", "conta-1", "empresa-b");
    expect(state.values.size).toBe(2);
    expect((await lerFiscalAtomico("pizzaria-b", "conta-1"))?.registro.empresaId).toBe("empresa-b");
  });
  it("grava envio incerto antes do POST, depois protocolo, consulta e autorização", async () => {
    const reservado = (await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"))!;
    const incerto = (await transicionarFiscalAtomico(reservado, { tipo: "antes_do_envio" }))!;
    expect(incerto.registro.situacao).toBe("envio_incerto");
    expect((await lerFiscalAtomico("pizzaria-a", "conta-1"))?.registro.situacao).toBe("envio_incerto");
    const processando = (await transicionarFiscalAtomico(incerto, {
      tipo: "protocolo_recebido", operationId: op,
    }))!;
    expect(processando.registro.situacao).toBe("processando");
    const autorizada = await transicionarFiscalAtomico(processando, {
      tipo: "resultado",
      status: {
        situacao: "autorizada", operationId: op,
        chave: "1".repeat(44), autorizadaEm: "2026-10-24T20:00:00Z",
      },
    });
    expect(autorizada?.registro.situacao).toBe("autorizada");
    expect((await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"))).toBeNull();
    expect(state.values.size).toBe(1);
  });
  it("CAS recusa outro trabalhador com versão antiga", async () => {
    const reservado = (await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"))!;
    expect(await transicionarFiscalAtomico(reservado, { tipo: "antes_do_envio" })).not.toBeNull();
    expect(await transicionarFiscalAtomico(reservado, { tipo: "antes_do_envio" })).toBeNull();
    expect((await lerFiscalAtomico("pizzaria-a", "conta-1"))?.versao).toBe(2);
  });
  it("depois de timeout não faz nova reserva nem apaga registro", async () => {
    const inicial = (await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"))!;
    const indeterminado = (await transicionarFiscalAtomico(inicial, { tipo: "antes_do_envio" }))!;
    expect(indeterminado.registro.situacao).toBe("envio_incerto");
    await expect(transicionarFiscalAtomico(indeterminado, { tipo: "antes_do_envio" })).rejects.toThrow();
    expect(await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a")).toBeNull();
  });
  it("rejeita status de operationId de outra operação", async () => {
    const inicial = (await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"))!;
    const indeterminado = (await transicionarFiscalAtomico(inicial, { tipo: "antes_do_envio" }))!;
    const processando = (await transicionarFiscalAtomico(indeterminado, {
      tipo: "protocolo_recebido", operationId: op,
    }))!;
    await expect(transicionarFiscalAtomico(processando, {
      tipo: "resultado", status: {
        situacao: "autorizada", operationId: "outro-operacao",
        chave: "1".repeat(44), autorizadaEm: "2026-10-24T20:00:00Z",
      },
    })).rejects.toThrow();
  });
  it("bloqueia qualquer acesso ao Redis produtivo em Preview", async () => {
    state.isPreview = true;
    await expect(reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a")).rejects.toThrow("Preview");
    await expect(lerFiscalAtomico("pizzaria-a", "conta-1")).rejects.toThrow("Preview");
    expect(state.values.size).toBe(0);
  });
  it("registro adulterado não autoriza transições", async () => {
    const inicial = (await reservarFiscalAtomico("pizzaria-a", "conta-1", "empresa-a"))!;
    state.values.set(inicial.registro.chave, JSON.stringify({
      versao: 1, registro: { ...inicial.registro, empresaId: "../empresa-invasora" },
    }));
    await expect(lerFiscalAtomico("pizzaria-a", "conta-1")).rejects.toThrow("inconsistente");
  });
});
