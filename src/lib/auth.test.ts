import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function carregarAuth() {
  vi.stubEnv("KELLYNE_PASSWORD", "senha-oficial");
  vi.resetModules();
  return import("./auth");
}

describe("validateCredentials", () => {
  it("normaliza espaços externos do usuário e da senha", async () => {
    const { validateCredentials } = await carregarAuth();

    expect(validateCredentials("  KeLlYnE  ", "  senha-oficial  ")).toEqual({
      username: "kellyne",
      name: "Kellyne",
      role: "admin",
    });
  });

  it("não aceita aliases, o administrador antigo nem senha diferente", async () => {
    const { validateCredentials } = await carregarAuth();

    expect(validateCredentials("admin", "senha-oficial")).toBeNull();
    expect(validateCredentials("brito", "senha-oficial")).toBeNull();
    expect(validateCredentials("kellyne", "senha-incorreta")).toBeNull();
  });
});
