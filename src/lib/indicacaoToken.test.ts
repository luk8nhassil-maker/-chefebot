import { beforeEach, describe, expect, test, vi } from "vitest";

const store = new Map<string, unknown>();

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean; ex?: number }) => {
      if (options?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
  },
}));

import {
  gerarTokenIndicacao,
  tokenIndicacaoValido,
  salvarTokenIndicacao,
  resolverTokenIndicacao,
  registrarRelacaoIndicacao,
  obterRelacaoIndicacao,
} from "./indicacaoToken";

beforeEach(() => store.clear());

describe("gerarTokenIndicacao", () => {
  test("gera token de 24 chars base64url", () => {
    const token = gerarTokenIndicacao();
    expect(token).toHaveLength(24);
    expect(tokenIndicacaoValido(token)).toBe(true);
  });

  test("dois tokens gerados são distintos", () => {
    expect(gerarTokenIndicacao()).not.toBe(gerarTokenIndicacao());
  });
});

describe("tokenIndicacaoValido", () => {
  test("aceita 24 chars base64url", () => {
    expect(tokenIndicacaoValido("AAAAAAAAAAAAAAAAAAAAAAAAA".slice(0, 24))).toBe(true);
  });

  test("rejeita formato inválido", () => {
    expect(tokenIndicacaoValido("curto")).toBe(false);
    expect(tokenIndicacaoValido("a".repeat(25))).toBe(false);
    expect(tokenIndicacaoValido("abc!@#$%^&*()".padEnd(24, "x"))).toBe(false);
    expect(tokenIndicacaoValido("")).toBe(false);
  });
});

describe("salvarTokenIndicacao / resolverTokenIndicacao", () => {
  test("token salvo é resolvido para o indicadorId correto", async () => {
    const token = await salvarTokenIndicacao("cli_indicador");
    expect(await resolverTokenIndicacao(token)).toBe("cli_indicador");
  });

  test("token inexistente retorna null", async () => {
    const token = gerarTokenIndicacao();
    expect(await resolverTokenIndicacao(token)).toBeNull();
  });

  test("token com formato inválido retorna null sem consultar Redis", async () => {
    expect(await resolverTokenIndicacao("invalido")).toBeNull();
    expect(await resolverTokenIndicacao("")).toBeNull();
  });
});

describe("registrarRelacaoIndicacao", () => {
  test("primeiro registro retorna 'registrado'", async () => {
    expect(await registrarRelacaoIndicacao("cli_indicado", "cli_indicador")).toBe("registrado");
  });

  test("segundo registro para o mesmo indicado retorna 'ja_existe'", async () => {
    await registrarRelacaoIndicacao("cli_indicado", "cli_indicador_a");
    expect(await registrarRelacaoIndicacao("cli_indicado", "cli_indicador_b")).toBe("ja_existe");
  });

  test("self-referral é bloqueado sem escrita no Redis", async () => {
    expect(await registrarRelacaoIndicacao("cli_x", "cli_x")).toBe("self_referral");
    expect(store.size).toBe(0);
  });

  test("ids vazios retornam 'ja_existe'", async () => {
    expect(await registrarRelacaoIndicacao("", "cli_a")).toBe("ja_existe");
    expect(await registrarRelacaoIndicacao("cli_a", "")).toBe("ja_existe");
  });
});

describe("obterRelacaoIndicacao", () => {
  test("retorna a relação registrada", async () => {
    await registrarRelacaoIndicacao("cli_b", "cli_a");
    const rel = await obterRelacaoIndicacao("cli_b");
    expect(rel?.indicadorId).toBe("cli_a");
    expect(rel?.criadoEm).toBeDefined();
  });

  test("retorna null para indicado sem relação", async () => {
    expect(await obterRelacaoIndicacao("cli_sem_relacao")).toBeNull();
  });

  test("indicado vazio retorna null sem consultar Redis", async () => {
    expect(await obterRelacaoIndicacao("")).toBeNull();
  });
});
