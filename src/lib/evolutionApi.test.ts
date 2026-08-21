import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { obterConfigEvolution } from "./evolutionApi";

const ENV_KEYS = [
  "EVOLUTION_API_URL",
  "EVOLUTION_API_KEY",
  "EVOLUTION_INSTANCE_NAME",
  "EVOLUTION_WEBHOOK_URL",
] as const;
const originais: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) originais[key] = process.env[key];
  process.env.EVOLUTION_API_URL = "https://evolution.exemplo.com";
  process.env.EVOLUTION_API_KEY = "chave-teste";
  process.env.EVOLUTION_INSTANCE_NAME = "chefebot";
  delete process.env.EVOLUTION_WEBHOOK_URL;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originais[key] === undefined) delete process.env[key];
    else process.env[key] = originais[key];
  }
});

describe("obterConfigEvolution - webhook", () => {
  test("usa o domínio oficial quando EVOLUTION_WEBHOOK_URL não está configurada", () => {
    expect(obterConfigEvolution()?.webhookUrl).toBe("https://chefedapizza.com.br/api/whatsapp");
  });

  test("corrige a env legada do chefebot-pjif para o domínio oficial", () => {
    process.env.EVOLUTION_WEBHOOK_URL = "https://chefebot-pjif.vercel.app/api/whatsapp";

    expect(obterConfigEvolution()?.webhookUrl).toBe("https://chefedapizza.com.br/api/whatsapp");
  });

  test("corrige a env legada mesmo com barra final e espaços", () => {
    process.env.EVOLUTION_WEBHOOK_URL = "  https://chefebot-pjif.vercel.app/api/whatsapp/  ";

    expect(obterConfigEvolution()?.webhookUrl).toBe("https://chefedapizza.com.br/api/whatsapp");
  });

  test("preserva uma URL explicitamente personalizada que não seja o host legado conhecido", () => {
    process.env.EVOLUTION_WEBHOOK_URL = "https://webhook.exemplo.com/evolution";

    expect(obterConfigEvolution()?.webhookUrl).toBe("https://webhook.exemplo.com/evolution");
  });
});
