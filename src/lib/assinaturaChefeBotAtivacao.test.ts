import { describe, expect, it } from "vitest";
import { assinaturaChefeBotAtiva } from "./assinaturaChefeBotAtivacao";

describe("assinatura ChefeBot — ativação operacional", () => {
  it("fica ativa em produção quando não há kill switch por ambiente", () => {
    expect(assinaturaChefeBotAtiva({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("continua desligada em produção mesmo se a flag antiga estiver false", () => {
    expect(assinaturaChefeBotAtiva({
      VERCEL_ENV: "production",
      ASSINATURA_CHEFEBOT_ENABLED: "false",
    })).toBe(false);
  });

  it("fica ativa em produção quando a flag operacional está true", () => {
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
