import { describe, test, expect, vi, beforeEach } from "vitest";

const { verifyTokenMock } = vi.hoisted(() => ({ verifyTokenMock: vi.fn() }));
vi.mock("./auth", () => ({ verifyToken: verifyTokenMock }));

import {
  lerSessaoAdministrativa,
  ehPapelAdministrativo,
  origemDoPedido,
  ehOrigemAdministrativa,
  ORIGEM_PAINEL,
  ORIGEM_SITE,
  COOKIE_AUTH,
} from "./sessaoAdministrativa";

/** Requisição fake com o mínimo que o módulo lê. */
function req(cookie?: string) {
  return {
    cookies: { get: (nome: string) => (nome === COOKIE_AUTH && cookie ? { value: cookie } : undefined) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ehPapelAdministrativo", () => {
  test("aceita só os papéis que operam o painel", () => {
    expect(ehPapelAdministrativo("admin")).toBe(true);
    expect(ehPapelAdministrativo("atendente")).toBe(true);
    expect(ehPapelAdministrativo("dev")).toBe(true);
  });

  test("recusa papéis que não criam pedido e valores inesperados", () => {
    for (const v of ["entregador", "contador", "financeiro", "cliente", "", null, undefined, 1, {}]) {
      expect(ehPapelAdministrativo(v)).toBe(false);
    }
  });
});

describe("lerSessaoAdministrativa", () => {
  test("reconhece uma sessão de painel válida", async () => {
    verifyTokenMock.mockResolvedValue({ username: "kellyne", name: "Kellyne", role: "atendente" });
    await expect(lerSessaoAdministrativa(req("token-valido"))).resolves.toEqual({
      username: "kellyne",
      nome: "Kellyne",
      role: "atendente",
    });
  });

  test("sem cookie, é público — e o token nem chega a ser verificado", async () => {
    await expect(lerSessaoAdministrativa(req())).resolves.toBeNull();
    expect(verifyTokenMock).not.toHaveBeenCalled();
  });

  test("token inválido ou expirado é público", async () => {
    verifyTokenMock.mockResolvedValue(null);
    await expect(lerSessaoAdministrativa(req("token-podre"))).resolves.toBeNull();
  });

  test("papel não administrativo é público, mesmo com token válido", async () => {
    verifyTokenMock.mockResolvedValue({ username: "ze", name: "Zé", role: "entregador" });
    await expect(lerSessaoAdministrativa(req("token-de-entregador"))).resolves.toBeNull();
  });

  test("nunca lança: verificação que falha vira público (direção segura do erro)", async () => {
    verifyTokenMock.mockRejectedValue(new Error("jose explodiu"));
    await expect(lerSessaoAdministrativa(req("token"))).resolves.toBeNull();
  });

  test("requisição sem suporte a cookies não quebra", async () => {
    await expect(lerSessaoAdministrativa(null)).resolves.toBeNull();
    await expect(lerSessaoAdministrativa(undefined)).resolves.toBeNull();
    await expect(lerSessaoAdministrativa({})).resolves.toBeNull();
    await expect(lerSessaoAdministrativa({ cookies: {} })).resolves.toBeNull();
  });

  test("campos ausentes no payload não viram undefined solto", async () => {
    verifyTokenMock.mockResolvedValue({ role: "admin" });
    await expect(lerSessaoAdministrativa(req("t"))).resolves.toEqual({ username: "", nome: "", role: "admin" });
  });

  test("NENHUM campo do corpo influencia a decisão — só o cookie", async () => {
    verifyTokenMock.mockResolvedValue(null);
    // Um "corpo" cheio de tentativas de se declarar admin não muda nada:
    // este módulo sequer recebe o corpo da requisição.
    const requisicaoForjada = {
      ...req(),
      body: { origemAdmin: true, origem: "painel", role: "admin", isAdmin: 1 },
      headers: { "x-admin": "1" },
    };
    await expect(lerSessaoAdministrativa(requisicaoForjada)).resolves.toBeNull();
  });
});

describe("origem do pedido", () => {
  test("com sessão vira painel; sem sessão continua site", () => {
    expect(origemDoPedido({ username: "a", nome: "A", role: "admin" })).toBe(ORIGEM_PAINEL);
    expect(origemDoPedido(null)).toBe(ORIGEM_SITE);
  });

  test("ehOrigemAdministrativa reconhece só a origem de painel", () => {
    expect(ehOrigemAdministrativa(ORIGEM_PAINEL)).toBe(true);
    for (const v of [ORIGEM_SITE, "app", "whatsapp", "", null, undefined]) {
      expect(ehOrigemAdministrativa(v)).toBe(false);
    }
  });
});
