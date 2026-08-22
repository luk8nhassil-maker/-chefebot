import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { redis } from "@/lib/redis";

export type MercadoPagoIntegrationConfig = {
  provider: "mercadopago";
  enabled: boolean;
  accessTokenEncrypted?: string;
  accessTokenLast4?: string;
  payerEmailFallback?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestMessage?: string;
  updatedAt: string;
  updatedBy?: string;
};

export type MercadoPagoIntegrationPublicConfig = {
  provider: "mercadopago";
  enabled: boolean;
  configured: boolean;
  tokenMasked: string | null;
  payerEmailFallback?: string;
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestMessage?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export const MERCADO_PAGO_INTEGRATION_KEY = "integracao:mercadopago";

const PROVIDER = "mercadopago" as const;
const ENCRYPTION_PREFIX = "v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET || "chefebot-dev-secret-troque-em-producao";
  return createHash("sha256").update(secret).digest();
}

export function encryptMercadoPagoToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) throw new Error("accessToken vazio");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptMercadoPagoToken(encrypted: string | undefined): string | null {
  if (!encrypted) return null;

  const [version, iv, authTag, data] = encrypted.split(".");
  if (version !== ENCRYPTION_PREFIX || !iv || !authTag || !data) return null;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(iv, "base64url"),
      { authTagLength: AUTH_TAG_LENGTH }
    );
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskMercadoPagoToken(last4: string | undefined): string | null {
  const cleanLast4 = typeof last4 === "string" ? last4.trim() : "";
  if (!cleanLast4) return null;
  return `********${cleanLast4.slice(-4)}`;
}

export function toMercadoPagoPublicConfig(
  config: MercadoPagoIntegrationConfig | null
): MercadoPagoIntegrationPublicConfig {
  return {
    provider: PROVIDER,
    enabled: Boolean(config?.enabled),
    configured: Boolean(config?.accessTokenEncrypted),
    tokenMasked: maskMercadoPagoToken(config?.accessTokenLast4),
    ...(config?.payerEmailFallback ? { payerEmailFallback: config.payerEmailFallback } : {}),
    ...(config?.lastTestAt ? { lastTestAt: config.lastTestAt } : {}),
    ...(typeof config?.lastTestOk === "boolean" ? { lastTestOk: config.lastTestOk } : {}),
    ...(config?.lastTestMessage ? { lastTestMessage: config.lastTestMessage } : {}),
    ...(config?.updatedAt ? { updatedAt: config.updatedAt } : {}),
    ...(config?.updatedBy ? { updatedBy: config.updatedBy } : {}),
  };
}

export async function getMercadoPagoIntegrationConfig(): Promise<MercadoPagoIntegrationConfig | null> {
  return await redis.get<MercadoPagoIntegrationConfig>(MERCADO_PAGO_INTEGRATION_KEY);
}

export async function saveMercadoPagoIntegrationConfig(
  config: MercadoPagoIntegrationConfig
): Promise<MercadoPagoIntegrationConfig> {
  await redis.set(MERCADO_PAGO_INTEGRATION_KEY, config);
  return config;
}

export type UpdateMercadoPagoIntegrationInput = {
  enabled?: boolean;
  accessToken?: string;
  clearToken?: boolean;
  payerEmailFallback?: string;
  updatedBy?: string;
};

export async function updateMercadoPagoIntegrationConfig(
  input: UpdateMercadoPagoIntegrationInput
): Promise<MercadoPagoIntegrationConfig> {
  const existing = await getMercadoPagoIntegrationConfig();
  const next: MercadoPagoIntegrationConfig = {
    provider: PROVIDER,
    enabled: typeof input.enabled === "boolean" ? input.enabled : Boolean(existing?.enabled),
    ...(existing?.accessTokenEncrypted ? { accessTokenEncrypted: existing.accessTokenEncrypted } : {}),
    ...(existing?.accessTokenLast4 ? { accessTokenLast4: existing.accessTokenLast4 } : {}),
    ...(existing?.payerEmailFallback ? { payerEmailFallback: existing.payerEmailFallback } : {}),
    ...(existing?.lastTestAt ? { lastTestAt: existing.lastTestAt } : {}),
    ...(typeof existing?.lastTestOk === "boolean" ? { lastTestOk: existing.lastTestOk } : {}),
    ...(existing?.lastTestMessage ? { lastTestMessage: existing.lastTestMessage } : {}),
    updatedAt: new Date().toISOString(),
    ...(input.updatedBy ? { updatedBy: input.updatedBy } : existing?.updatedBy ? { updatedBy: existing.updatedBy } : {}),
  };

  if (input.clearToken) {
    delete next.accessTokenEncrypted;
    delete next.accessTokenLast4;
  } else if (typeof input.accessToken === "string" && input.accessToken.trim()) {
    const token = input.accessToken.trim();
    next.accessTokenEncrypted = encryptMercadoPagoToken(token);
    next.accessTokenLast4 = token.slice(-4);
  }

  if (input.payerEmailFallback !== undefined) {
    const email = input.payerEmailFallback.trim();
    if (email) next.payerEmailFallback = email;
    else delete next.payerEmailFallback;
  }

  return await saveMercadoPagoIntegrationConfig(next);
}

export async function resolveActiveMercadoPagoToken(): Promise<string | null> {
  const config = await getMercadoPagoIntegrationConfig();
  if (config?.enabled && config.accessTokenEncrypted) {
    const decrypted = decryptMercadoPagoToken(config.accessTokenEncrypted);
    if (decrypted) return decrypted;
  }
  return process.env.MERCADOPAGO_ACCESS_TOKEN || null;
}

export type MercadoPagoAuthResolution = {
  active: boolean;
  source: "admin" | "env" | "none";
  accessToken: string | null;
  payerEmailFallback?: string;
};

// Decide de onde vem a credencial usada para criar a cobranca Pix (Nivel 5.6):
// o painel admin (Redis, token criptografado) e a fonte preferencial quando
// habilitado e com token valido; PIX_PROVIDER=mercadopago + env continua
// funcionando como fallback/legado quando o painel nao esta ativo.
export async function resolveActiveMercadoPagoAuth(): Promise<MercadoPagoAuthResolution> {
  const config = await getMercadoPagoIntegrationConfig();
  if (config?.enabled && config.accessTokenEncrypted) {
    const decrypted = decryptMercadoPagoToken(config.accessTokenEncrypted);
    if (decrypted) {
      const payerEmailFallback = config.payerEmailFallback || process.env.MERCADOPAGO_PAYER_EMAIL_FALLBACK;
      return {
        active: true,
        source: "admin",
        accessToken: decrypted,
        ...(payerEmailFallback ? { payerEmailFallback } : {}),
      };
    }
  }

  if (process.env.PIX_PROVIDER === "mercadopago") {
    const payerEmailFallback = config?.payerEmailFallback || process.env.MERCADOPAGO_PAYER_EMAIL_FALLBACK;
    return {
      active: true,
      source: "env",
      accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || null,
      ...(payerEmailFallback ? { payerEmailFallback } : {}),
    };
  }

  return { active: false, source: "none", accessToken: null };
}
