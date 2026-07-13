import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

import { redis } from "@/lib/redis";
import { criarSessaoCliente, resolverSessaoCliente } from "@/lib/clienteAuth";
import { obterOuCriarCliente } from "@/lib/clientes";
import { POST } from "./route";
import { GET as GET_PERFIL } from "../perfil/route";

function req(token?: string) {
  const init = token ? { method: "POST", headers: { cookie: `cliente-token=${token}` } } : { method: "POST" };
  return new NextRequest("http://localhost/api/cliente/logout", init);
}

function requestComCookie(token?: string) {
  const init = token ? { headers: { cookie: `cliente-token=${token}` } } : undefined;
  return new NextRequest("http://localhost/api/cliente/perfil", init);
}

beforeEach(() => {
  store.clear();
});

describe("POST /api/cliente/logout", () => {
  test("sem cookie: nao falha, so limpa o cookie (nada para invalidar)", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
  });

  test("invalida a sessao imediatamente no servidor — token antigo deixa de resolver", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    expect(await resolverSessaoCliente(requestComCookie(token))).not.toBeNull();

    await POST(req(token));

    expect(await resolverSessaoCliente(requestComCookie(token))).toBeNull();
  });

  test("limpa o cookie no navegador (Max-Age=0)", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    const res = await POST(req(token));
    const setCookie = (res.headers.get("set-cookie") || "").toLowerCase();
    expect(setCookie).toContain("max-age=0");
  });

  test("token invalido/adulterado: nao lanca erro, so limpa o cookie", async () => {
    const res = await POST(req("token-adulterado"));
    expect(res.status).toBe(200);
    const setCookie = (res.headers.get("set-cookie") || "").toLowerCase();
    expect(setCookie).toContain("max-age=0");
  });

  describe("Nível 6.6.1 — cookie sempre limpo, mesmo se o Redis falhar", () => {
    test("falha simulada do Redis na invalidacao ainda assim remove o cookie, com resposta explicita de indisponibilidade", async () => {
      const cliente = await obterOuCriarCliente("11999998888");
      const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

      vi.mocked(redis.del).mockImplementationOnce(async () => {
        throw new Error("Redis indisponivel");
      });

      const res = await POST(req(token));
      const data = await res.json();
      const setCookie = (res.headers.get("set-cookie") || "").toLowerCase();

      expect(res.status).toBe(503);
      expect(data.ok).toBe(false);
      expect(setCookie).toContain("cliente-token=");
      expect(setCookie).toContain("max-age=0");
    });

    test("erro logado no console nunca inclui o token", async () => {
      const cliente = await obterOuCriarCliente("11999998888");
      const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });
      vi.mocked(redis.del).mockImplementationOnce(async () => {
        throw new Error("Redis indisponivel");
      });
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      await POST(req(token));

      const chamadas = spy.mock.calls.map((args) => args.join(" "));
      expect(chamadas.some((linha) => linha.includes(token))).toBe(false);
      spy.mockRestore();
    });
  });

  test("token reutilizado apos logout normal recebe 401 numa rota protegida (nao so no helper de sessao)", async () => {
    const cliente = await obterOuCriarCliente("11999998888");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    await POST(req(token));

    const resPerfil = await GET_PERFIL(requestComCookie(token));
    expect(resPerfil.status).toBe(401);
  });
});
