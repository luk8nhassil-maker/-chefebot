import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ recuperar: vi.fn(), vinculos: vi.fn(), avisos: vi.fn() }));
vi.mock("@/lib/ranking3/server", () => ({ ranking3Ativo: () => process.env.RANKING3_ENABLED === "true", ranking3: () => ({ recuperar: m.recuperar }) }));
vi.mock("@/lib/consentimentoRanking", () => ({ obterElegibilidadeRankingNoCorte: vi.fn() }));
vi.mock("@/lib/ranking3/pedido", () => ({ recuperarVinculosRanking3: m.vinculos }));
vi.mock("@/lib/ranking3/notifications", () => ({ reconciliarAvisosPendentes: m.avisos }));
import { GET } from "./route";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "@/lib/vercelProjeto";
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "credencial-sintetica"); vi.stubEnv("RANKING3_ENABLED", "true");
  vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL);
  m.recuperar.mockResolvedValue({ fechados: 1, pendentes: false }); m.vinculos.mockResolvedValue({ reconciliados: 0, semPedido: 0 }); m.avisos.mockResolvedValue({ enviados: 0 });
});
afterEach(() => vi.unstubAllEnvs());
const req = () => new Request("http://localhost/api/cron/ranking-temporadas", { headers: { authorization: "Bearer credencial-sintetica" } });
describe("Ranking3 — scheduler autenticado e restrito", () => {
  it("sem autenticação não lê nem escreve", async () => {
    expect((await GET(new Request("http://localhost"))).status).toBe(401);
    expect(m.recuperar).not.toHaveBeenCalled(); expect(m.vinculos).not.toHaveBeenCalled();
  });
  it.each(["preview", "development"])("não executa em %s", async (env) => {
    vi.stubEnv("VERCEL_ENV", env); await GET(req()); expect(m.recuperar).not.toHaveBeenCalled();
  });
  it("não executa em outro projeto nem com flag desligada", async () => {
    vi.stubEnv("VERCEL_PROJECT_ID", "outro-projeto"); await GET(req()); expect(m.recuperar).not.toHaveBeenCalled();
    vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL); vi.stubEnv("RANKING3_ENABLED", "false"); await GET(req()); expect(m.recuperar).not.toHaveBeenCalled();
  });
  it("recupera automaticamente sem mensagens ou navegação de clientes", async () => {
    expect((await GET(req())).status).toBe(200); expect(m.recuperar).toHaveBeenCalledOnce(); expect(m.vinculos).toHaveBeenCalledOnce(); expect(m.avisos).toHaveBeenCalledOnce();
  });
  it("erro é explícito, nunca fabrica fechamento bem-sucedido", async () => {
    m.recuperar.mockRejectedValue(new Error("Redis temporariamente indisponível"));
    expect((await GET(req())).status).toBe(503);
  });
});
