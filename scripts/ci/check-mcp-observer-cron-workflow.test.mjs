import { describe, expect, it } from "vitest";
import { lerWorkflow, validarWorkflow, extrairCrons, CRONS_ESPERADOS } from "./check-mcp-observer-cron-workflow.mjs";

describe("workflow mcp-observer-cron.yml", () => {
  const conteudo = lerWorkflow();

  it("não tem nenhum problema de validação", () => {
    expect(validarWorkflow(conteudo)).toEqual([]);
  });

  it("contém as 6 janelas de cron esperadas (sex/sáb/dom, a cada 10min, em UTC)", () => {
    const crons = extrairCrons(conteudo);
    expect(crons).toEqual(expect.arrayContaining(CRONS_ESPERADOS));
  });

  it("todas as entradas de cron pedem execução a cada 10 minutos", () => {
    for (const cron of extrairCrons(conteudo)) {
      expect(cron.startsWith("*/10 ")).toBe(true);
    }
  });

  it("detecta workflow_dispatch ausente", () => {
    expect(validarWorkflow(conteudo.replace("workflow_dispatch:", "outra_coisa:"))).toContain(
      "workflow_dispatch ausente (sem gatilho manual)",
    );
  });

  it("detecta ausência de mascaramento do segredo", () => {
    const semMascara = conteudo
      .split("\n")
      .filter((linha) => !linha.includes("::add-mask::"))
      .join("\n");
    expect(validarWorkflow(semMascara)).toContain("não mascara o segredo explicitamente com ::add-mask::");
  });

  it("detecta impressão direta do segredo", () => {
    const comVazamento = `${conteudo}\n          echo "${"$"}{CRON_SECRET}"\n`;
    expect(validarWorkflow(comVazamento)).toContain("imprime CRON_SECRET diretamente");
  });

  it("detecta cron faltando na janela de pico", () => {
    const semUmCron = conteudo.replace('- cron: "*/10 21-23 * * 5" # sexta à noite (parte 1)\n', "");
    expect(validarWorkflow(semUmCron)).toContain("cron ausente: */10 21-23 * * 5");
  });
});
