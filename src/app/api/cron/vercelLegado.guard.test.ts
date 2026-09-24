import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mutarPedidosMock, redisMock, obterConfigEvolutionMock } = vi.hoisted(() => ({
  mutarPedidosMock: vi.fn(),
  redisMock: {
    keys: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
  obterConfigEvolutionMock: vi.fn(),
}));

vi.mock("@/lib/pedidosConcorrencia", () => ({ mutarPedidos: mutarPedidosMock }));
vi.mock("@/lib/redis", () => ({ redis: redisMock }));
vi.mock("@/lib/evolutionApi", () => ({ obterConfigEvolution: obterConfigEvolutionMock }));

import { GET as GETLimpeza } from "./route";
import { GET as GETPixPendente } from "./pix-pendente/route";
import { VERCEL_PROJECTS_CHEFEBOT_LEGADOS } from "@/lib/vercelProjeto";

const cronSecretAnterior = process.env.CRON_SECRET;
const projectIdAnterior = process.env.VERCEL_PROJECT_ID;

function requestAutorizada() {
  return new Request("https://exemplo.test/api/cron", {
    headers: { authorization: "Bearer segredo-teste" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "segredo-teste";
  process.env.VERCEL_PROJECT_ID = VERCEL_PROJECTS_CHEFEBOT_LEGADOS[0];
});

afterEach(() => {
  if (cronSecretAnterior === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cronSecretAnterior;

  if (projectIdAnterior === undefined) delete process.env.VERCEL_PROJECT_ID;
  else process.env.VERCEL_PROJECT_ID = projectIdAnterior;
});

describe("crons Vercel — projetos legados", () => {
  test("limpeza retorna sucesso sem ler nem escrever pedidos", async () => {
    const response = await GETLimpeza(requestAutorizada());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      skipped: true,
      motivo: "projeto_vercel_legado",
    });
    expect(mutarPedidosMock).not.toHaveBeenCalled();
  });

  test("pix-pendente não lê Redis nem envia WhatsApp em projeto legado", async () => {
    const response = await GETPixPendente(requestAutorizada());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      skipped: true,
      motivo: "projeto_vercel_legado",
    });
    expect(redisMock.keys).not.toHaveBeenCalled();
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(redisMock.set).not.toHaveBeenCalled();
    expect(mutarPedidosMock).not.toHaveBeenCalled();
    expect(obterConfigEvolutionMock).not.toHaveBeenCalled();
  });

  test("autenticação continua sendo exigida antes do guard de projeto", async () => {
    const response = await GETLimpeza(new Request("https://exemplo.test/api/cron"));
    expect(response.status).toBe(401);
    expect(mutarPedidosMock).not.toHaveBeenCalled();
  });
});
