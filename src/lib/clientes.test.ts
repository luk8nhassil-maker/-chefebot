import { vi, describe, test, expect, beforeEach } from "vitest";

const store = new Map<string, unknown>();
vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
    scan: vi.fn(async (_cursor: number, opts: { match: string }) => {
      const prefixo = opts.match.replace(/\*$/, "");
      const chaves = [...store.keys()].filter((k) => k.startsWith(prefixo));
      return ["0", chaves] as [string, string[]];
    }),
  },
}));

import { clienteProximaEtapa, ativarFidelidadeCliente, obterOuCriarCliente, listarClientesCadastrados, type Cliente } from "./clientes";

const TEL = "5599974000691";

beforeEach(() => store.clear());

describe("clienteProximaEtapa — estado explicito de ativacao", () => {
  test("sem fidelidadeAtivadaEm sempre vai para name (mesmo com nome legado)", () => {
    expect(clienteProximaEtapa(null)).toBe("name");
    expect(clienteProximaEtapa({ fidelidadeAtivadaEm: undefined })).toBe("name");
    expect(clienteProximaEtapa({ nome: "Nome De Pedido" } as Partial<Cliente> as Cliente)).toBe("name");
  });

  test("com fidelidadeAtivadaEm vai para points", () => {
    expect(clienteProximaEtapa({ fidelidadeAtivadaEm: "2026-01-01T00:00:00.000Z" })).toBe("points");
  });
});

describe("ativarFidelidadeCliente", () => {
  test("primeira ativacao grava nome + fidelidadeAtivadaEm na mesma escrita", async () => {
    const c = await ativarFidelidadeCliente(TEL, "Maria");
    expect(c.nome).toBe("Maria");
    expect(c.fidelidadeAtivadaEm).toBeTruthy();
    const salvo = store.get(`perfil-cliente:${TEL}`) as Cliente;
    expect(salvo.fidelidadeAtivadaEm).toBe(c.fidelidadeAtivadaEm);
  });

  test("cliente pre-existente sem ativacao (nome de pedido) recebe o marco sem perder dados", async () => {
    await obterOuCriarCliente(TEL, "Nome De Pedido");
    expect(clienteProximaEtapa(store.get(`perfil-cliente:${TEL}`) as Cliente)).toBe("name");
    const c = await ativarFidelidadeCliente(TEL, "Maria Ativada");
    expect(c.nome).toBe("Maria Ativada");
    expect(clienteProximaEtapa(c)).toBe("points");
  });

  test("reativar e idempotente: nunca retrocede o marco original", async () => {
    const primeira = await ativarFidelidadeCliente(TEL, "Maria");
    await new Promise((r) => setTimeout(r, 5));
    const segunda = await ativarFidelidadeCliente(TEL, "Maria Editada");
    expect(segunda.fidelidadeAtivadaEm).toBe(primeira.fidelidadeAtivadaEm);
    expect(segunda.nome).toBe("Maria Editada");
  });

  test("obterOuCriarCliente NUNCA marca ativacao sozinho", async () => {
    const c = await obterOuCriarCliente(TEL, "Qualquer Nome");
    expect(c.fidelidadeAtivadaEm).toBeUndefined();
  });
});

describe("listarClientesCadastrados", () => {
  test("sem nenhum perfil salvo retorna lista vazia", async () => {
    expect(await listarClientesCadastrados()).toEqual([]);
  });

  test("retorna todos os perfis cadastrados via scan de perfil-cliente:*", async () => {
    await obterOuCriarCliente(TEL, "Maria");
    await obterOuCriarCliente("5599988887777", "Joao");

    const lista = await listarClientesCadastrados();
    expect(lista).toHaveLength(2);
    expect(lista.map((c) => c.telefone).sort()).toEqual([TEL, "5599988887777"].sort());
  });
});
