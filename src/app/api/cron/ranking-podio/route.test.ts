import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  horario: true,
  processar: vi.fn(async () => ({
    ok: true,
    temporadaId: "temp_1",
    participantesTop3: 3,
    enviados: 2,
    suprimidos: 1,
    falhas: 0,
    motivos: { cenario_inalterado: 1 },
  })),
}));

vi.mock("@/lib/rankingPodioWhatsapp", () => ({
  ehHorarioDisparoPodioWhatsapp: vi.fn(() => h.horario),
  processarPodioWhatsapp18h: h.processar,
}));

import { GET } from "./route";
import { VERCEL_PROJECT_CHEFEBOT_OFICIAL } from "@/lib/vercelProjeto";

function req(auth?: string) {
  return new Request("https://chefedapizza.com.br/api/cron/ranking-podio", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "cron-seguro");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_PROJECT_ID", VERCEL_PROJECT_CHEFEBOT_OFICIAL);
  h.horario = true;
  h.processar.mockClear();
});

describe("agendamento do Pódio", () => {
  test("Vercel chama a rota diariamente às 21:00 UTC, equivalente a 18h no fuso operacional atual", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toContainEqual({
      path: "/api/cron/ranking-podio",
      schedule: "0 21 * * *",
    });
  });
});

describe("GET /api/cron/ranking-podio", () => {
  test("sem CRON_SECRET válido nunca executa o motor", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer errado"))).status).toBe(401);
    expect(h.processar).not.toHaveBeenCalled();
  });

  test("Preview nunca dispara WhatsApp real", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await GET(req("Bearer cron-seguro"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ skipped: true, motivo: "ambiente_nao_producao" });
    expect(h.processar).not.toHaveBeenCalled();
  });

  test("deployment de projeto diferente nunca dispara", async () => {
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_outro");
    const res = await GET(req("Bearer cron-seguro"));
    const body = await res.json();

    expect(body).toMatchObject({ skipped: true, motivo: "projeto_nao_oficial" });
    expect(h.processar).not.toHaveBeenCalled();
  });

  test("fora das 18h locais nunca dispara", async () => {
    h.horario = false;
    const res = await GET(req("Bearer cron-seguro"));
    const body = await res.json();

    expect(body).toMatchObject({ skipped: true, motivo: "fora_horario_18h" });
    expect(h.processar).not.toHaveBeenCalled();
  });

  test("produção oficial + 18h executa exatamente uma avaliação", async () => {
    const res = await GET(req("Bearer cron-seguro"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.enviados).toBe(2);
    expect(h.processar).toHaveBeenCalledTimes(1);
    expect(h.processar).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "default" }));
  });

  test("erro interno falha fechado sem expor detalhes", async () => {
    h.processar.mockRejectedValueOnce(new Error("segredo interno"));
    const res = await GET(req("Bearer cron-seguro"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "falha_processamento_podio" });
    expect(JSON.stringify(body)).not.toContain("segredo interno");
  });
});
