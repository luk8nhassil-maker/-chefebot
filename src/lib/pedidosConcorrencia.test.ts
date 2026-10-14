import { vi, describe, test, expect, beforeEach } from "vitest";

const redisStore = new Map<string, unknown>();
let falharProximosSets = 0;
let falharProximosEvals = 0;
let latenciaRedisMs = 0;

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

vi.mock("./redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      if (latenciaRedisMs) await new Promise((resolve) => setTimeout(resolve, latenciaRedisMs));
      if (!redisStore.has(key)) return null;
      return deepClone(redisStore.get(key));
    }),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (latenciaRedisMs) await new Promise((resolve) => setTimeout(resolve, latenciaRedisMs));
      if (falharProximosSets > 0) {
        falharProximosSets -= 1;
        throw new Error("Redis indisponível (simulado)");
      }
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      if (latenciaRedisMs) await new Promise((resolve) => setTimeout(resolve, latenciaRedisMs));
      const next = Number(redisStore.get(key) ?? 0) + 1;
      redisStore.set(key, next);
      return next;
    }),
    del: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
    multi: vi.fn(() => {
      const operacoes: Array<{ tipo: "set"; key: string; value: unknown } | { tipo: "incr"; key: string }> = [];
      const tx = {
        set(key: string, value: unknown) { operacoes.push({ tipo: "set", key, value }); return tx; },
        incr(key: string) { operacoes.push({ tipo: "incr", key }); return tx; },
        async exec() {
          if (latenciaRedisMs) await new Promise((resolve) => setTimeout(resolve, latenciaRedisMs));
          if (falharProximosSets > 0) {
            falharProximosSets -= 1;
            throw new Error("Redis indisponível (simulado)");
          }
          // Aplica tudo só depois de validar a falha: simula a atomicidade do MULTI/EXEC.
          for (const op of operacoes) {
            if (op.tipo === "set") redisStore.set(op.key, deepClone(op.value));
            else redisStore.set(op.key, Number(redisStore.get(op.key) ?? 0) + 1);
          }
          return operacoes.map(() => "OK");
        },
      };
      return tx;
    }),
    // Simula o Lua de liberação: GET+DEL condicional numa única "operação".
    eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
      if (latenciaRedisMs) await new Promise((resolve) => setTimeout(resolve, latenciaRedisMs));
      if (falharProximosEvals > 0) {
        falharProximosEvals -= 1;
        throw new Error("Redis indisponível (simulado) — eval");
      }
      if (_script.includes("ticket = tonumber")) {
        const [lockKey, servingKey] = keys;
        const [ticketRaw, token] = args;
        const ticket = Number(ticketRaw);
        let serving = Number(redisStore.get(servingKey) ?? 0);
        if (!serving) { redisStore.set(servingKey, 1); serving = 1; }
        if (serving > ticket) return -1;
        if (serving !== ticket) return 0;
        if (redisStore.has(lockKey)) return 0;
        redisStore.set(lockKey, token);
        return 1;
      }
      const [chave] = keys;
      const [tokenEsperado, proximoTicket] = args;
      if (redisStore.get(chave) === tokenEsperado) {
        redisStore.delete(chave);
        if (keys[1] && proximoTicket) redisStore.set(keys[1], Number(proximoTicket));
        return 1;
      }
      return 0;
    }),
  },
}));

import {
  adquirirMutexPedidos,
  liberarMutexPedidos,
  mutarPedidos,
  MutexPedidosIndisponivelError,
} from "./pedidosConcorrencia";

beforeEach(() => {
  redisStore.clear();
  falharProximosSets = 0;
  falharProximosEvals = 0;
  latenciaRedisMs = 0;
});

describe("adquirirMutexPedidos / liberarMutexPedidos", () => {
  test("adquire e libera normalmente — a chave de lock não sobra no Redis depois", async () => {
    const token = await adquirirMutexPedidos();
    expect(typeof token).toBe("string");
    expect(redisStore.get("pedidos:mutex:global")).toBe(token);

    await liberarMutexPedidos(token);
    expect(redisStore.has("pedidos:mutex:global")).toBe(false);
  });

  test("segundo adquirente é bloqueado enquanto o primeiro segura o lock (SET NX real)", async () => {
    const tokenA = await adquirirMutexPedidos();
    // Sem expirar o TTL nem liberar, uma segunda tentativa nunca deveria
    // conseguir — comprovamos isso diretamente via SET NX cru, sem esperar
    // os 50 x 20ms de retry real do helper (que só serve para quando o
    // primeiro dono LIBERA no meio do caminho — testado abaixo).
    const segundoSetNx = await (await import("./redis")).redis.set("pedidos:mutex:global", "outro-token", { nx: true, ex: 5 });
    expect(segundoSetNx).toBeNull();
    await liberarMutexPedidos(tokenA);
  });

  // BLOQUEIO da revisão: propriedade central da liberação atômica.
  test("dono ANTIGO nunca apaga o lock adquirido por um dono NOVO (compare-and-delete atômico)", async () => {
    const tokenA = await adquirirMutexPedidos();

    // Simula o TTL de A expirando (sem esperar de verdade): remove a chave
    // como o Redis faria sozinho, então B adquire livremente.
    redisStore.delete("pedidos:mutex:global");
    const tokenB = await adquirirMutexPedidos();
    expect(tokenB).not.toBe(tokenA);

    // A tenta liberar com o token ANTIGO — nunca pode apagar o lock de B.
    await liberarMutexPedidos(tokenA);

    expect(redisStore.get("pedidos:mutex:global")).toBe(tokenB);

    // B libera o próprio lock normalmente — isso sim deve funcionar.
    await liberarMutexPedidos(tokenB);
    expect(redisStore.has("pedidos:mutex:global")).toBe(false);
  });

  test("liberar com um token que nunca foi dono não apaga nada (compare-and-delete recusa)", async () => {
    const tokenReal = await adquirirMutexPedidos();
    await liberarMutexPedidos("token-forjado-nunca-foi-dono");
    expect(redisStore.get("pedidos:mutex:global")).toBe(tokenReal);
    await liberarMutexPedidos(tokenReal);
  });

  test("retry: adquire assim que o primeiro dono libera, dentro do orçamento de tentativas", async () => {
    const tokenA = await adquirirMutexPedidos();
    setTimeout(() => liberarMutexPedidos(tokenA), 5);
    const tokenB = await adquirirMutexPedidos();
    expect(tokenB).not.toBe(tokenA);
    await liberarMutexPedidos(tokenB);
  });

  test("lock indisponível (nunca liberado): esgota tentativas e lança MutexPedidosIndisponivelError — nunca finge ter adquirido", async () => {
    await adquirirMutexPedidos(); // nunca libera de propósito
    await expect(adquirirMutexPedidos()).rejects.toThrow(MutexPedidosIndisponivelError);
  }, 18_000);

  test("Redis falha durante a AQUISIÇÃO (SET NX lança): trata como tentativa falha, tenta de novo, eventualmente adquire se o Redis volta", async () => {
    falharProximosSets = 3;
    const token = await adquirirMutexPedidos();
    expect(typeof token).toBe("string");
    await liberarMutexPedidos(token);
  });

  test("liberação nunca lança mesmo se o Redis falhar (best-effort)", async () => {
    const token = await adquirirMutexPedidos();
    falharProximosEvals = 1;
    await expect(liberarMutexPedidos(token)).resolves.toBeUndefined();
  });
});

describe("mutarPedidos", () => {
  test.runIf(process.env.CHEFEBOT_CAPACITY_BENCH === "1")("mede o mutex com latência simulada por comando Redis", async () => {
    latenciaRedisMs = Number(process.env.CHEFEBOT_CAPACITY_REDIS_LATENCY_MS ?? 5);
    for (const total of [50, 100, 200]) {
      redisStore.clear();
      const resultados = await Promise.allSettled(Array.from({ length: total }, async (_, indice) => {
        const inicio = performance.now();
        await mutarPedidos<{ id: number }, void>((pedidos) => ({
          persistir: true,
          pedidos: [...pedidos, { id: indice }],
          resultado: undefined,
        }));
        return performance.now() - inicio;
      }));
      const latencias = resultados.filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
        .map((r) => r.value).sort((a, b) => a - b);
      const pedidos = (redisStore.get("pedidos") as Array<{ id: number }> | undefined) ?? [];
      console.log(JSON.stringify({ benchmark: "mutex-redis-simulado", latenciaRedisMs, total,
        persistidos: pedidos.length, falhas: total - latencias.length,
        mediaMs: Math.round(latencias.reduce((a, b) => a + b, 0) / (latencias.length || 1)),
        p95Ms: latencias.length ? Math.round(latencias[Math.ceil(latencias.length * 0.95) - 1]) : null,
      }));
      expect(pedidos).toHaveLength(total);
      expect(new Set(pedidos.map((p) => p.id)).size).toBe(total);
    }
  }, 60_000);
  test("lê fresco, aplica a mutação, persiste, libera o lock — devolve o resultado", async () => {
    redisStore.set("pedidos", [{ id: "1", status: "novo" }]);
    const resultado = await mutarPedidos<{ id: string; status: string }, string>((pedidos) => {
      const atualizados = pedidos.map((p) => (p.id === "1" ? { ...p, status: "em_preparo" } : p));
      return { persistir: true, pedidos: atualizados, resultado: "ok" };
    });
    expect(resultado).toBe("ok");
    expect(redisStore.get("pedidos")).toEqual([{ id: "1", status: "em_preparo" }]);
    expect(redisStore.get("pedidos:revision")).toBe(1);
    expect(redisStore.has("pedidos:mutex:global")).toBe(false);
  });

  test("persistir:false não grava nada — pré-condição que deixou de valer após reler fresco", async () => {
    redisStore.set("pedidos", [{ id: "1", status: "entregue" }]);
    const resultado = await mutarPedidos<{ id: string; status: string }, string>((pedidos) => {
      const pedido = pedidos.find((p) => p.id === "1");
      if (pedido?.status === "entregue") return { persistir: false, resultado: "ja_estava_entregue" };
      return { persistir: true, pedidos, resultado: "ok" };
    });
    expect(resultado).toBe("ja_estava_entregue");
    expect(redisStore.get("pedidos")).toEqual([{ id: "1", status: "entregue" }]);
    expect(redisStore.has("pedidos:revision")).toBe(false);
  });

  test("lê SEMPRE fresco de dentro do lock — nunca reaproveita um array lido antes de adquirir", async () => {
    redisStore.set("pedidos", [{ id: "1", status: "novo" }]);
    // Muda o estado "por fora" bem entre a chamada e a execução do
    // callback, simulando outro processo escrevendo antes desta adquirir o
    // lock — mutarPedidos precisa enxergar esse valor nesta leitura.
    const promise = mutarPedidos<{ id: string; status: string }, string>((pedidos) => {
      expect(pedidos).toEqual([{ id: "1", status: "MUDOU_ANTES_DO_LOCK" }]);
      return { persistir: true, pedidos, resultado: "ok" };
    });
    redisStore.set("pedidos", [{ id: "1", status: "MUDOU_ANTES_DO_LOCK" }]);
    await promise;
  });

  // BLOQUEIO da revisão: erro durante a mutação libera só o próprio lock,
  // nunca esconde o erro nem prende o lock além do TTL.
  test("erro dentro de fn propaga E libera o lock (não fica preso)", async () => {
    redisStore.set("pedidos", [{ id: "1", status: "novo" }]);
    await expect(
      mutarPedidos<{ id: string; status: string }, string>(() => {
        throw new Error("falha simulada na mutação");
      })
    ).rejects.toThrow("falha simulada na mutação");
    expect(redisStore.has("pedidos:mutex:global")).toBe(false);
  });

  test("Redis falha durante a PERSISTÊNCIA (SET final lança): propaga o erro (nunca finge sucesso) e ainda assim libera o lock", async () => {
    redisStore.set("pedidos", [{ id: "1", status: "novo" }]);
    await expect(
      mutarPedidos<{ id: string; status: string }, string>((pedidos) => {
        falharProximosSets = 1; // só a escrita final de "pedidos" falha
        return { persistir: true, pedidos, resultado: "nunca_deveria_chegar_aqui" };
      })
    ).rejects.toThrow("Redis indisponível (simulado)");
    expect(redisStore.has("pedidos:mutex:global")).toBe(false);
    // MULTI/EXEC falhou atomicamente: nem pedidos nem revisão foram alterados.
    expect(redisStore.get("pedidos")).toEqual([{ id: "1", status: "novo" }]);
    expect(redisStore.has("pedidos:revision")).toBe(false);
  });

  test("duas mutações concorrentes em mutarPedidos nunca se perdem (serializadas pelo lock global)", async () => {
    redisStore.set("pedidos", [
      { id: "1", status: "novo" },
      { id: "2", status: "novo" },
    ]);
    await Promise.all([
      mutarPedidos<{ id: string; status: string }, void>((pedidos) => ({
        persistir: true,
        pedidos: pedidos.map((p) => (p.id === "1" ? { ...p, status: "em_preparo" } : p)),
        resultado: undefined,
      })),
      mutarPedidos<{ id: string; status: string }, void>((pedidos) => ({
        persistir: true,
        pedidos: pedidos.map((p) => (p.id === "2" ? { ...p, status: "em_preparo" } : p)),
        resultado: undefined,
      })),
    ]);
    const persistidos = redisStore.get("pedidos") as { id: string; status: string }[];
    expect(persistidos.find((p) => p.id === "1")?.status).toBe("em_preparo");
    expect(persistidos.find((p) => p.id === "2")?.status).toBe("em_preparo");
  });
});
