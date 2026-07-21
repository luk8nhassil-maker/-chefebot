import { describe, test, expect } from "vitest";
import { ehEventoQrAtualizado, extrairQrBase64, normalizarEventoWebhook } from "./evolutionApi";

describe("normalizarEventoWebhook", () => {
  test("normaliza SCREAMING_SNAKE_CASE para dot-case minúsculo", () => {
    expect(normalizarEventoWebhook("QRCODE_UPDATED")).toBe("qrcode.updated");
    expect(normalizarEventoWebhook("CONNECTION_UPDATE")).toBe("connection.update");
  });

  test("já em dot-case minúsculo permanece igual", () => {
    expect(normalizarEventoWebhook("qrcode.updated")).toBe("qrcode.updated");
  });

  test("valores não-string nunca lançam, viram string vazia", () => {
    expect(normalizarEventoWebhook(undefined)).toBe("");
    expect(normalizarEventoWebhook(null)).toBe("");
    expect(normalizarEventoWebhook(123)).toBe("");
  });
});

describe("ehEventoQrAtualizado", () => {
  test("reconhece as variações conhecidas do evento de rotação de QR", () => {
    expect(ehEventoQrAtualizado("QRCODE_UPDATED")).toBe(true);
    expect(ehEventoQrAtualizado("qrcode.updated")).toBe(true);
    expect(ehEventoQrAtualizado("QR_UPDATED")).toBe(true);
    expect(ehEventoQrAtualizado("qr.update")).toBe(true);
  });

  test("nunca confunde com connection.update ou messages.upsert", () => {
    expect(ehEventoQrAtualizado("connection.update")).toBe(false);
    expect(ehEventoQrAtualizado("messages.upsert")).toBe(false);
    expect(ehEventoQrAtualizado(undefined)).toBe(false);
  });
});

describe("extrairQrBase64 — variações de formato já observadas na Evolution", () => {
  test("campo base64 direto", () => {
    expect(extrairQrBase64({ base64: "ABC" })).toBe("ABC");
  });

  test("aninhado em qrcode.base64", () => {
    expect(extrairQrBase64({ qrcode: { base64: "DEF" } })).toBe("DEF");
  });

  test("aninhado em qr.base64", () => {
    expect(extrairQrBase64({ qr: { base64: "GHI" } })).toBe("GHI");
  });

  test("payload sem QR reconhecível devolve null, nunca lança", () => {
    expect(extrairQrBase64({})).toBeNull();
    expect(extrairQrBase64(null)).toBeNull();
    expect(extrairQrBase64(undefined)).toBeNull();
  });
});
