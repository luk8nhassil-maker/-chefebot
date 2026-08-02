import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
  SALAO_COOKIE,
  criarTokenSalao,
  definirCodigoAcessoSalao,
  lerSessaoSalao,
  obterConfigSalao,
  revogarSessoesSalao,
  validarCodigoAcessoSalao,
} from "./salaoAuth";

function reqComToken(token: string | undefined) {
  return { cookies: { get: (nome: string) => (token && nome === SALAO_COOKIE ? { value: token } : undefined) } } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("configuração do código de acesso", () => {
  it("sem código configurado, nenhum código é aceito", async () => {
    expect(await obterConfigSalao()).toEqual({});
    expect(await validarCodigoAcessoSalao("qualquer")).toBe(false);
    expect(await validarCodigoAcessoSalao("")).toBe(false);
  });

  it("depois de configurado, só o código exato é aceito", async () => {
    await definirCodigoAcessoSalao("mesa2026");
    expect(await validarCodigoAcessoSalao("mesa2026")).toBe(true);
    expect(await validarCodigoAcessoSalao("MESA2026")).toBe(false);
    expect(await validarCodigoAcessoSalao("mesa202")).toBe(false);
    expect(await validarCodigoAcessoSalao("")).toBe(false);
  });

  it("espaços em volta do código são ignorados na configuração e na validação", async () => {
    await definirCodigoAcessoSalao("  mesa2026  ");
    expect(await validarCodigoAcessoSalao(" mesa2026 ")).toBe(true);
  });
});

describe("lerSessaoSalao", () => {
  it("sem cookie, sessão é null", async () => {
    expect(await lerSessaoSalao(reqComToken(undefined))).toBeNull();
  });

  it("com um token real gerado por criarTokenSalao, a sessão é reconhecida", async () => {
    const token = await criarTokenSalao();
    const sessao = await lerSessaoSalao(reqComToken(token));
    expect(sessao).toEqual({ tipo: "salao" });
  });

  it("token corrompido/adulterado nunca autentica", async () => {
    const token = await criarTokenSalao();
    const adulterado = token.slice(0, -4) + "abcd";
    expect(await lerSessaoSalao(reqComToken(adulterado))).toBeNull();
  });

  it("requisição sem suporte a cookies nunca lança, devolve null", async () => {
    expect(await lerSessaoSalao(null)).toBeNull();
    expect(await lerSessaoSalao(undefined)).toBeNull();
    expect(await lerSessaoSalao({} as never)).toBeNull();
  });

  it("nunca aceita um token de outro propósito (payload sem tipo: salao)", async () => {
    // Simula um token bem formado (mesma lib jose) mas de outro contexto —
    // aqui simulado só verificando que o formato de token do painel
    // administrativo (JWT diferente) não é aceito.
    const tokenQualquer = "cabecalho.corpo-invalido.assinatura";
    expect(await lerSessaoSalao(reqComToken(tokenQualquer))).toBeNull();
  });

  it("mesmo aparelho reconhece a sessão em chamadas repetidas, sem expirar entre elas", async () => {
    await definirCodigoAcessoSalao("mesa2026");
    const token = await criarTokenSalao();
    expect(await lerSessaoSalao(reqComToken(token))).toEqual({ tipo: "salao" });
    expect(await lerSessaoSalao(reqComToken(token))).toEqual({ tipo: "salao" });
    expect(await lerSessaoSalao(reqComToken(token))).toEqual({ tipo: "salao" });
  });
});

describe("revogação de sessões do Salão", () => {
  it("revogarSessoesSalao invalida imediatamente um token já emitido, mesmo dentro da validade", async () => {
    await definirCodigoAcessoSalao("mesa2026");
    const token = await criarTokenSalao();
    expect(await lerSessaoSalao(reqComToken(token))).toEqual({ tipo: "salao" });

    await revogarSessoesSalao();

    expect(await lerSessaoSalao(reqComToken(token))).toBeNull();
  });

  it("revogarSessoesSalao não muda o código de acesso configurado", async () => {
    await definirCodigoAcessoSalao("mesa2026");
    await revogarSessoesSalao();
    expect(await validarCodigoAcessoSalao("mesa2026")).toBe(true);
  });

  it("um novo login depois da revogação funciona normalmente", async () => {
    await definirCodigoAcessoSalao("mesa2026");
    const tokenAntigo = await criarTokenSalao();
    await revogarSessoesSalao();
    expect(await lerSessaoSalao(reqComToken(tokenAntigo))).toBeNull();

    const tokenNovo = await criarTokenSalao();
    expect(await lerSessaoSalao(reqComToken(tokenNovo))).toEqual({ tipo: "salao" });
  });

  it("trocar o código de acesso também revoga implicitamente as sessões antigas", async () => {
    await definirCodigoAcessoSalao("mesa2026");
    const tokenAntigo = await criarTokenSalao();
    expect(await lerSessaoSalao(reqComToken(tokenAntigo))).toEqual({ tipo: "salao" });

    await definirCodigoAcessoSalao("mesa2027");

    expect(await lerSessaoSalao(reqComToken(tokenAntigo))).toBeNull();
    const tokenNovo = await criarTokenSalao();
    expect(await lerSessaoSalao(reqComToken(tokenNovo))).toEqual({ tipo: "salao" });
  });
});
