import { beforeEach, describe, expect, it, vi } from "vitest";

// Memória universal de ruas (autocomplete do checkout) — ver AGENTS.md,
// objetivo 8 da missão de UX/UI do cardápio/checkout. Mock de zset em
// memória: mesma forma que os testes de rodadas/comandas usam para o Redis
// real (zadd/zrange/zrem), sem depender de infraestrutura externa.
const { zset, redisMock } = vi.hoisted(() => {
  const zset = new Map<string, number>();
  const redisMock = {
    zadd: vi.fn(async (_key: string, entry: { score: number; member: string }) => {
      zset.set(entry.member, entry.score);
      return 1;
    }),
    zrange: vi.fn(async (_key: string, _start: number, _end: number, _opts?: { rev?: boolean }) => {
      const entries = Array.from(zset.entries());
      entries.sort((a, b) => (_opts?.rev ? b[1] - a[1] : a[1] - b[1]));
      return entries.map(([member]) => member);
    }),
    zrem: vi.fn(async (_key: string, ...members: string[]) => {
      members.forEach((m) => zset.delete(m));
      return members.length;
    }),
  };
  return { zset, redisMock };
});

vi.mock("./redis", () => ({ redis: redisMock }));

import { normalizarRua, registrarRuaConhecida, sugerirRuas } from "./ruasConhecidas";

describe("ruasConhecidas — memória universal de rua (Redis)", () => {
  beforeEach(() => {
    zset.clear();
    redisMock.zadd.mockClear();
    redisMock.zrem.mockClear();
  });

  it("normaliza acentos e caixa pra deduplicar", () => {
    expect(normalizarRua("Rua Dês  Flôres")).toBe(normalizarRua("rua   des flores"));
  });

  it("nunca grava rua muito curta (lixo de digitação incompleta)", async () => {
    await registrarRuaConhecida("Ru");
    expect(redisMock.zadd).not.toHaveBeenCalled();
  });

  it("grava e sugere por prefixo, mais recente primeiro", async () => {
    await registrarRuaConhecida("Rua das Flores");
    await new Promise((r) => setTimeout(r, 2));
    await registrarRuaConhecida("Rua das Palmeiras");
    const sugestoes = await sugerirRuas("rua das");
    expect(sugestoes[0]).toBe("Rua das Palmeiras");
    expect(sugestoes).toContain("Rua das Flores");
  });

  it("dedupe: grafia diferente da mesma rua substitui a anterior, nunca duplica", async () => {
    await registrarRuaConhecida("rua dez");
    await registrarRuaConhecida("Rua Dez");
    const sugestoes = await sugerirRuas("rua dez");
    expect(sugestoes).toEqual(["Rua Dez"]);
  });

  it("busca vazia não retorna nada (nunca lista tudo sem o cliente digitar)", async () => {
    await registrarRuaConhecida("Rua Central");
    expect(await sugerirRuas("")).toEqual([]);
    expect(await sugerirRuas("   ")).toEqual([]);
  });
});
