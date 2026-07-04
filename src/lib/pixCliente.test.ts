import { describe, expect, test } from "vitest";

import { montarLinkWhatsAppComprovante, montarMensagemComprovantePix, normalizarWhatsAppPizzaria } from "./pixCliente";

describe("helpers Pix do cliente", () => {
  test("normaliza WhatsApp da pizzaria para link wa.me", () => {
    expect(normalizarWhatsAppPizzaria("(99) 97400-0691")).toBe("5599974000691");
    expect(normalizarWhatsAppPizzaria("5599974000691")).toBe("5599974000691");
    expect(normalizarWhatsAppPizzaria("9999")).toBeUndefined();
  });

  test("monta mensagem com pedido e valor correto", () => {
    expect(montarMensagemComprovantePix({ pedidoId: "abc", numero: 123, total: 42.5 })).toBe(
      "Olá, fiz o pedido #123 pelo cardápio no valor de R$ 42,50. Segue o comprovante do Pix."
    );
  });

  test("monta link WhatsApp com mensagem pre-preenchida", () => {
    const link = montarLinkWhatsAppComprovante("(99) 97400-0691", { pedidoId: "abc", numero: 123, total: 42.5 });

    expect(link).toContain("https://wa.me/5599974000691?text=");
    expect(decodeURIComponent(link!.split("text=")[1])).toBe(
      "Olá, fiz o pedido #123 pelo cardápio no valor de R$ 42,50. Segue o comprovante do Pix."
    );
  });
});
