import { describe, expect, it } from "vitest";
import { assinaturaChefeBotAtiva } from "./assinaturaChefeBotAtivacao";

describe("assinatura ChefeBot — ativação operacional", () => {
  it("fica ativa em produção quando a flag está ausente", () => {
    expect(assinaturaChefeBotAtiva({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("fica desligada em produção somente quando a flag está false", () => {
    expect(assinaturaChefeBotAtiva({
      VERCEL_ENV: "production",
      ASSINATURA_CHEFEBOT_ENABLED: "false",
    })).toBe(false);
  });

  it("permanece ativa em produção quando a flag está true", () => {
    expect(assinaturaChefeBotAtiva({
      VERCEL_ENV: "production",
      ASSINATURA_CHEFEBOT_ENABLED: "true",
    })).toBe(true);
  });

  it("permanece ativa fora de produção para validar a UX com segurança", () => {
    expect(assinaturaChefeBotAtiva({ VERCEL_ENV: "preview" })).toBe(true);
    expect(assinaturaChefeBotAtiva({ VERCEL_ENV: "development" })).toBe(true);
    expect(assinaturaChefeBotAtiva({})).toBe(true);
  });
});
