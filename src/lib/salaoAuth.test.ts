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
  definirWhatsappAtendimentoSalao,
  lerSessaoSalao,
  obterConfigSalao,
} from "./salaoAuth";

function reqComToken(token: string | undefined) {
  return { cookies: { get: (nome: string) => (token && nome === SALAO_COOKIE ? { value: token } : undefined) } } as never;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("configuração do WhatsApp do atendimento", () => {
  it("sem número configurado, obterConfigSalao devolve vazio", async () => {
    expect(await obterConfigSalao()).toEqual({});
  });

  it("definirWhatsappAtendimentoSalao grava o número e a data de atualização", async () => {
    await definirWhatsappAtendimentoSalao("11999998888");
    const config = await obterConfigSalao();
    expect(config.whatsappAtendimento).toBe("11999998888");
    expect(typeof config.atualizadoEm).toBe("string");
  });

  it("espaços em volta do número são ignorados na gravação", async () => {
    await definirWhatsappAtendimentoSalao("  11999998888  ");
    const config = await obterConfigSalao();
    expect(config.whatsappAtendimento).toBe("11999998888");
  });
});

describe("lerSessaoSalao — sem código de acesso, a sessão é livre para quem tem o cookie", () => {
  it("sem cookie, sessão é null", async () => {
    expect(await lerSessaoSalao(reqComToken(undefined))).toBeNull();
  });

  it("com um token real gerado por criarTokenSalao, a sessão é reconhecida — sem precisar de nenhum código configurado", async () => {
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
    const tokenQualquer = "cabecalho.corpo-invalido.assinatura";
    expect(await lerSessaoSalao(reqComToken(tokenQualquer))).toBeNull();
  });

  it("mesmo aparelho reconhece a sessão em chamadas repetidas, sem expirar entre elas", async () => {
    const token = await criarTokenSalao();
    expect(await lerSessaoSalao(reqComToken(token))).toEqual({ tipo: "salao" });
    expect(await lerSessaoSalao(reqComToken(token))).toEqual({ tipo: "salao" });
    expect(await lerSessaoSalao(reqComToken(token))).toEqual({ tipo: "salao" });
  });
});
