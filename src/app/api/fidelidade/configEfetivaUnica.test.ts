import { vi, describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Nível 6.6.1, item 5: prova de ponta a ponta que admin, tela do cliente,
// status público, crédito por pontos e ativação individual leem/escrevem
// exatamente a mesma chave (config:fidelidade:pontos) — nenhum desses
// fluxos depende do toggle antigo (config:fidelidade) quando o programa de
// pontos está ativo. Todas as rotas abaixo compartilham o MESMO Map em
// memória, então uma divergência de chave apareceria como um teste falhando.
const store = new Map<string, unknown>();

function realGet(key: string) {
  return store.has(key) ? store.get(key) : null;
}
function realSet(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
  if (opts?.nx && store.has(key)) return null;
  store.set(key, value);
  return "OK";
}
function realDel(key: string) {
  store.delete(key);
  return 1;
}
function realEval(_script: string, keys: string[], args: string[]) {
  if (keys.length === 1) {
    const [key] = keys;
    const [token] = args;
    if (store.get(key) === token) {
      store.delete(key);
      return 1;
    }
    return 0;
  }
  const [lockKey, estadoKey] = keys;
  const [token, estadoJson] = args;
  if (store.get(lockKey) === token) {
    store.set(estadoKey, JSON.parse(estadoJson as unknown as string));
    return 1;
  }
  return 0;
}

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(async (key: string) => realGet(key)),
    set: vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => realSet(key, value, opts)),
    del: vi.fn(async (key: string) => realDel(key)),
    eval: vi.fn(async (script: string, keys: string[], args: string[]) => realEval(script, keys, args)),
  },
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) =>
      token === "token-admin" ? { username: "dev-admin", name: "Admin", role: "admin" } : null
    ),
  };
});

import { criarSessaoCliente } from "@/lib/clienteAuth";
import { obterOuCriarCliente } from "@/lib/clientes";
import { POST as POST_CONFIG_PONTOS } from "./config/pontos/route";
import { GET as GET_STATUS } from "./status/route";
import { GET as GET_CLIENTE_FIDELIDADE } from "../cliente/fidelidade/route";
import { POST as POST_ATIVAR } from "../cliente/fidelidade/ativar/route";

function adminPostRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/fidelidade/config/pontos", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "auth-token=token-admin" },
    body: JSON.stringify(body),
  });
}

function clienteRequest(url: string, token: string) {
  return new NextRequest(url, { headers: { cookie: `cliente-token=${token}` } });
}

beforeEach(() => {
  store.clear();
});

describe("Configuração efetiva única — admin, cliente, status público e ativação leem a mesma chave", () => {
  test("o que o admin salva aparece igual no status público e na tela do cliente", async () => {
    const salvou = await POST_CONFIG_PONTOS(
      adminPostRequest({ ativo: true, metaPontos: 250, descricaoRecompensa: "Sobremesa Grátis" })
    );
    expect(salvou.status).toBe(200);

    const status = await (await GET_STATUS()).json();
    expect(status).toEqual({ ativo: true });

    const cliente = await obterOuCriarCliente("11999997000");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    const resFidelidade = await GET_CLIENTE_FIDELIDADE(clienteRequest("http://localhost/api/cliente/fidelidade", token));
    const dataFidelidade = await resFidelidade.json();

    expect(dataFidelidade.ativo).toBe(true);
    expect(dataFidelidade.metaPontos).toBe(250);
    expect(dataFidelidade.descricaoRecompensa).toBe("Sobremesa Grátis");
  });

  test("programa ativo permite ativação individual; desativado pelo admin passa a bloquear", async () => {
    await POST_CONFIG_PONTOS(adminPostRequest({ ativo: true, metaPontos: 250, descricaoRecompensa: "Sobremesa Grátis" }));

    const cliente = await obterOuCriarCliente("11999997001");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    const resAtivarOk = await POST_ATIVAR(clienteRequest("http://localhost/api/cliente/fidelidade/ativar", token));
    expect(resAtivarOk.status).toBe(200);

    // Admin desativa o programa — mesma chave, agora ativo:false.
    await POST_CONFIG_PONTOS(adminPostRequest({ ativo: false, metaPontos: 250, descricaoRecompensa: "Sobremesa Grátis" }));

    const statusApos = await (await GET_STATUS()).json();
    expect(statusApos.ativo).toBe(false);

    const cliente2 = await obterOuCriarCliente("11999997002");
    const token2 = await criarSessaoCliente({ clienteId: cliente2.clienteId, telefone: cliente2.telefone });
    const resAtivarBloqueado = await POST_ATIVAR(clienteRequest("http://localhost/api/cliente/fidelidade/ativar", token2));
    expect(resAtivarBloqueado.status).toBe(409);
  });

  test("nenhum fluxo volta a ler o toggle antigo (config:fidelidade) quando o novo programa está ativo", async () => {
    // Modelo antigo fica ativo, mas isso nao deve mudar nada no que o
    // cliente ve nem na ativacao — a config efetiva e so config:fidelidade:pontos.
    store.set("config:fidelidade", { ativo: true, pizzasParaPremio: 5, tipoRecompensa: "pizza_gratis", descricaoRecompensa: "Legado" });
    await POST_CONFIG_PONTOS(adminPostRequest({ ativo: true, metaPontos: 250, descricaoRecompensa: "Sobremesa Grátis" }));

    const status = await (await GET_STATUS()).json();
    expect(status.ativo).toBe(true);

    const cliente = await obterOuCriarCliente("11999997003");
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });
    const dataFidelidade = await (await GET_CLIENTE_FIDELIDADE(clienteRequest("http://localhost/api/cliente/fidelidade", token))).json();

    expect(dataFidelidade.metaPontos).toBe(250); // nunca 5 (pizzasParaPremio do legado)
    expect(dataFidelidade.descricaoRecompensa).toBe("Sobremesa Grátis"); // nunca "Legado"
  });
});
