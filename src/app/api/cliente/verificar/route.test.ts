import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Sem mock de clienteAuth/clientes: exercita o fluxo real de ponta a ponta
// (OTP -> criarSessaoCliente -> cookie), só o Redis é substituído por um
// Map em memória — é o único jeito de garantir de verdade os atributos do
// cookie de sessão (15 dias) sem duplicar a lógica em um mock.
const store = new Map<string, unknown>();

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  },
}));

import { gerarOtp } from "@/lib/clienteAuth";
import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/cliente/verificar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store.clear();
});

describe("POST /api/cliente/verificar", () => {
  test("telefone invalido retorna 400", async () => {
    const res = await POST(req({ telefone: "123", codigo: "111111" }));
    expect(res.status).toBe(400);
  });

  test("sem codigo retorna 400", async () => {
    const res = await POST(req({ telefone: "11999998888" }));
    expect(res.status).toBe(400);
  });

  test("codigo errado ou inexistente retorna 401, sem criar sessao", async () => {
    const res = await POST(req({ telefone: "11999998888", codigo: "000000" }));
    expect(res.status).toBe(401);
    expect(store.has("cliente:sessao:cli_11999998888")).toBe(false);
  });

  test("codigo correto cria sessao de 15 dias, devolve dados publicos e seta o cookie", async () => {
    const codigo = await gerarOtp("11999998888");
    const res = await POST(req({ telefone: "11999998888", codigo }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.cliente.telefone).toBe("11999998888");
    expect(data.cliente.clienteId).toBeUndefined();

    const setCookie = (res.headers.get("set-cookie") || "").toLowerCase();
    expect(setCookie).toContain("cliente-token=");
    expect(setCookie).toContain("httponly");
    expect(setCookie).toContain("samesite=lax");
    expect(setCookie).toContain("max-age=1296000"); // 15 dias em segundos
    expect(setCookie).toContain("path=/");

    expect(store.has("cliente:sessao:cli_11999998888")).toBe(true);
  });

  test("codigo so pode ser usado uma vez (OTP consumido)", async () => {
    const codigo = await gerarOtp("11999998888");
    await POST(req({ telefone: "11999998888", codigo }));
    const segunda = await POST(req({ telefone: "11999998888", codigo }));
    expect(segunda.status).toBe(401);
  });
});
