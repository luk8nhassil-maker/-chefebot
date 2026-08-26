import { describe, expect, test, vi } from "vitest";
import { lerComRetry } from "./datastoreRetry";

const semEspera = async () => {};

describe("lerComRetry — falha transitória do datastore", () => {
  test("sucesso de primeira não repete nada", async () => {
    const ler = vi.fn(async () => "ok");
    expect(await lerComRetry(ler, { dormir: semEspera })).toBe("ok");
    expect(ler).toHaveBeenCalledTimes(1);
  });

  test("reproduz o incidente: falha, falha, sucesso — e a leitura passa", async () => {
    const respostas = [
      () => { throw new Error("fetch failed") },
      () => { throw new Error("fetch failed") },
      () => ["pedido-1"],
    ];
    const ler = vi.fn(async () => respostas.shift()!());
    expect(await lerComRetry(ler, { dormir: semEspera })).toEqual(["pedido-1"]);
    expect(ler).toHaveBeenCalledTimes(3);
  });

  test("falha PERSISTENTE continua falhando — nunca vira sucesso falso", async () => {
    const ler = vi.fn(async () => { throw new Error("Unauthorized") });
    await expect(lerComRetry(ler, { dormir: semEspera })).rejects.toThrow("Unauthorized");
    expect(ler).toHaveBeenCalledTimes(3);
  });

  test("o erro repropagado é o real, não um genérico inventado", async () => {
    const original = new Error("ERR max requests limit exceeded");
    await expect(lerComRetry(async () => { throw original }, { dormir: semEspera })).rejects.toBe(original);
  });

  test("nunca é retry agressivo: o teto de tentativas é respeitado", async () => {
    const ler = vi.fn(async () => { throw new Error("x") });
    await expect(lerComRetry(ler, { tentativas: 2, dormir: semEspera })).rejects.toThrow();
    expect(ler).toHaveBeenCalledTimes(2);
  });

  test("tentativas inválidas caem para uma única execução, nunca para um loop", async () => {
    const ler = vi.fn(async () => { throw new Error("x") });
    await expect(lerComRetry(ler, { tentativas: 0, dormir: semEspera })).rejects.toThrow();
    await expect(lerComRetry(ler, { tentativas: -5, dormir: semEspera })).rejects.toThrow();
    expect(ler).toHaveBeenCalledTimes(2);
  });

  test("espera com backoff crescente entre as tentativas", async () => {
    const esperas: number[] = [];
    const ler = async () => { throw new Error("x") };
    await expect(
      lerComRetry(ler, { esperaBaseMs: 100, dormir: async (ms) => { esperas.push(ms) } })
    ).rejects.toThrow();
    expect(esperas).toEqual([100, 200]);
  });

  test("um observador que lança não derruba a leitura", async () => {
    const respostas = [() => { throw new Error("t") }, () => "ok"];
    const valor = await lerComRetry(async () => respostas.shift()!(), {
      dormir: semEspera,
      aoFalhar: () => { throw new Error("log quebrado") },
    });
    expect(valor).toBe("ok");
  });

  test("valores falsy legítimos (null, 0, '') são devolvidos, não tratados como falha", async () => {
    for (const valor of [null, 0, "", false]) {
      const ler = vi.fn(async () => valor);
      expect(await lerComRetry(ler, { dormir: semEspera })).toBe(valor);
      expect(ler).toHaveBeenCalledTimes(1);
    }
  });
});
