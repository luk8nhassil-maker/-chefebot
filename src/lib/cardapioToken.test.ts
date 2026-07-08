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

vi.mock("./redis", () => ({ redis: redisMock }));

import {
  criarOuReutilizarTokenCardapio,
  validarTokenCardapio,
  anexarTokenAoLinkCardapio,
  mascararPhone,
  CARDAPIO_TOKEN_TTL_SEGUNDOS,
} from "./cardapioToken";
import { LINK_CARDAPIO_DIGITAL } from "./bot";

const PHONE = "5599974000691";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("criarOuReutilizarTokenCardapio", () => {
  it("gera token opaco de 32 hex e salva token→phone no Redis com TTL", async () => {
    const token = await criarOuReutilizarTokenCardapio(PHONE);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    const payload = store.get(`cardapio:token:${token}`) as { phone: string };
    expect(payload.phone).toBe(PHONE);
    // toda escrita do token vai com TTL
    const setComTtl = redisMock.set.mock.calls.filter(c => String(c[0]).startsWith("cardapio:token"));
    expect(setComTtl.length).toBeGreaterThan(0);
    for (const call of setComTtl) {
      expect(call[2]).toEqual({ ex: CARDAPIO_TOKEN_TTL_SEGUNDOS });
    }
  });

  it("o token NÃO expõe o telefone (nem parte dele)", async () => {
    const token = await criarOuReutilizarTokenCardapio(PHONE);
    expect(token).not.toContain(PHONE);
    expect(token).not.toContain(PHONE.slice(-8));
    expect(`${LINK_CARDAPIO_DIGITAL}?t=${token}`).not.toContain(PHONE.slice(-8));
  });

  it("reutiliza o token existente do mesmo phone (renovando TTL)", async () => {
    const t1 = await criarOuReutilizarTokenCardapio(PHONE);
    const t2 = await criarOuReutilizarTokenCardapio(PHONE);
    expect(t2).toBe(t1);
  });

  it("phones diferentes recebem tokens diferentes", async () => {
    const t1 = await criarOuReutilizarTokenCardapio(PHONE);
    const t2 = await criarOuReutilizarTokenCardapio("5511911112222");
    expect(t2).not.toBe(t1);
  });
});

describe("validarTokenCardapio", () => {
  it("token válido resolve para o phone correto", async () => {
    const token = await criarOuReutilizarTokenCardapio(PHONE);
    const r = await validarTokenCardapio(token);
    expect(r).toEqual({ phone: PHONE });
  });

  it("token inexistente/expirado (não está no Redis) → null", async () => {
    const r = await validarTokenCardapio("a".repeat(32));
    expect(r).toBeNull();
  });

  it("token com formato inválido → null SEM consultar o Redis", async () => {
    for (const ruim of ["", "abc", "x".repeat(32), "5599974000691", "../../etc", null, undefined]) {
      const r = await validarTokenCardapio(ruim as never);
      expect(r).toBeNull();
    }
    expect(redisMock.get).not.toHaveBeenCalled();
  });
});

describe("anexarTokenAoLinkCardapio", () => {
  const TOKEN = "f".repeat(32);

  it("injeta ?t= no link do cardápio dentro da mensagem", () => {
    const msg = `Oi! Pode pedir por aqui.\n\nSe preferir ver o cardápio digital, é só acessar:\n${LINK_CARDAPIO_DIGITAL}`;
    const out = anexarTokenAoLinkCardapio(msg, TOKEN);
    expect(out).toContain(`${LINK_CARDAPIO_DIGITAL}?t=${TOKEN}`);
  });

  it("não duplica ?t= se o link já tem token", () => {
    const msg = `Cardápio: ${LINK_CARDAPIO_DIGITAL}?t=${TOKEN}`;
    const out = anexarTokenAoLinkCardapio(msg, "a".repeat(32));
    expect(out).toBe(msg);
  });

  it("mensagem sem o link fica intacta", () => {
    const msg = "Qual a forma de pagamento?";
    expect(anexarTokenAoLinkCardapio(msg, TOKEN)).toBe(msg);
  });
});

describe("mascararPhone", () => {
  it("devolve só os 4 últimos dígitos", () => {
    expect(mascararPhone(PHONE)).toBe("0691");
    expect(mascararPhone("(99) 9 7400-0691")).toBe("0691");
  });
});
