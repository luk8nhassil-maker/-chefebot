import { vi, describe, test, expect } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/jornadaChef", () => ({
  aplicarResgateManual: vi.fn(async (codigo: string) => {
    if (codigo === "JC-INVALIDO") throw new Error("Codigo de resgate invalido ou revogado");
    return { recompensaId: "rec_1", status: "resgatada" };
  }),
  revogarCodigoResgate: vi.fn(async () => ({ codigoPublico: "JC-NOVOCODIGO" })),
  substituirRecompensa: vi.fn(async (recompensaId: string, especificacao: { tipo: string }) => {
    if (especificacao.tipo === "pizza") throw new Error("Sabor de pizza inválido ou não selecionado.");
    return { recompensaId, produtoNome: "Guarana 2L", status: "fechada", valorReferencia: 13 };
  }),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    verifyToken: vi.fn(async (token: string) => {
      const role = { "token-admin": "admin", "token-dev": "dev", "token-atendente": "atendente" }[token];
      return role ? { username: `dev-${role}`, name: `Dev QA (${role})`, role } : null;
    }),
  };
});

import { POST } from "./route";
import { substituirRecompensa } from "@/lib/jornadaChef";

function req(token: string | undefined, body: unknown) {
  const url = "http://localhost/api/admin/jornada-chef/resgate-manual";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth-token=${token}`;
  return new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/admin/jornada-chef/resgate-manual — aplicar/revogar", () => {
  test("sem cookie retorna 401", async () => {
    const res = await POST(req(undefined, { acao: "aplicar", codigoPublico: "JC-X" }));
    expect(res.status).toBe(401);
  });

  test("aplica resgate manual com codigo valido", async () => {
    const res = await POST(req("token-atendente", { acao: "aplicar", codigoPublico: "JC-VALIDO" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("codigo invalido retorna 400", async () => {
    const res = await POST(req("token-atendente", { acao: "aplicar", codigoPublico: "JC-INVALIDO" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/jornada-chef/resgate-manual — substituir (contrato estruturado)", () => {
  test("atendente NAO consegue substituir (403)", async () => {
    const res = await POST(
      req("token-atendente", {
        acao: "substituir",
        recompensaId: "rec_1",
        motivo: "produto esgotado",
        novaEspecificacao: { tipo: "bebida_sobremesa", item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" } },
      })
    );
    expect(res.status).toBe(403);
  });

  test("admin consegue substituir com especificacao estruturada — nunca aceita novoProdutoId/novoProdutoNome livres", async () => {
    const res = await POST(
      req("token-admin", {
        acao: "substituir",
        recompensaId: "rec_1",
        motivo: "produto esgotado",
        novaEspecificacao: { tipo: "bebida_sobremesa", item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" } },
        // Campos do contrato antigo, mesmo se enviados, nunca chegam a ser usados —
        // a rota só repassa `novaEspecificacao` para o domínio.
        novoProdutoId: "produto-forjado",
        novoProdutoNome: "Nome Forjado",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.produtoNome).toBe("Guarana 2L");
    expect(vi.mocked(substituirRecompensa)).toHaveBeenCalledWith(
      "rec_1",
      { tipo: "bebida_sobremesa", item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" } },
      "produto esgotado",
      "dev-admin"
    );
  });

  test("sem novaEspecificacao retorna 400", async () => {
    const res = await POST(req("token-admin", { acao: "substituir", recompensaId: "rec_1", motivo: "x" }));
    expect(res.status).toBe(400);
  });

  test("sem motivo retorna 400", async () => {
    const res = await POST(
      req("token-admin", {
        acao: "substituir",
        recompensaId: "rec_1",
        novaEspecificacao: { tipo: "bebida_sobremesa", item: { produtoId: "bebida:Guarana 2L", produtoNome: "Guarana 2L", categoria: "bebida" } },
      })
    );
    expect(res.status).toBe(400);
  });

  test("tipo invalido em novaEspecificacao retorna 400 sem chamar o dominio", async () => {
    const res = await POST(
      req("token-admin", { acao: "substituir", recompensaId: "rec_1", motivo: "x", novaEspecificacao: { tipo: "tipo_desconhecido" } })
    );
    expect(res.status).toBe(400);
  });

  test("erro de validacao do dominio (ex.: sabor invalido) e repassado como 400", async () => {
    const res = await POST(
      req("token-admin", {
        acao: "substituir",
        recompensaId: "rec_1",
        motivo: "x",
        novaEspecificacao: { tipo: "pizza", pizza: { tamanho: "P", sabores: [] } },
      })
    );
    expect(res.status).toBe(400);
  });
});
