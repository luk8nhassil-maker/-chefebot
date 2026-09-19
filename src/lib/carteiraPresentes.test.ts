import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RecompensaJornada } from "./jornadaChef";

const { store, mocks } = vi.hoisted(() => {
  const store = new Map<string, RecompensaJornada[]>();
  const mocks = {
    obterRecompensasCliente: vi.fn(async (clienteId: string, tenantId: string) => {
      return store.get(`${tenantId}:${clienteId}`) ?? [];
    }),
    abrirRecompensa: vi.fn(async (_clienteId: string, recompensaId: string, _tenantId: string): Promise<RecompensaJornada> => {
      throw new Error(`abrirRecompensa not stubbed for ${recompensaId}`);
    }),
    reservarRecompensaParaProximoPedido: vi.fn(async (_clienteId: string, recompensaId: string, _tenantId: string): Promise<RecompensaJornada> => {
      throw new Error(`reservar not stubbed for ${recompensaId}`);
    }),
    cancelarReservaRecompensa: vi.fn(async (_clienteId: string, recompensaId: string, _tenantId: string): Promise<RecompensaJornada> => {
      throw new Error(`cancelarReserva not stubbed for ${recompensaId}`);
    }),
  };
  return { store, mocks };
});

vi.mock("./jornadaChef", () => mocks);

import {
  obterCarteiraCliente,
  abrirPresente,
  reservarPresente,
  cancelarReservaPresente,
} from "./carteiraPresentes";

const TENANT = "default";
const CLI = "cli_abc";

function makeRecompensa(overrides: Partial<RecompensaJornada>): RecompensaJornada {
  return {
    recompensaId: "rec_1",
    clienteId: CLI,
    status: "fechada",
    ciclo: 1,
    criadaEm: new Date().toISOString(),
    atualizadaEm: new Date().toISOString(),
    tenantId: TENANT,
    tipoRecompensa: "bebida_sobremesa",
    ...overrides,
  } as RecompensaJornada;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mocks.obterRecompensasCliente.mockImplementation(async (clienteId: string, tenantId: string) => {
    return store.get(`${tenantId}:${clienteId}`) ?? [];
  });
});

describe("obterCarteiraCliente", () => {
  test("retorna carteira vazia quando não há presentes", async () => {
    const carteira = await obterCarteiraCliente(CLI, TENANT);
    expect(carteira.presentes).toHaveLength(0);
    expect(carteira.totalDisponiveis).toBe(0);
  });

  test("retorna apenas status visíveis (fechada, disponivel, reservada)", async () => {
    store.set(`${TENANT}:${CLI}`, [
      makeRecompensa({ recompensaId: "r1", status: "fechada" }),
      makeRecompensa({ recompensaId: "r2", status: "disponivel" }),
      makeRecompensa({ recompensaId: "r3", status: "reservada" }),
      makeRecompensa({ recompensaId: "r4", status: "resgatada" }),
      makeRecompensa({ recompensaId: "r5", status: "expirada" }),
      makeRecompensa({ recompensaId: "r6", status: "cancelada" }),
    ]);

    const carteira = await obterCarteiraCliente(CLI, TENANT);
    expect(carteira.presentes).toHaveLength(3);
    const ids = carteira.presentes.map((p) => p.recompensaId);
    expect(ids).toContain("r1");
    expect(ids).toContain("r2");
    expect(ids).toContain("r3");
    expect(ids).not.toContain("r4");
    expect(ids).not.toContain("r5");
    expect(ids).not.toContain("r6");
  });

  test("totalDisponiveis conta apenas status disponivel", async () => {
    store.set(`${TENANT}:${CLI}`, [
      makeRecompensa({ recompensaId: "r1", status: "fechada" }),
      makeRecompensa({ recompensaId: "r2", status: "disponivel" }),
      makeRecompensa({ recompensaId: "r3", status: "disponivel" }),
    ]);
    const carteira = await obterCarteiraCliente(CLI, TENANT);
    expect(carteira.totalDisponiveis).toBe(2);
  });

  test("retorna vazio para clienteId vazio", async () => {
    const carteira = await obterCarteiraCliente("", TENANT);
    expect(carteira.presentes).toHaveLength(0);
    expect(mocks.obterRecompensasCliente).not.toHaveBeenCalled();
  });

  test("retorna vazio para tenantId vazio", async () => {
    const carteira = await obterCarteiraCliente(CLI, "");
    expect(carteira.presentes).toHaveLength(0);
    expect(mocks.obterRecompensasCliente).not.toHaveBeenCalled();
  });
});

describe("abrirPresente", () => {
  test("delega para abrirRecompensa com os parâmetros corretos", async () => {
    const esperado = makeRecompensa({ status: "disponivel" });
    mocks.abrirRecompensa.mockResolvedValueOnce(esperado);

    const resultado = await abrirPresente(CLI, "rec_1", TENANT);
    expect(resultado.status).toBe("disponivel");
    expect(mocks.abrirRecompensa).toHaveBeenCalledWith(CLI, "rec_1", TENANT);
  });
});

describe("reservarPresente", () => {
  test("delega para reservarRecompensaParaProximoPedido", async () => {
    const esperado = makeRecompensa({ status: "reservada" });
    mocks.reservarRecompensaParaProximoPedido.mockResolvedValueOnce(esperado);

    const resultado = await reservarPresente(CLI, "rec_1", TENANT);
    expect(resultado.status).toBe("reservada");
    expect(mocks.reservarRecompensaParaProximoPedido).toHaveBeenCalledWith(CLI, "rec_1", TENANT);
  });
});

describe("cancelarReservaPresente", () => {
  test("delega para cancelarReservaRecompensa", async () => {
    const esperado = makeRecompensa({ status: "disponivel" });
    mocks.cancelarReservaRecompensa.mockResolvedValueOnce(esperado);

    const resultado = await cancelarReservaPresente(CLI, "rec_1", TENANT);
    expect(resultado.status).toBe("disponivel");
    expect(mocks.cancelarReservaRecompensa).toHaveBeenCalledWith(CLI, "rec_1", TENANT);
  });
});
