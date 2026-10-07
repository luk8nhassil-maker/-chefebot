import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  const zsets = new Map<string, Array<{ score: number; member: string }>>();
  return {
    store,
    zsets,
    statusAssinaturaChefeBot: vi.fn(),
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown, options?: { nx?: boolean }) => {
        if (options?.nx && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      zadd: vi.fn(async (key: string, value: { score: number; member: string }) => {
        const list = zsets.get(key) ?? [];
        const index = list.findIndex((x) => x.member === value.member);
        if (index >= 0) list[index] = value;
        else list.push(value);
        list.sort((a, b) => a.score - b.score);
        zsets.set(key, list);
        return index >= 0 ? 0 : 1;
      }),
      zrange: vi.fn(async (key: string, start: number, stop: number, opts?: { rev?: boolean }) => {
        const list = [...(zsets.get(key) ?? [])];
        if (opts?.rev) list.reverse();
        const end = stop < 0 ? undefined : stop + 1;
        return list.slice(start, end).map((x) => x.member);
      }),
    },
  };
});

vi.mock("./redis", () => ({ redis: mocks.redis }));
vi.mock("./assinaturaChefeBot.server", () => ({
  statusAssinaturaChefeBot: mocks.statusAssinaturaChefeBot,
}));

import {
  confirmarLeadPaganteRadarVendas,
  obterOuCriarTokenIndicacaoRadarVendas,
  registrarLeadIndicacaoRadarVendas,
  statusAcessoRadarVendas,
} from "./radarVendasEntitlement.server";

beforeEach(() => {
  mocks.store.clear();
  mocks.zsets.clear();
  vi.clearAllMocks();
  mocks.statusAssinaturaChefeBot.mockResolvedValue({
    estado: { activePlanId: "basic" },
    avaliacao: { blocked: false },
  });
});

describe("Radar de Vendas — acesso e indicação", () => {
  test("plano Pro libera o Radar", async () => {
    mocks.statusAssinaturaChefeBot.mockResolvedValue({
      estado: { activePlanId: "pro" },
      avaliacao: { blocked: false },
    });
    expect(await statusAcessoRadarVendas()).toMatchObject({ ativo: true, fonte: "pro" });
  });

  test("plano Basic fica bloqueado sem indicação convertida", async () => {
    expect(await statusAcessoRadarVendas()).toMatchObject({ ativo: false, fonte: "bloqueado" });
  });

  test("uma indicação pagante confirmada concede desbloqueio permanente do módulo", async () => {
    const token = await obterOuCriarTokenIndicacaoRadarVendas();
    const registro = await registrarLeadIndicacaoRadarVendas({
      token,
      nome: "Carlos",
      pizzaria: "Pizza Centro",
      whatsapp: "(99) 99999-0000",
    });
    expect(registro.ok).toBe(true);
    if (!registro.ok) throw new Error("registro deveria ser válido");

    const convertido = await confirmarLeadPaganteRadarVendas(registro.leadId);
    expect(convertido.ok).toBe(true);
    expect(await statusAcessoRadarVendas()).toMatchObject({
      ativo: true,
      fonte: "indicacao",
      desbloqueioPermanente: true,
    });
  });

  test("só compartilhar não libera: lead novo sem conversão continua bloqueado", async () => {
    const token = await obterOuCriarTokenIndicacaoRadarVendas();
    await registrarLeadIndicacaoRadarVendas({
      token,
      nome: "Ana",
      pizzaria: "Pizza Norte",
      whatsapp: "99999999999",
    });
    expect(await statusAcessoRadarVendas()).toMatchObject({ ativo: false });
  });
});
