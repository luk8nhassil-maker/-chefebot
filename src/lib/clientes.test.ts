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

import { obterOuCriarCliente, buscarClientePorTelefone, ativarParticipacaoPontos } from "./clientes";

beforeEach(() => {
  store.clear();
});

describe("ativarParticipacaoPontos", () => {
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
