import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function carregarAuth() {
  vi.stubEnv("ADMIN_PASSWORD", "senha-oficial");
  vi.resetModules();
  return import("./auth");
}

describe("validateCredentials", () => {
  it("normaliza espaços externos do usuário e da senha", async () => {
    const { validateCredentials } = await carregarAuth();

    expect(validateCredentials("  BrItO  ", "  senha-oficial  ")).toEqual({
      username: "brito",
      name: "Brito",
      role: "admin",
    });
  });

  it("não aceita aliases nem senha diferente", async () => {
    const { validateCredentials } = await carregarAuth();

    expect(validateCredentials("admin", "senha-oficial")).toBeNull();
    expect(validateCredentials("brito", "senha-incorreta")).toBeNull();
  });
});
