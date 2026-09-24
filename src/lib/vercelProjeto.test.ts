import { describe, expect, test } from "vitest";
import {
  VERCEL_HOSTS_CHEFEBOT_LEGADOS,
  VERCEL_PROJECT_CHEFEBOT_OFICIAL,
  VERCEL_PROJECTS_CHEFEBOT_LEGADOS,
  ehHostVercelLegado,
  ehProjetoVercelLegado,
  ehRequisicaoVercelLegada,
  normalizarHostnameVercel,
} from "./vercelProjeto";

describe("ehProjetoVercelLegado", () => {
  test.each(VERCEL_PROJECTS_CHEFEBOT_LEGADOS)("bloqueia o projeto legado %s", (projectId) => {
    expect(ehProjetoVercelLegado(projectId)).toBe(true);
  });

  test("não bloqueia o projeto oficial atual", () => {
    expect(ehProjetoVercelLegado(VERCEL_PROJECT_CHEFEBOT_OFICIAL)).toBe(false);
  });

  test.each([undefined, "", "   ", "prj_desconhecido"])("falha aberto para metadado ausente/desconhecido: %s", (projectId) => {
    expect(ehProjetoVercelLegado(projectId)).toBe(false);
  });
});

describe("ehHostVercelLegado", () => {
  test.each(VERCEL_HOSTS_CHEFEBOT_LEGADOS)("reconhece alias legado %s", (hostname) => {
    expect(ehHostVercelLegado(hostname)).toBe(true);
  });

  test.each([
    "chefebot-git-main-luk8nhassil-makers-projects.vercel.app",
    "chefebot-pjif-git-fix-x-luk8nhassil-makers-projects.vercel.app",
    "chefebot-3ke5-abc-luk8nhassil-makers-projects.vercel.app",
  ])("reconhece deployment do time antigo %s", (hostname) => {
    expect(ehHostVercelLegado(hostname)).toBe(true);
  });

  test.each([
    "chefedapizza.com.br",
    "chefebot-contingencia.vercel.app",
    "chefebot-contingencia-git-main-chefe-da-pizza.vercel.app",
    "outro.vercel.app",
    "",
    undefined,
  ])("não classifica host oficial/desconhecido como legado: %s", (hostname) => {
    expect(ehHostVercelLegado(hostname)).toBe(false);
  });

  test("normaliza x-forwarded-host com porta, maiúsculas e cadeia de proxies", () => {
    expect(normalizarHostnameVercel("CHEFEBOT-PJIF.VERCEL.APP:443, proxy.local")).toBe("chefebot-pjif.vercel.app");
  });
});

describe("ehRequisicaoVercelLegada", () => {
  test("usa hostname como fallback quando VERCEL_PROJECT_ID está ausente", () => {
    const req = new Request("https://chefebot-pjif.vercel.app/api/cron");
    expect(ehRequisicaoVercelLegada(req, undefined)).toBe(true);
  });

  test("prioriza x-forwarded-host do time antigo", () => {
    const req = new Request("https://interno.vercel.app/api/cron", {
      headers: { "x-forwarded-host": "chefebot-git-main-luk8nhassil-makers-projects.vercel.app" },
    });
    expect(ehRequisicaoVercelLegada(req, undefined)).toBe(true);
  });

  test("produção oficial continua liberada", () => {
    const req = new Request("https://chefedapizza.com.br/api/cron");
    expect(ehRequisicaoVercelLegada(req, VERCEL_PROJECT_CHEFEBOT_OFICIAL)).toBe(false);
  });
});
