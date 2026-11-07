import { createHash, timingSafeEqual } from "node:crypto";

export type MetaBusinessAgentConnectorResult =
  | "disabled"
  | "invalid_configuration"
  | "authorized"
  | "unauthorized";

type Environment = Record<string, string | undefined>;

export function verificarMetaBusinessAgentConnector(
  authorization: string | null,
  env: Environment = process.env,
): MetaBusinessAgentConnectorResult {
  if (env.META_BUSINESS_AGENT_CONNECTOR_ENABLED !== "true") return "disabled";

  const secret = env.META_BUSINESS_AGENT_CONNECTOR_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) return "invalid_configuration";

  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
  const presented = match?.[1] ?? "";
  const expectedDigest = createHash("sha256").update(secret, "utf8").digest();
  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  return timingSafeEqual(expectedDigest, presentedDigest) ? "authorized" : "unauthorized";
}
