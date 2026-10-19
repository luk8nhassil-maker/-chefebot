import { createHash, timingSafeEqual } from "node:crypto";

// Cabeçalho estático por instância na Evolution. Nunca aceitar payload ou query como segredo.
export const EVOLUTION_WEBHOOK_AUTH_HEADER = "x-chefebot-evolution-secret";
type Environment = Record<string, string | undefined>;

export type EvolutionWebhookAuthResult = "legacy_unconfigured" | "invalid_configuration" | "authorized" | "unauthorized";

export function webhookEvolutionProtegido(env: Environment = process.env): boolean {
  return (env.EVOLUTION_WEBHOOK_SHARED_SECRET?.length ?? 0) >= 32;
}

export function verificarWebhookEvolution(
  presented: string | null,
  env: Environment = process.env,
): EvolutionWebhookAuthResult {
  const expected = env.EVOLUTION_WEBHOOK_SHARED_SECRET;
  if (!expected) return "legacy_unconfigured";
  // Um segredo fraco ou incompleto não pode ser tratado como proteção funcional.
  if (expected.length < 32) return "invalid_configuration";
  const actual = presented ?? "";
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  return timingSafeEqual(expectedDigest, actualDigest) ? "authorized" : "unauthorized";
}
