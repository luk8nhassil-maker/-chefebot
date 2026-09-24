import { describe, expect, test } from "vitest";
import {
  VERCEL_PROJECT_CHEFEBOT_OFICIAL,
  VERCEL_PROJECTS_CHEFEBOT_LEGADOS,
  ehProjetoVercelLegado,
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
