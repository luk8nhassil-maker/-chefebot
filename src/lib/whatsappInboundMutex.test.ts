import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const locks = new Map<string, string>();
  const set = vi.fn(async (key: string, value: string, options: { nx?: boolean; ex?: number }) => {
    if (options.nx && locks.has(key)) return null;
    locks.set(key, value);
    return "OK";
  });
  const evalScript = vi.fn(async (_script: string, keys: string[], args: string[]) => {
    if (locks.get(keys[0]) !== args[0]) return 0;
    locks.delete(keys[0]);
    return 1;
  });
  return { locks, set, evalScript };
});
vi.mock("./redis", () => ({ redis: { set: mocks.set, eval: mocks.evalScript } }));

import {
  adquirirMutexConversaWhatsapp,
  liberarMutexConversaWhatsapp,
  chaveMutexConversaWhatsapp,
  ConversaWhatsappOcupadaError,
} from "./whatsappInboundMutex";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("mutex WhatsApp para picos", () => {
  beforeEach(() => {
    mocks.locks.clear();
    vi.clearAllMocks();
  });

  it("50 clientes diferentes avançam em paralelo sem bloqueio global", async () => {
    let emExecucao = 0;
    let maxExecucao = 0;
    const done = await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      const phone = `5511988${String(i).padStart(6, "0")}`;
      const mutex = await adquirirMutexConversaWhatsapp(phone);
      try {
        emExecucao++;
        maxExecucao = Math.max(maxExecucao, emExecucao);
        await sleep(5);
        return i;
      } finally {
        emExecucao--;
        await liberarMutexConversaWhatsapp(mutex);
      }
    }));
    expect(done).toHaveLength(50);
    expect(maxExecucao).toBeGreaterThan(1);
    expect(mocks.locks.size).toBe(0);
  });

  it("mensagens da mesma conversa jamais processam estado em paralelo", async () => {
    let emExecucao = 0;
    let maior = 0;
    const tasks = Array.from({ length: 8 }, async () => {
      const mutex = await adquirirMutexConversaWhatsapp("5511988990011", 5_000);
      try {
        emExecucao++;
        maior = Math.max(maior, emExecucao);
        await sleep(8);
      } finally {
        emExecucao--;
        await liberarMutexConversaWhatsapp(mutex);
      }
    });
    await Promise.all(tasks);
    expect(maior).toBe(1);
    expect(mocks.locks.size).toBe(0);
  });

  it("mensagem excedente não finge processamento quando conversa ocupada", async () => {
    const lock = await adquirirMutexConversaWhatsapp("5511988990011");
    await expect(adquirirMutexConversaWhatsapp("5511988990011", 0)).rejects.toBeInstanceOf(ConversaWhatsappOcupadaError);
    expect(mocks.locks.size).toBe(1);
    await liberarMutexConversaWhatsapp(lock);
  });

  it("liberação atrasada nunca apaga token do novo dono", async () => {
    const original = await adquirirMutexConversaWhatsapp("5511988990011");
    mocks.locks.set(original.chave, "token-do-novo-dono");
    await liberarMutexConversaWhatsapp(original);
    expect(mocks.locks.get(original.chave)).toBe("token-do-novo-dono");
  });

  it("não coloca telefone original na chave de mutex", () => {
    const key = chaveMutexConversaWhatsapp("5511988990011");
    expect(key).toMatch(/^whatsapp:inbound:mutex:[a-f0-9]{32}$/);
    expect(key).not.toContain("5511988990011");
  });

  it("Redis fora do ar nunca permite processamento sem lock", async () => {
    mocks.set.mockRejectedValueOnce(new Error("redis-indisponivel"));
    await expect(adquirirMutexConversaWhatsapp("5511988990011")).rejects.toThrow("redis-indisponivel");
    expect(mocks.locks.size).toBe(0);
  });
});
