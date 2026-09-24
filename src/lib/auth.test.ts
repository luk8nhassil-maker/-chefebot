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

describe("ROUTE_ROLES", () => {
  it("permite admin e dev apenas no painel específico de pesquisa antes do prefixo /dev", async () => {
    const { canAccess } = await carregarAuth();

    expect(canAccess("admin", "/dev/pesquisa-preferencia")).toBe(true);
    expect(canAccess("dev", "/dev/pesquisa-preferencia")).toBe(true);
    expect(canAccess("admin", "/dev")).toBe(false);
    expect(canAccess("admin", "/dev/redis-status")).toBe(false);
  });
});

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
