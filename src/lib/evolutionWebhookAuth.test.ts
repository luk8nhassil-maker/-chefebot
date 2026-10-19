import { describe, expect, it } from "vitest";
import { verificarWebhookEvolution, webhookEvolutionProtegido } from "./evolutionWebhookAuth";

const secret = "test_only_evolution_webhook_secret_1234567890";

describe("proteção de ingresso Evolution", () => {
  it("preserva webhook legado sem segredo configurado", () => {
    expect(verificarWebhookEvolution(null, {})).toBe("legacy_unconfigured");
    expect(webhookEvolutionProtegido({})).toBe(false);
  });
  it("falha fechada com segredo curto ou parcialmente configurado", () => {
    const env = { EVOLUTION_WEBHOOK_SHARED_SECRET: "curto" };
    expect(verificarWebhookEvolution("curto", env)).toBe("invalid_configuration");
    expect(webhookEvolutionProtegido(env)).toBe(false);
  });
  it("autoriza apenas o segredo integral recebido no cabeçalho", () => {
    const env = { EVOLUTION_WEBHOOK_SHARED_SECRET: secret };
    expect(verificarWebhookEvolution(secret, env)).toBe("authorized");
    expect(webhookEvolutionProtegido(env)).toBe(true);
    expect(verificarWebhookEvolution(null, env)).toBe("unauthorized");
    expect(verificarWebhookEvolution(secret.slice(0, -1), env)).toBe("unauthorized");
    expect(verificarWebhookEvolution("Bearer " + secret, env)).toBe("unauthorized");
  });
  it("não aceita valor vazio nem segredo parecido", () => {
    const env = { EVOLUTION_WEBHOOK_SHARED_SECRET: secret };
    expect(verificarWebhookEvolution("", env)).toBe("unauthorized");
    expect(verificarWebhookEvolution(secret + " ", env)).toBe("unauthorized");
  });
});
