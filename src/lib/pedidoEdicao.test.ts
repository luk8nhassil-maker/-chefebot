import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const redisMock = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    }),
  };
  return { store, redisMock };
});

vi.mock("@/lib/redis", () => ({ redis: redisMock }));

import {
  adquirirMutexEdicao,
  liberarMutexEdicao,
  comMutexEdicao,
  pedidoAguardandoAceite,
  pagamentoJaConfirmado,
  lockEdicaoAtivo,
  limparEdicaoExpiradaSeNecessario,
  sanitizarPedidoParaPainel,
  tokensIguais,
  criarSessaoEdicao,
  EDICAO_DURACAO_MS,
  type PedidoComEdicao,
} from "./pedidoEdicao";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("pedidoAguardandoAceite", () => {
  it("true para pedido novo e nao arquivado", () => {
    expect(pedidoAguardandoAceite({ id: "1", status: "novo" })).toBe(true);
  });
  it("false para pedido ja aceito (em_preparo)", () => {
    expect(pedidoAguardandoAceite({ id: "1", status: "em_preparo" })).toBe(false);
  });
  it("false para pedido cancelado", () => {
    expect(pedidoAguardandoAceite({ id: "1", status: "cancelado" })).toBe(false);
  });
  it("false para pedido arquivado mesmo que status seja novo", () => {
    expect(pedidoAguardandoAceite({ id: "1", status: "novo", isArchived: true })).toBe(false);
  });
});

describe("pagamentoJaConfirmado", () => {
  it("true quando pixConfirmado", () => {
    expect(pagamentoJaConfirmado({ id: "1", status: "novo", pixConfirmado: true })).toBe(true);
  });
  it("true quando pix.status confirmado", () => {
    expect(pagamentoJaConfirmado({ id: "1", status: "novo", pix: { status: "confirmado" } })).toBe(true);
  });
  it("false quando pix pendente", () => {
    expect(pagamentoJaConfirmado({ id: "1", status: "novo", pix: { status: "pendente" } })).toBe(false);
  });
});

describe("lockEdicaoAtivo / limparEdicaoExpiradaSeNecessario", () => {
  it("lock ativo dentro da janela", () => {
    const pedido: PedidoComEdicao = { id: "1", status: "novo", editStatus: "editing", editExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    expect(lockEdicaoAtivo(pedido)).toBe(true);
  });
  it("lock inativo apos expirar", () => {
    const pedido: PedidoComEdicao = { id: "1", status: "novo", editStatus: "editing", editExpiresAt: new Date(Date.now() - 1000).toISOString() };
    expect(lockEdicaoAtivo(pedido)).toBe(false);
  });
  it("limpeza nao mexe em pedido sem edicao ativa", () => {
    const pedido: PedidoComEdicao = { id: "1", status: "novo", editStatus: "none" };
    const { mudou, pedido: limpo } = limparEdicaoExpiradaSeNecessario(pedido);
    expect(mudou).toBe(false);
    expect(limpo).toBe(pedido);
  });
  it("limpeza restaura o pedido quando o lock expirou, preservando o original", () => {
    const pedido: PedidoComEdicao = {
      id: "1",
      status: "novo",
      revision: 3,
      editStatus: "editing",
      editSessionId: "sessao-velha",
      editStartedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      editExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const { mudou, pedido: limpo } = limparEdicaoExpiradaSeNecessario(pedido);
    expect(mudou).toBe(true);
    expect(limpo.editStatus).toBe("none");
    expect(limpo.editSessionId).toBeUndefined();
    expect(limpo.editExpiresAt).toBeUndefined();
    expect(limpo.revision).toBe(3); // pedido original preservado
    expect(limpo.editHistory?.at(-1)?.tipo).toBe("expirado");
  });
  it("duracao do lock e de 5 minutos", () => {
    expect(EDICAO_DURACAO_MS).toBe(5 * 60 * 1000);
  });
});

describe("sanitizarPedidoParaPainel", () => {
  it("remove editSessionId e lastEditSessionId antes de expor ao painel", () => {
    const pedido = { id: "1", status: "novo" as const, editSessionId: "segredo", lastEditSessionId: "segredo2", editStatus: "editing" as const };
    const sanitizado = sanitizarPedidoParaPainel(pedido);
    expect(sanitizado).not.toHaveProperty("editSessionId");
    expect(sanitizado).not.toHaveProperty("lastEditSessionId");
    expect(sanitizado.editStatus).toBe("editing");
  });
});

describe("tokensIguais", () => {
  it("compara corretamente tokens iguais e diferentes", () => {
    expect(tokensIguais("abc123", "abc123")).toBe(true);
    expect(tokensIguais("abc123", "abc124")).toBe(false);
    expect(tokensIguais(undefined, "abc")).toBe(false);
    expect(tokensIguais("abc", undefined)).toBe(false);
  });
});

describe("criarSessaoEdicao", () => {
  it("gera identificadores diferentes a cada chamada", () => {
    const a = criarSessaoEdicao();
    const b = criarSessaoEdicao();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe("mutex de edição (adquirir/liberar)", () => {
  it("adquire e libera normalmente", async () => {
    const token = await adquirirMutexEdicao("ped_1");
    expect(token).toBeTruthy();
    await liberarMutexEdicao("ped_1", token as string);
    expect(store.has("pedido:edit:mutex:ped_1")).toBe(false);
  });

  it("uma segunda tentativa simultânea falha enquanto o mutex está retido", async () => {
    const token1 = await adquirirMutexEdicao("ped_2");
    expect(token1).toBeTruthy();

    // Segunda tentativa: como o mock não expira por TTL, ela deve esgotar as
    // tentativas e retornar null — exatamente o comportamento que garante
    // que duas edições/aceites simultâneos nunca corrompem o mesmo pedido.
    const token2 = await adquirirMutexEdicao("ped_2");
    expect(token2).toBeNull();

    await liberarMutexEdicao("ped_2", token1 as string);
    const token3 = await adquirirMutexEdicao("ped_2");
    expect(token3).toBeTruthy();
  }, 10000);

  it("liberar com token errado (não-dono) não remove o lock de outra sessão", async () => {
    const token1 = await adquirirMutexEdicao("ped_3");
    await liberarMutexEdicao("ped_3", "token-invasor-nao-e-o-dono");
    expect(store.get("pedido:edit:mutex:ped_3")).toBe(token1);
  });

  it("comMutexEdicao executa a função sob o lock e libera ao final", async () => {
    let executou = false;
    await comMutexEdicao("ped_4", async () => {
      executou = true;
      expect(store.has("pedido:edit:mutex:ped_4")).toBe(true);
    });
    expect(executou).toBe(true);
    expect(store.has("pedido:edit:mutex:ped_4")).toBe(false);
  });

  it("comMutexEdicao libera o lock mesmo se a função lançar erro", async () => {
    await expect(comMutexEdicao("ped_5", async () => { throw new Error("falha"); })).rejects.toThrow("falha");
    expect(store.has("pedido:edit:mutex:ped_5")).toBe(false);
  });
});
