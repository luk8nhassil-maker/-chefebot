import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ sessao: vi.fn(), perfil: vi.fn(), carteira: vi.fn(), painel: vi.fn() }));
vi.mock("@/lib/clienteAuth", () => ({ lerSessaoCliente: m.sessao }));
vi.mock("@/lib/clientes", () => ({ buscarClientePorId: m.perfil }));
vi.mock("@/lib/fidelidade", () => ({ derivarClienteIdPorTelefone: () => "titular-sintetico" }));
vi.mock("@/lib/ranking3/server", () => ({ ranking3Ativo: () => true, ranking3: () => ({ carteira: m.carteira }), painelRanking3: m.painel }));
vi.mock("@/lib/menu.server", () => ({ getMENUDinamico: async () => ({}) }));
vi.mock("@/lib/estoque", () => ({ obterEsgotadosLegado: async () => [], obterEstoqueItens: async () => ({}) }));
import { NextRequest } from "next/server";
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks(); m.sessao.mockResolvedValue({ clienteId: "perfil-sintetico" }); m.perfil.mockResolvedValue({ telefone: "sintetico" }); m.painel.mockResolvedValue(null);
  m.carteira.mockResolvedValue([{ id: "r3-2026-10-20-0-liga-1", temporadaId: "r3-2026-10-20-0", clienteId: "titular-sintetico", tentativaId: "referencia-interna", liga: 1, tetoCents: 4700, estado: "disponivel", revisao: 0, proximoAvisoEm: 0 }]);
});
describe("Ranking3 — carteira privada, sem materializar resultado em leitura", () => {
  it("sem sessão não consulta carteira", async () => {
    m.sessao.mockResolvedValue(null); expect((await GET(new NextRequest("http://localhost"))).status).toBe(401); expect(m.carteira).not.toHaveBeenCalled();
  });
  it("ignora titular informado no navegador e não expõe referência interna", async () => {
    const res = await GET(new NextRequest("http://localhost/api/cliente/ranking3?clienteId=outro"));
    const data = await res.json();
    expect(m.carteira).toHaveBeenCalledWith("titular-sintetico");
    expect(m.painel).not.toHaveBeenCalled(); // Carteira não apura todos os clientes.
    expect(data.premios[0].clienteId).toBeUndefined(); expect(data.premios[0].tentativaId).toBeUndefined();
    expect(data.premios[0].sabores).toEqual([{ id: "flavor-presunto", nome: "Presunto" }]);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
  it("erro no Redis não é interpretado como ausência de prêmios", async () => {
    m.carteira.mockRejectedValueOnce(new Error("Redis indisponível"));
    expect((await GET(new NextRequest("http://localhost"))).status).toBe(503);
  });
});
