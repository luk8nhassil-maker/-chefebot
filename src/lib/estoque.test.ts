// Testes da Fase 8 — disponibilidade central e estruturada por ID.
import { vi, describe, it, expect, beforeEach } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import { MENU } from "@/lib/menu";
import {
  obterEsgotadosEfetivos,
  obterEsgotadosMetadataEfetiva,
  definirDisponibilidade,
  marcarRevisaoHoje,
  resolverIdsPorNome,
  migrarEsgotadosParaEstoque,
  reverterMigracaoEstoque,
  obterEstoqueItens,
  CHAVE_ESGOTADOS,
  CHAVE_ESTOQUE_ITENS,
} from "./estoque";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("resolverIdsPorNome", () => {
  it("resolve o ID estável de um sabor de pizza existente", () => {
    expect(resolverIdsPorNome(MENU, "Calabresa")).toEqual(["flavor-calabresa"]);
  });

  it("resolve o ID de uma borda pelo label", () => {
    expect(resolverIdsPorNome(MENU, "Catupiry")).toContain("border-catupiry");
  });

  it("nome que não existe mais no cardápio atual não resolve nenhum ID", () => {
    expect(resolverIdsPorNome(MENU, "Produto Que Não Existe Mais")).toEqual([]);
  });

  it("comparação é insensível a acento/maiúscula", () => {
    expect(resolverIdsPorNome(MENU, "CALABRESA")).toEqual(["flavor-calabresa"]);
  });
});

describe("definirDisponibilidade + obterEsgotadosEfetivos — dual-write", () => {
  it("marcar esgotado grava na lista legada E na estrutura por ID", async () => {
    await definirDisponibilidade({ menu: MENU, nome: "Calabresa", esgotado: true });
    expect(store.get(CHAVE_ESGOTADOS)).toContain("Calabresa");
    const estoque = await obterEstoqueItens();
    expect(estoque["flavor-calabresa"]?.esgotado).toBe(true);
  });

  it("obterEsgotadosEfetivos reflete a escrita imediatamente, com a mesma forma (string[]) que a API legada", async () => {
    await definirDisponibilidade({ menu: MENU, nome: "Calabresa", esgotado: true });
    const efetivos = await obterEsgotadosEfetivos(MENU);
    expect(efetivos).toContain("Calabresa");
  });

  it("desmarcar remove das duas fontes", async () => {
    await definirDisponibilidade({ menu: MENU, nome: "Calabresa", esgotado: true });
    await definirDisponibilidade({ menu: MENU, nome: "Calabresa", esgotado: false });
    expect(store.get(CHAVE_ESGOTADOS)).not.toContain("Calabresa");
    const estoque = await obterEstoqueItens();
    expect(estoque["flavor-calabresa"]).toBeUndefined();
    expect(await obterEsgotadosEfetivos(MENU)).not.toContain("Calabresa");
  });

  it("nome sem ID resolvível no catálogo atual ainda é aceito na lista legada (fallback nunca bloqueia o admin)", async () => {
    await definirDisponibilidade({ menu: MENU, nome: "Produto Descontinuado", esgotado: true });
    expect(store.get(CHAVE_ESGOTADOS)).toContain("Produto Descontinuado");
    expect(await obterEsgotadosEfetivos()).toContain("Produto Descontinuado");
  });
});

describe("obterEsgotadosEfetivos — fail-closed (união nunca reativa)", () => {
  it("item esgotado só na lista legada (estrutura por ID nunca escreveu) continua esgotado", async () => {
    store.set(CHAVE_ESGOTADOS, ["Calabresa"]);
    expect(await obterEsgotadosEfetivos(MENU)).toContain("Calabresa");
  });

  it("item esgotado só na estrutura por ID (lista legada desatualizada/vazia) continua esgotado", async () => {
    store.set(CHAVE_ESTOQUE_ITENS, { "flavor-calabresa": { id: "flavor-calabresa", nome: "Calabresa", esgotado: true } });
    expect(await obterEsgotadosEfetivos(MENU)).toContain("Calabresa");
  });

  it("uma fonte diz disponível mas a outra diz esgotado: resultado final é esgotado (nunca reativa)", async () => {
    store.set(CHAVE_ESGOTADOS, []); // legado diz disponível
    store.set(CHAVE_ESTOQUE_ITENS, { "flavor-calabresa": { id: "flavor-calabresa", nome: "Calabresa", esgotado: true } });
    expect(await obterEsgotadosEfetivos(MENU)).toContain("Calabresa");
  });
});

describe("marcarRevisaoHoje", () => {
  it("atualiza ultimaRevisao só quando o item já está esgotado", async () => {
    await definirDisponibilidade({ menu: MENU, nome: "Calabresa", esgotado: true });
    const metadata = await marcarRevisaoHoje("Calabresa");
    expect(metadata["Calabresa"]?.ultimaRevisao).toBeDefined();
  });

  it("não faz nada para item que nunca foi marcado esgotado", async () => {
    const metadata = await marcarRevisaoHoje("Nunca Esgotou");
    expect(metadata["Nunca Esgotou"]).toBeUndefined();
  });
});

describe("obterEsgotadosMetadataEfetiva", () => {
  it("expõe metadata mesmo para item que só existe na estrutura por ID", async () => {
    store.set(CHAVE_ESTOQUE_ITENS, {
      "flavor-calabresa": { id: "flavor-calabresa", nome: "Calabresa", esgotado: true, desde: "01/01/2026" },
    });
    const metadata = await obterEsgotadosMetadataEfetiva();
    expect(metadata["Calabresa"]?.desde).toBe("01/01/2026");
  });
});

describe("migrarEsgotadosParaEstoque — Fase 11", () => {
  it("dry-run não escreve nada, só reporta", async () => {
    store.set(CHAVE_ESGOTADOS, ["Calabresa", "Catupiry"]);
    const relatorio = await migrarEsgotadosParaEstoque({ menu: MENU, dryRun: true });
    expect(relatorio.dryRun).toBe(true);
    expect(relatorio.resolvidos.map((r) => r.nome).sort()).toEqual(["Calabresa", "Catupiry"]);
    expect(store.has(CHAVE_ESTOQUE_ITENS)).toBe(false);
  });

  it("execução real popula estoque:itens e cria backup", async () => {
    store.set(CHAVE_ESGOTADOS, ["Calabresa"]);
    const relatorio = await migrarEsgotadosParaEstoque({ menu: MENU, dryRun: false });
    expect(relatorio.dryRun).toBe(false);
    expect(relatorio.chaveBackup).toBeDefined();
    const estoque = await obterEstoqueItens();
    expect(estoque["flavor-calabresa"]?.esgotado).toBe(true);
    expect(store.has(relatorio.chaveBackup!)).toBe(true);
  });

  it("é idempotente: rodar duas vezes produz o mesmo resultado, sem duplicar", async () => {
    store.set(CHAVE_ESGOTADOS, ["Calabresa"]);
    await migrarEsgotadosParaEstoque({ menu: MENU, dryRun: false });
    await migrarEsgotadosParaEstoque({ menu: MENU, dryRun: false });
    const estoque = await obterEstoqueItens();
    expect(Object.keys(estoque).filter((id) => id === "flavor-calabresa")).toHaveLength(1);
  });

  it("nome sem ID resolvível é reportado em naoResolvidos, sem quebrar a migração dos demais", async () => {
    store.set(CHAVE_ESGOTADOS, ["Calabresa", "Produto Fantasma"]);
    const relatorio = await migrarEsgotadosParaEstoque({ menu: MENU, dryRun: true });
    expect(relatorio.naoResolvidos).toEqual(["Produto Fantasma"]);
    expect(relatorio.resolvidos.map((r) => r.nome)).toEqual(["Calabresa"]);
  });

  it("nunca apaga a lista legada — ela continua intacta após a migração", async () => {
    store.set(CHAVE_ESGOTADOS, ["Calabresa"]);
    await migrarEsgotadosParaEstoque({ menu: MENU, dryRun: false });
    expect(store.get(CHAVE_ESGOTADOS)).toEqual(["Calabresa"]);
  });
});

describe("reverterMigracaoEstoque — rollback", () => {
  it("restaura o estoque:itens ao estado anterior à migração", async () => {
    store.set(CHAVE_ESGOTADOS, ["Calabresa"]);
    const relatorio = await migrarEsgotadosParaEstoque({ menu: MENU, dryRun: false });
    expect((await obterEstoqueItens())["flavor-calabresa"]).toBeDefined();

    const resultado = await reverterMigracaoEstoque(relatorio.chaveBackup!);
    expect(resultado.ok).toBe(true);
    expect((await obterEstoqueItens())["flavor-calabresa"]).toBeUndefined();
  });

  it("chave de backup inexistente retorna erro, sem lançar exceção", async () => {
    const resultado = await reverterMigracaoEstoque("estoque:migracao:backup:9999999999999");
    expect(resultado.ok).toBe(false);
  });

  it("recusa chave que não é um backup de migração de estoque", async () => {
    const resultado = await reverterMigracaoEstoque("qualquer:outra:chave");
    expect(resultado.ok).toBe(false);
  });
});
