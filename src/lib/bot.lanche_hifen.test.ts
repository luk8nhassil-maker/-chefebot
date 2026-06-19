import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./redis", () => ({ redis: { get: vi.fn().mockResolvedValue(null) } }));

import { processMessage, createInitialSession, setEsgotados, setHorarioFuncionamento, type BotSession } from "./bot";

function sessaoName(): BotSession {
  return { ...createInitialSession(), step: "name" };
}

beforeEach(() => {
  setEsgotados([]);
  setHorarioFuncionamento("22h");
});

// ─── pedido completo — lanche com hífen, espaço e texto colado ───────────────

describe("processarPedidoCompleto — lanche com variações de escrita", () => {
  // X-Burguer
  it("'quero um x-burguer pix' reconhece X-Burguer", () => {
    const res = processMessage("quero um x-burguer pix", sessaoName());
    expect(res.session.cart.some(i => i.name === "X-Burguer")).toBe(true);
  });

  it("'quero um x burguer pix' reconhece X-Burguer", () => {
    const res = processMessage("quero um x burguer pix", sessaoName());
    expect(res.session.cart.some(i => i.name === "X-Burguer")).toBe(true);
  });

  it("'quero um xburguer pix' reconhece X-Burguer", () => {
    const res = processMessage("quero um xburguer pix", sessaoName());
    expect(res.session.cart.some(i => i.name === "X-Burguer")).toBe(true);
  });

  // X-Tudo
  it("'manda um x-tudo pix' reconhece X-Tudo", () => {
    const res = processMessage("manda um x-tudo pix", sessaoName());
    expect(res.session.cart.some(i => i.name === "X-Tudo")).toBe(true);
  });

  it("'manda um x tudo pix' reconhece X-Tudo", () => {
    const res = processMessage("manda um x tudo pix", sessaoName());
    expect(res.session.cart.some(i => i.name === "X-Tudo")).toBe(true);
  });

  it("'manda um xtudo pix' reconhece X-Tudo", () => {
    const res = processMessage("manda um xtudo pix", sessaoName());
    expect(res.session.cart.some(i => i.name === "X-Tudo")).toBe(true);
  });
});
