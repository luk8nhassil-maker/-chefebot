import { describe, test, expect } from "vitest";
import { interpretarRespostaReset } from "./whatsappResetResposta";

describe("interpretarRespostaReset — { ok: true, estado: 'connected' } sem QR nunca é tratado como erro", () => {
  test("conectado sem qrcode: status conectado, sem QR, sem mensagem de erro", () => {
    const resultado = interpretarRespostaReset({ ok: true, estado: "connected" });
    expect(resultado.tipo).toBe("connected");
    // Garante que nao existe nenhum campo de erro/mensagem no resultado "connected"
    expect((resultado as { mensagem?: string }).mensagem).toBeUndefined();
    expect((resultado as { base64?: string }).base64).toBeUndefined();
  });

  test("conectado com qrcode presente (reconstrucao): trata como QR, nunca como 'connected' puro", () => {
    const resultado = interpretarRespostaReset({ ok: true, estado: "qr_required", qrcode: { base64: "ABC123" } });
    expect(resultado.tipo).toBe("qr");
    expect((resultado as { base64: string }).base64).toBe("ABC123");
  });

  test("falha (ok:false) com mensagem: reporta a mensagem, nunca 'connected'", () => {
    const resultado = interpretarRespostaReset({ ok: false, error: "Falha ao criar instância" });
    expect(resultado.tipo).toBe("erro");
    expect((resultado as { mensagem: string }).mensagem).toBe("Falha ao criar instância");
  });

  test("falha sem mensagem: usa mensagem padrao, nunca 'connected'", () => {
    const resultado = interpretarRespostaReset({ ok: false });
    expect(resultado.tipo).toBe("erro");
    expect((resultado as { mensagem: string }).mensagem).toContain("Não foi possível resetar");
  });

  test("resposta vazia/invalida: trata como erro com mensagem padrao, nunca lanca excecao", () => {
    expect(() => interpretarRespostaReset(null)).not.toThrow();
    const resultado = interpretarRespostaReset(undefined);
    expect(resultado.tipo).toBe("erro");
  });

  test("qrcode com metadados de geração: repassa generatedAt/expiresAt/generationId", () => {
    const resultado = interpretarRespostaReset({
      ok: true,
      estado: "qr_required",
      qrcode: { base64: "ABC123", generatedAt: 1000, expiresAt: 31000, generationId: 1000 },
    });
    expect(resultado.tipo).toBe("qr");
    expect((resultado as { generatedAt?: number }).generatedAt).toBe(1000);
    expect((resultado as { expiresAt?: number }).expiresAt).toBe(31000);
    expect((resultado as { generationId?: number }).generationId).toBe(1000);
  });
});
