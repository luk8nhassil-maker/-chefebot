import { beforeEach, describe, expect, test, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const lista = (store.get(key) as string[] | undefined) ?? [];
      return lista.slice(start, stop + 1);
    }),
    multi: vi.fn(() => {
      const operacoes: Array<() => void> = [];
      return {
        set(key: string, value: unknown) {
          operacoes.push(() => store.set(key, value));
          return this;
        },
        lpush(key: string, value: string) {
          operacoes.push(() => {
            const lista = (store.get(key) as string[] | undefined) ?? [];
            store.set(key, [value, ...lista]);
          });
          return this;
        },
        async exec() {
          operacoes.forEach((operacao) => operacao());
          return operacoes.map(() => "OK");
        },
      };
    }),
  };
  return { store, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  ErroConsentimentoRanking,
  configuracaoFinalidadeRanking,
  obterFinalidadesAtivasRanking,
  obterFinalidadesAtivasRankingParaClientes,
  obterHistoricoConsentimentoRanking,
  obterPreferenciasConsentimentoRanking,
  registrarConsentimentoRanking,
  revogarTodosConsentimentosRanking,
} from "./consentimentoRanking";

const CLIENTE_ID = "cli_5511999990000";
const SEGREDO = "s".repeat(48);

function configurarNome() {
  process.env.PRIVACY_CONSENT_HMAC_SECRET = SEGREDO;
  process.env.RANKING_CONSENT_FIRST_NAME_TEXT = "texto aprovado externamente";
  process.env.RANKING_CONSENT_FIRST_NAME_TEXT_VERSION = "dpo-2026-09-v1";
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  delete process.env.PRIVACY_CONSENT_HMAC_SECRET;
  delete process.env.RANKING_CONSENT_FIRST_NAME_TEXT;
  delete process.env.RANKING_CONSENT_FIRST_NAME_TEXT_VERSION;
  delete process.env.RANKING_CONSENT_MASKED_PHONE_TEXT;
  delete process.env.RANKING_CONSENT_MASKED_PHONE_TEXT_VERSION;
});

describe("consentimento do ranking", () => {
  test("permanece revogado e indisponivel sem segredo e texto aprovados", async () => {
    const preferencias = await obterPreferenciasConsentimentoRanking(CLIENTE_ID);
    expect(preferencias.every((item) => item.estado === "revogado")).toBe(true);
    expect(configuracaoFinalidadeRanking("ranking_primeiro_nome")).toMatchObject({
      disponivel: false,
      motivoIndisponivel: "infraestrutura_nao_configurada",
    });
  });

  test("grava estado e auditoria na mesma transacao sem telefone ou clienteId", async () => {
    configurarNome();
    const registro = await registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersaoInformada: "dpo-2026-09-v1",
    });

    expect(registro).toMatchObject({
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersao: "dpo-2026-09-v1",
      origem: "area_cliente_autenticada",
    });
    expect(redisMock.multi).toHaveBeenCalledTimes(1);
    const dump = JSON.stringify([...store.entries()]);
    expect(dump).not.toContain(CLIENTE_ID);
    expect(dump).not.toContain("5511999990000");
    expect(dump).toContain("ranking_primeiro_nome");
  });

  test("recusa concessao com versao diferente da exibida pelo servidor", async () => {
    configurarNome();
    await expect(registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersaoInformada: "versao-antiga",
    })).rejects.toMatchObject({ codigo: "versao_texto_desatualizada" } satisfies Partial<ErroConsentimentoRanking>);
    expect(store.size).toBe(0);
  });

  test("mudanca da versao aprovada volta a anonimizar ate nova concessao", async () => {
    configurarNome();
    await registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersaoInformada: "dpo-2026-09-v1",
    });
    expect(await obterFinalidadesAtivasRanking(CLIENTE_ID)).toContain("ranking_primeiro_nome");

    process.env.RANKING_CONSENT_FIRST_NAME_TEXT_VERSION = "dpo-2026-10-v2";
    expect(await obterFinalidadesAtivasRanking(CLIENTE_ID)).not.toContain("ranking_primeiro_nome");
  });

  test("consulta consentimentos de varios participantes em um unico MGET", async () => {
    configurarNome();
    await registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersaoInformada: "dpo-2026-09-v1",
    });
    redisMock.mget.mockClear();

    const ativos = await obterFinalidadesAtivasRankingParaClientes([CLIENTE_ID, "cli_5511888880000"]);
    expect(redisMock.mget).toHaveBeenCalledTimes(1);
    expect(ativos.get(CLIENTE_ID)).toContain("ranking_primeiro_nome");
    expect(ativos.get("cli_5511888880000")?.size).toBe(0);
  });

  test("foto nao pode ser concedida sem fonte oficial implementada", async () => {
    process.env.PRIVACY_CONSENT_HMAC_SECRET = SEGREDO;
    await expect(registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_foto_perfil",
      estado: "concedido",
      textoVersaoInformada: "qualquer",
    })).rejects.toMatchObject({ codigo: "fonte_oficial_indisponivel" } satisfies Partial<ErroConsentimentoRanking>);
  });

  test("revogacao individual funciona mesmo se o texto aprovado for retirado", async () => {
    configurarNome();
    await registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersaoInformada: "dpo-2026-09-v1",
    });
    delete process.env.RANKING_CONSENT_FIRST_NAME_TEXT;
    delete process.env.RANKING_CONSENT_FIRST_NAME_TEXT_VERSION;

    const revogacao = await registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_primeiro_nome",
      estado: "revogado",
    });
    expect(revogacao.estado).toBe("revogado");
    expect(revogacao.textoVersao).toBe("dpo-2026-09-v1");
  });

  test("revogacao total e historico paginado preservam os eventos", async () => {
    configurarNome();
    await registrarConsentimentoRanking({
      clienteId: CLIENTE_ID,
      finalidade: "ranking_primeiro_nome",
      estado: "concedido",
      textoVersaoInformada: "dpo-2026-09-v1",
    });
    const revogados = await revogarTodosConsentimentosRanking(CLIENTE_ID);
    expect(revogados).toHaveLength(3);
    expect(revogados.every((item) => item.estado === "revogado")).toBe(true);

    const pagina1 = await obterHistoricoConsentimentoRanking(CLIENTE_ID, 0, 2);
    expect(pagina1.eventos).toHaveLength(2);
    expect(pagina1.proximoOffset).toBe(2);
    const pagina2 = await obterHistoricoConsentimentoRanking(CLIENTE_ID, 2, 2);
    expect(pagina2.eventos).toHaveLength(2);
    expect(pagina2.proximoOffset).toBeNull();
  });
});
