import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  },
}));

import { criarSessaoCliente } from "@/lib/clienteAuth";
import { obterOuCriarCliente, buscarClientePorTelefone } from "@/lib/clientes";
import { salvarConfigFidelidadePontos } from "@/lib/fidelidade";
import { POST } from "./route";

function req(token?: string) {
  const init = token ? { method: "POST", headers: { cookie: `cliente-token=${token}` } } : { method: "POST" };
  return new NextRequest("http://localhost/api/cliente/fidelidade/ativar", init);
}

beforeEach(async () => {
  store.clear();
  // Programa global ativo por padrão nos testes que não testam a checagem
  // em si (Nível 6.6.1) — os testes de "programa desativado" abaixo
  // sobrescrevem isso explicitamente.
  await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });
});

describe("POST /api/cliente/fidelidade/ativar", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  test("token invalido/adulterado retorna 401", async () => {
    const res = await POST(req("token-adulterado"));
    expect(res.status).toBe(401);
  });

  test("ativa a participacao do cliente autenticado (resolvido pela sessao, nunca por input)", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    const res = await POST(req(token));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.pontosAtivos).toBe(true);
    expect(typeof data.pontosAtivadoEm).toBe("string");

    const persistido = await buscarClientePorTelefone("11999998888");
    expect(persistido?.pontosAtivos).toBe(true);
  });

  test("idempotente: ativar duas vezes na mesma sessao nao muda a data de ativacao", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    const primeira = await POST(req(token));
    const dataPrimeira = (await primeira.json()).pontosAtivadoEm;

    const segunda = await POST(req(token));
    const dataSegunda = (await segunda.json()).pontosAtivadoEm;

    expect(dataSegunda).toBe(dataPrimeira);
  });

  test("cliente A nunca ativa a participacao de outro cliente — so a sua propria, pela sessao", async () => {
    const clienteA = await obterOuCriarCliente("11900000001");
    await obterOuCriarCliente("11900000002"); // cliente B só precisa existir no cadastro
    const tokenA = await criarSessaoCliente({ clienteId: clienteA.clienteId, telefone: clienteA.telefone });

    await POST(req(tokenA));

    const persistidoA = await buscarClientePorTelefone("11900000001");
    const persistidoB = await buscarClientePorTelefone("11900000002");
    expect(persistidoA?.pontosAtivos).toBe(true);
    expect(persistidoB?.pontosAtivos).toBeUndefined();
  });

  describe("programa global desativado (Nível 6.6.1)", () => {
    test("nao ativa o cliente e retorna 409 com codigo PROGRAMA_PONTOS_INATIVO", async () => {
      await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });
      const cliente = await obterOuCriarCliente("11999998888");
      const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

      const res = await POST(req(token));
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.codigo).toBe("PROGRAMA_PONTOS_INATIVO");
    });

    test("registro do cliente permanece sem pontosAtivos", async () => {
      await salvarConfigFidelidadePontos({ ativo: false, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });
      const cliente = await obterOuCriarCliente("11999998888");
      const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

      await POST(req(token));

      const persistido = await buscarClientePorTelefone("11999998888");
      expect(persistido?.pontosAtivos).toBeUndefined();
    });

    test("programa ativo permite ativacao normalmente (contraste com os testes acima)", async () => {
      await salvarConfigFidelidadePontos({ ativo: true, metaPontos: 720, descricaoRecompensa: "1 Pizza Família" });
      const cliente = await obterOuCriarCliente("11999998888");
      const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

      const res = await POST(req(token));
      expect(res.status).toBe(200);

      const persistido = await buscarClientePorTelefone("11999998888");
      expect(persistido?.pontosAtivos).toBe(true);
    });

    test("ativacao continua idempotente com o programa ativo (chamar duas vezes nao muda a data)", async () => {
      const cliente = await obterOuCriarCliente("11999998888");
      const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

      const primeira = await POST(req(token));
      const dataPrimeira = (await primeira.json()).pontosAtivadoEm;
      const segunda = await POST(req(token));
      const dataSegunda = (await segunda.json()).pontosAtivadoEm;

      expect(primeira.status).toBe(200);
      expect(segunda.status).toBe(200);
      expect(dataSegunda).toBe(dataPrimeira);
    });
  });
});
