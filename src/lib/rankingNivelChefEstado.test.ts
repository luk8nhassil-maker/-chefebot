import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock, registrarFatoMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    redisMock: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
        return "OK";
      }),
    },
    registrarFatoMock: vi.fn(async () => true),
  };
});

vi.mock("./redis", () => ({ redis: redisMock }));
vi.mock("./rankingGamificacaoFatos", () => ({ registrarFatoRankingGamificacao: registrarFatoMock }));

import { sincronizarNivelChefCliente } from "./rankingNivelChefEstado";

const T = "default";
const CLI = "cli_a";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  registrarFatoMock.mockResolvedValue(true);
});

describe("sincronizarNivelChefCliente", () => {
  test("primeiro nível alcançado dispara o fato nivel_subiu", async () => {
    await sincronizarNivelChefCliente(T, CLI, 1);
    expect(registrarFatoMock).toHaveBeenCalledWith("nivel_subiu", `${CLI}:1`);
  });

  test("mesmo nível de novo (releitura do painel) nunca dispara duas vezes", async () => {
    await sincronizarNivelChefCliente(T, CLI, 2);
    registrarFatoMock.mockClear();
    await sincronizarNivelChefCliente(T, CLI, 2);
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });

  test("nível menor que o já registrado nunca dispara (nunca 'desce' de nível)", async () => {
    await sincronizarNivelChefCliente(T, CLI, 3);
    registrarFatoMock.mockClear();
    await sincronizarNivelChefCliente(T, CLI, 2);
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });

  test("nível 0 (sem config/abaixo do primeiro limiar) nunca dispara", async () => {
    await sincronizarNivelChefCliente(T, CLI, 0);
    expect(registrarFatoMock).not.toHaveBeenCalled();
  });
});
