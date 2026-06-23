import { vi, describe, it, expect, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Garante que, com o bot GLOBAL pausado (bot_ativo === false), o webhook ainda
// atualiza o rascunho vivo (Resumo rápido) a cada mensagem do cliente — SEM
// chamar processMessage e SEM enviar resposta. Patch do MVP 3.
// ─────────────────────────────────────────────────────────────────────────────

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => {
      if (key === "bot_ativo") return false; // bot global PAUSADO
      return store.get(key) ?? null;
    }),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async () => 1),
    keys: vi.fn(async () => []),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

// Mantém o bot real, mas espiona processMessage para provar que NÃO é chamado.
vi.mock("@/lib/bot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bot")>();
  return { ...actual, processMessage: vi.fn(actual.processMessage) };
});

import { POST } from "./route";
import { processMessage, createInitialSession } from "@/lib/bot";

const PHONE = "5599999999999";

function webhook(texto: string) {
  return {
    json: async () => ({
      event: "messages.upsert",
      data: {
        key: { remoteJid: `${PHONE}@s.whatsapp.net`, id: `id-${Math.random()}`, fromMe: false },
        message: { conversation: texto },
      },
    }),
  } as never;
}

function sessaoSalva() {
  return store.get(`session:${PHONE}`) as
    | { rascunhoAtendimento?: { itens: string[]; endereco?: string; bairro?: string; tipoEntrega?: string; pagamento?: string } }
    | undefined;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn()); // nenhuma mensagem deve ser enviada
  // Sessão ativa do cliente já existe quando o bot está pausado.
  store.set(`session:${PHONE}`, createInitialSession());
});

describe("bot global pausado (bot_ativo === false) — rascunho vivo", () => {
  it("1. mensagem de pizza atualiza session.rascunhoAtendimento.itens", async () => {
    await POST(webhook("queria uma pizza familia de calabresa e frango"));
    expect(sessaoSalva()?.rascunhoAtendimento?.itens).toContain("Pizza Família Calabresa/Frango");
  });

  it("2. mensagem de endereço atualiza endereço, bairro e tipoEntrega delivery", async () => {
    await POST(webhook("rua do caju, 24, bairro tucum"));
    const r = sessaoSalva()?.rascunhoAtendimento;
    expect(r?.endereco).toBe("Rua do caju, 24");
    expect(r?.bairro).toBe("Tucum");
    expect(r?.tipoEntrega).toBe("delivery");
  });

  it("3. mensagem 'dinheiro' atualiza pagamento Dinheiro", async () => {
    await POST(webhook("dinheiro"));
    expect(sessaoSalva()?.rascunhoAtendimento?.pagamento).toBe("Dinheiro");
  });

  it("4. não chama processMessage, não envia resposta e só salva o rascunho", async () => {
    await POST(webhook("queria uma pizza familia de calabresa e frango"));
    // Bot pausado: fluxo oficial não roda
    expect(processMessage).not.toHaveBeenCalled();
    // Nenhuma resposta enviada ao cliente (enviarMensagem usa fetch)
    expect(fetch).not.toHaveBeenCalled();
    // O rascunho foi persistido na sessão
    expect(sessaoSalva()?.rascunhoAtendimento?.itens.length).toBeGreaterThan(0);
  });

  it("acumula o resumo ao longo da sequência real (pizza → endereço → dinheiro)", async () => {
    await POST(webhook("Boa noite"));
    await POST(webhook("queria uma pizza familia de calabresa e frango"));
    await POST(webhook("rua do caju, 24, bairro tucum"));
    await POST(webhook("dinheiro"));
    const r = sessaoSalva()?.rascunhoAtendimento;
    expect(r?.itens).toContain("Pizza Família Calabresa/Frango");
    expect(r?.endereco).toBe("Rua do caju, 24");
    expect(r?.bairro).toBe("Tucum");
    expect(r?.pagamento).toBe("Dinheiro");
    expect(processMessage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
