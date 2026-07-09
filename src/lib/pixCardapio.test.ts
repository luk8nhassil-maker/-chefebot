import { describe, expect, test } from "vitest";

import {
  derivarEstadoPagamentoPixCliente,
  montarLinkWhatsappComprovantePix,
  montarMensagemComprovantePix,
  normalizarWhatsappPizzaria,
} from "./pixCardapio";

describe("derivarEstadoPagamentoPixCliente", () => {
  test("pix pendente retorna aguardando", () => {
    expect(derivarEstadoPagamentoPixCliente({ pix: { status: "pendente" } })).toBe("aguardando");
  });

  test("pix confirmado retorna pago", () => {
    expect(derivarEstadoPagamentoPixCliente({ pix: { status: "confirmado" } })).toBe("pago");
  });

  test("pixConfirmado legado sem pix.status retorna pago", () => {
    expect(derivarEstadoPagamentoPixCliente({ pixConfirmado: true })).toBe("pago");
  });

  test("em_revisao retorna em_analise", () => {
    expect(derivarEstadoPagamentoPixCliente({ pix: { status: "em_revisao" } })).toBe("em_analise");
  });

  test("suspeito tambem retorna em_analise (cliente nunca ve 'suspeito')", () => {
    expect(derivarEstadoPagamentoPixCliente({ pix: { status: "suspeito" } })).toBe("em_analise");
  });

  test("pedido sem pix retorna undefined", () => {
    expect(derivarEstadoPagamentoPixCliente({})).toBeUndefined();
    expect(derivarEstadoPagamentoPixCliente(null)).toBeUndefined();
  });

  test("pix sem status (metadata minima) retorna aguardando", () => {
    expect(derivarEstadoPagamentoPixCliente({ pix: {} })).toBe("aguardando");
  });
});

describe("normalizarWhatsappPizzaria", () => {
  test("numero com mascara vira digitos com DDI 55", () => {
    expect(normalizarWhatsappPizzaria("(99) 98888-7777")).toBe("5599988887777");
  });

  test("numero ja com 55 nao duplica", () => {
    expect(normalizarWhatsappPizzaria("55 99 98888-7777")).toBe("5599988887777");
  });

  test("numero fixo de 8 digitos com DDD e aceito", () => {
    expect(normalizarWhatsappPizzaria("(99) 3222-1111")).toBe("559932221111");
  });

  test("numero curto retorna undefined", () => {
    expect(normalizarWhatsappPizzaria("98888")).toBeUndefined();
  });

  test("vazio retorna undefined", () => {
    expect(normalizarWhatsappPizzaria("")).toBeUndefined();
    expect(normalizarWhatsappPizzaria(undefined)).toBeUndefined();
  });
});

describe("montarLinkWhatsappComprovantePix", () => {
  test("monta link wa.me com pedido e valor na mensagem", () => {
    const link = montarLinkWhatsappComprovantePix({ whatsapp: "(99) 98888-7777", numeroPedido: 123, total: 52.5 });

    expect(link).toBeDefined();
    expect(link).toContain("https://wa.me/5599988887777?text=");
    const mensagem = decodeURIComponent(link!.split("text=")[1]);
    expect(mensagem).toContain("#123");
    expect(mensagem).toContain("R$ 52,50");
    expect(mensagem.toLowerCase()).toContain("comprovante");
  });

  test("sem numero configurado retorna undefined", () => {
    expect(montarLinkWhatsappComprovantePix({ whatsapp: "", numeroPedido: 1, total: 10 })).toBeUndefined();
  });

  test("mensagem sem numero de pedido usa texto generico", () => {
    expect(montarMensagemComprovantePix(undefined, 10)).toContain("um pedido");
    expect(montarMensagemComprovantePix(45, 10)).toContain("#45");
  });
});
