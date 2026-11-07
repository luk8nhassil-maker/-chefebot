import { describe, expect, it } from "vitest";
import { verificarMetaBusinessAgentConnector } from "./metaBusinessAgentConnector";

const SECRET = "test_only_meta_agent_connector_secret_32_chars";

describe("autorização da ponte do Meta Business Agent", () => {
  it("fica desligada por padrão", () => {
    expect(verificarMetaBusinessAgentConnector(null, {})).toBe("disabled");
  });

  it("falha fechada se o segredo não existir ou for curto", () => {
    expect(verificarMetaBusinessAgentConnector(null, {
      META_BUSINESS_AGENT_CONNECTOR_ENABLED: "true",
    })).toBe("invalid_configuration");
    expect(verificarMetaBusinessAgentConnector("Bearer short", {
      META_BUSINESS_AGENT_CONNECTOR_ENABLED: "true",
      META_BUSINESS_AGENT_CONNECTOR_SECRET: "short",
    })).toBe("invalid_configuration");
  });

  it("aceita apenas o segredo correto no formato Bearer", () => {
    const env = {
      META_BUSINESS_AGENT_CONNECTOR_ENABLED: "true",
      META_BUSINESS_AGENT_CONNECTOR_SECRET: SECRET,
    };
    expect(verificarMetaBusinessAgentConnector(`Bearer ${SECRET}`, env)).toBe("authorized");
    expect(verificarMetaBusinessAgentConnector(SECRET, env)).toBe("unauthorized");
    expect(verificarMetaBusinessAgentConnector(`Bearer ${SECRET} `, env)).toBe("unauthorized");
    expect(verificarMetaBusinessAgentConnector("Bearer wrong", env)).toBe("unauthorized");
  });
});
