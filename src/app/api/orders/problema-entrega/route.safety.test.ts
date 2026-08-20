import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("problema-entrega — segurança e escalada", () => {
  test("Preview não pode escrever nem mandar WhatsApp", () => {
    const guard = source.indexOf('process.env.VERCEL_ENV !== "production"');
    const prepare = source.indexOf("const preparado = await prepararAcao");
    const send = source.indexOf("await enviarTextoWhatsApp");
    expect(guard).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(guard);
    expect(send).toBeGreaterThan(guard);
  });

  test("revalida a pendência antes de qualquer mutação de rota", () => {
    expect(source).toContain("const pendencia = classificarPendencia(pedido, agora)");
    expect(source).toContain('pendencia?.motivo !== "entrega_longa"');
  });

  test("delivery não pode adiar indefinidamente", () => {
    expect(source).toContain('modo === "delivery" && !clienteRespondeu && tentativasAtuais >= 2');
    expect(source).toContain("Agora informe o problema da entrega ou confirme que ela foi concluída.");
  });

  test("Salão nunca usa contato externo de entrega", () => {
    expect(source).toContain('modo === "dine_in"');
    expect(source).toContain("Consumo no local não usa contato de entrega.");
  });
});
