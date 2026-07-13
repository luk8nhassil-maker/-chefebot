import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  },
}));

import { obterOuCriarCliente, buscarClientePorTelefone, ativarParticipacaoPontos, clienteIdDoTelefone, normalizarTelefoneClienteBr } from "./clientes";

beforeEach(() => {
  store.clear();
});

describe("ativarParticipacaoPontos", () => {
  test("normaliza telefone brasileiro para DDD + numero e trata DDI 55 como a mesma conta", () => {
    expect(normalizarTelefoneClienteBr("55 99 97400-0691")).toBe("99974000691");
    expect(normalizarTelefoneClienteBr("(99) 97400-0691")).toBe("99974000691");
    expect(clienteIdDoTelefone("5599974000691")).toBe("cli_99974000691");
  });

  test("consolida registro legado com 55 no registro canonico preservando a menor ativacao valida", async () => {
    store.set("cliente:5599974000691", {
      clienteId: "cli_5599974000691",
      telefone: "5599974000691",
      nome: "Ana Legado",
      createdAt: "2026-07-13T09:00:00.000Z",
      updatedAt: "2026-07-13T18:00:00.000Z",
      lastLoginAt: "2026-07-13T18:00:00.000Z",
      pontosAtivos: true,
      pontosAtivadoEm: "2026-07-13T18:00:00.000Z",
    });
    store.set("cliente:99974000691", {
      clienteId: "cli_99974000691",
      telefone: "99974000691",
      createdAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T19:00:00.000Z",
      lastLoginAt: "2026-07-13T19:00:00.000Z",
      pontosAtivos: true,
      pontosAtivadoEm: "2026-07-13T19:00:00.000Z",
    });

    const consolidado = await buscarClientePorTelefone("99974000691");

    expect(consolidado).toMatchObject({
      clienteId: "cli_99974000691",
      telefone: "99974000691",
      nome: "Ana Legado",
      createdAt: "2026-07-13T09:00:00.000Z",
      updatedAt: "2026-07-13T19:00:00.000Z",
      lastLoginAt: "2026-07-13T19:00:00.000Z",
      pontosAtivos: true,
      pontosAtivadoEm: "2026-07-13T18:00:00.000Z",
    });
    expect(store.get("cliente:99974000691")).toMatchObject({ pontosAtivadoEm: "2026-07-13T18:00:00.000Z" });
    expect(store.has("cliente:5599974000691")).toBe(true);
  });

  test("ativa a participacao individual e registra a data de ativacao", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    expect(cliente.pontosAtivos).toBeUndefined();

    const atualizado = await ativarParticipacaoPontos(cliente.clienteId);

    expect(atualizado?.pontosAtivos).toBe(true);
    expect(typeof atualizado?.pontosAtivadoEm).toBe("string");

    const persistido = await buscarClientePorTelefone("11999998888");
    expect(persistido?.pontosAtivos).toBe(true);
  });

  test("idempotente: ativar duas vezes nao sobrescreve a data original nem duplica o registro", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const primeira = await ativarParticipacaoPontos(cliente.clienteId);
    const dataOriginal = primeira?.pontosAtivadoEm;

    const segunda = await ativarParticipacaoPontos(cliente.clienteId);

    expect(segunda?.pontosAtivadoEm).toBe(dataOriginal);
    expect(store.size).toBe(1);
  });

  test("cliente inexistente retorna null, sem criar registro novo", async () => {
    const resultado = await ativarParticipacaoPontos("cli_11900000000");
    expect(resultado).toBeNull();
    expect(store.size).toBe(0);
  });

  test("nao altera nome/telefone/createdAt do cliente ao ativar", async () => {
    const cliente = await obterOuCriarCliente("11999998888", "Ana");
    const atualizado = await ativarParticipacaoPontos(cliente.clienteId);

    expect(atualizado?.nome).toBe("Ana");
    expect(atualizado?.telefone).toBe(cliente.telefone);
    expect(atualizado?.createdAt).toBe(cliente.createdAt);
  });
});
