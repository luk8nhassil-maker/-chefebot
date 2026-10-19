import { describe, expect, test } from "vitest";
import { configuracaoRolloutInboxWhatsapp, inboxWhatsappHabilitadaPara } from "./whatsappInboxRollout";

const A = "5511900000001", B = "5511900000002", C = "5511900000003";
const env = { VERCEL_ENV: "production", WHATSAPP_INBOX_ROLLOUT: "allowlist", WHATSAPP_INBOX_ALLOWED_PHONES: A + "," + B };

describe("seleção gradual da inbox no servidor", () => {
  test("padrão off e modo desconhecido não selecionam ninguém", () => {
    expect(inboxWhatsappHabilitadaPara(A, {})).toBe(false);
    expect(inboxWhatsappHabilitadaPara(A, { ...env, WHATSAPP_INBOX_ROLLOUT: "canary" })).toBe(false);
  });
  test("somente números completos expressamente listados são selecionados", () => {
    expect(inboxWhatsappHabilitadaPara(A, env)).toBe(true);
    expect(inboxWhatsappHabilitadaPara(B, env)).toBe(true);
    expect(inboxWhatsappHabilitadaPara(C, env)).toBe(false);
    expect(inboxWhatsappHabilitadaPara(A.slice(2), env)).toBe(false);
  });
  test.each(["", "*", "55*", "11900000001", A + ",", A + ",invalid", "+55 (11) 90000-0001"])("lista inválida %s falha fechada inteira", raw => {
    const config = configuracaoRolloutInboxWhatsapp({ ...env, WHATSAPP_INBOX_ALLOWED_PHONES: raw });
    expect(config.enabled).toBe(false);
    expect(config.valid).toBe(false);
    expect(inboxWhatsappHabilitadaPara(A, { ...env, WHATSAPP_INBOX_ALLOWED_PHONES: raw })).toBe(false);
  });
  test("espaços entre entradas e duplicatas não ampliam o grupo", () => {
    const config = configuracaoRolloutInboxWhatsapp({ ...env, WHATSAPP_INBOX_ALLOWED_PHONES: " " + A + " , " + A });
    expect(config.phones).toEqual([A]);
  });
  test("Preview bloqueia lista e all mesmo com configuração válida", () => {
    expect(inboxWhatsappHabilitadaPara(A, { ...env, VERCEL_ENV: "preview" })).toBe(false);
    expect(inboxWhatsappHabilitadaPara(A, { ...env, VERCEL_ENV: "preview", WHATSAPP_INBOX_ROLLOUT: "all" })).toBe(false);
  });
  test("all explícito preserva compatibilidade e off prevalece sobre lista", () => {
    expect(inboxWhatsappHabilitadaPara(C, { ...env, WHATSAPP_INBOX_ROLLOUT: "all" })).toBe(true);
    expect(inboxWhatsappHabilitadaPara(A, { ...env, WHATSAPP_INBOX_ROLLOUT: "off" })).toBe(false);
  });
  test("lista excessiva não ativa processamento", () => {
    expect(inboxWhatsappHabilitadaPara(A, { ...env, WHATSAPP_INBOX_ALLOWED_PHONES: A + ", ".repeat(8192) })).toBe(false);
  });
});
