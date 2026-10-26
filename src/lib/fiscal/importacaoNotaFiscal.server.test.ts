import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ db: new Map<string, unknown>(), sets: 0 }));
vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => mock.db.get(key) ?? null),
    eval: vi.fn(async (_script: string, keys: string[], args: Array<string | number>) => {
      const previous = mock.db.get(keys[0]) as { versao: number } | undefined;
      if ((previous?.versao ?? 0) !== Number(args[0])) return 0;
      mock.db.set(keys[0], JSON.parse(String(args[1])));
      mock.sets++;
      return 1;
    }),
  },
}));
import { haImportacaoPendente, importarDadosConferidos } from "./importacaoNotaFiscal.server";
import { carregarQuestionario, salvarQuestionario } from "./questionario.server";
import { VAZIO } from "./questionario";

const config = {
  versao: 1,
  titularConta: "admin-autorizado",
  respostas: {
    cnpj: "11.222.333/0001-81",
    razaoSocial: "Empresa Sintética de Teste",
    inscricaoEstadual: "123456789",
    logradouro: "Rua de Teste",
    numero: "49",
    bairro: "CENTRO",
    cep: "65413000",
    municipio: "Cidade de Teste",
    uf: "MA",
  },
};
beforeEach(() => {
  mock.db.clear(); mock.sets = 0;
  vi.stubEnv("FISCAL_PREFILL_DOCUMENTO_202610", JSON.stringify(config));
});
afterEach(() => vi.unstubAllEnvs());

describe("importação segura de nota de compra para rascunho fiscal", () => {
  it("importa nove campos confirmados, sem inventar regime, CNAE, WLG ou autorização", async () => {
    const resultado = await importarDadosConferidos("admin-autorizado");
    expect(resultado.status).toBe("importado");
    const fiscal = await carregarQuestionario("admin-autorizado");
    expect(fiscal.respostas.cnpj).toBe("11222333000181");
    expect(fiscal.respostas.razaoSocial).toBe("Empresa Sintética de Teste");
    expect(fiscal.respostas.logradouro).toBe("Rua de Teste");
    expect(fiscal.respostas.numero).toBe("49");
    expect(fiscal.respostas.porteEmpresa).toBe("");
    expect(fiscal.respostas.regimeTributario).toBe("");
    expect(fiscal.respostas.codigoIBGE).toBe("");
    expect(fiscal.situacao).toBe("rascunho_pendente_vinculo");
    expect(fiscal).not.toHaveProperty("podeEmitir");
    expect(mock.sets).toBe(1);
  });
  it("é idempotente: abrir a tela outra vez não grava mais nada", async () => {
    await importarDadosConferidos("admin-autorizado");
    const novamente = await importarDadosConferidos("admin-autorizado");
    expect(novamente.status).toBe("ja_preenchido");
    expect(mock.sets).toBe(1);
  });
  it("não compartilha dados com nenhuma outra conta", async () => {
    expect(haImportacaoPendente("outro", { ...VAZIO })).toBe(false);
    expect((await importarDadosConferidos("outro")).status).toBe("nao_disponivel");
    expect((await carregarQuestionario("outro")).respostas.cnpj).toBe("");
    expect(mock.sets).toBe(0);
  });
  it("não sobrescreve nem mistura dados de CNPJ de empresa distinta", async () => {
    await salvarQuestionario("admin-autorizado", 0, { ...VAZIO, cnpj: "00000000E08G12" });
    const antes = await carregarQuestionario("admin-autorizado");
    const resultado = await importarDadosConferidos("admin-autorizado");
    expect(resultado.status).toBe("divergente");
    const depois = await carregarQuestionario("admin-autorizado");
    expect(depois).toEqual(antes);
    expect(mock.sets).toBe(1);
  });
  it("não perde dados preexistentes do contador e completa apenas os vazios", async () => {
    await salvarQuestionario("admin-autorizado", 0, {
      ...VAZIO, cnpj: "11222333000181", razaoSocial: "Empresa Sintética de Teste",
      regimeTributario: "simples_nacional", observacoes: "Informado pelo contador",
    });
    const resultado = await importarDadosConferidos("admin-autorizado");
    expect(resultado.status).toBe("importado");
    const doc = await carregarQuestionario("admin-autorizado");
    expect(doc.respostas.regimeTributario).toBe("simples_nacional");
    expect(doc.respostas.observacoes).toBe("Informado pelo contador");
    expect(doc.respostas.logradouro).toBe("Rua de Teste");
    expect(mock.sets).toBe(2);
  });
  it("recusa fontes mal configuradas, dados não permitidos e CNPJ inválido", async () => {
    for (const env of [
      "nonsense",
      JSON.stringify({ ...config, respostas: { ...config.respostas, clientSecret: "NAO" } }),
      JSON.stringify({ ...config, respostas: { ...config.respostas, cnpj: "00000000000000" } }),
    ]) {
      vi.stubEnv("FISCAL_PREFILL_DOCUMENTO_202610", env);
      await expect(importarDadosConferidos("admin-autorizado")).rejects.toThrow();
    }
    expect(mock.sets).toBe(0);
  });
});
