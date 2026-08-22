import { describe, expect, it } from "vitest";
import { lerWorkflow, validarWorkflow, extrairCrons } from "./check-mcp-observer-cron-workflow.mjs";

describe("workflow mcp-observer-cron.yml — modo econômico", () => {
  const conteudo = lerWorkflow();

  it("não tem nenhum problema de validação", () => {
    expect(validarWorkflow(conteudo)).toEqual([]);
  });

  it("não possui cron automático enquanto o MCP está inativo", () => {
    expect(extrairCrons(conteudo)).toEqual([]);
    expect(conteudo).not.toMatch(/^\s*schedule:\s*$/m);
  });

  it("mantém execução manual disponível para diagnóstico/reativação", () => {
    expect(conteudo).toContain("workflow_dispatch:");
  });

  it("detecta workflow_dispatch ausente", () => {
    expect(validarWorkflow(conteudo.replace("workflow_dispatch:", "outra_coisa:"))).toContain(
      "workflow_dispatch ausente (sem gatilho manual)",
    );
  });

  it("detecta reintrodução de schedule automático", () => {
    const comSchedule = conteudo.replace(
      "  workflow_dispatch:",
      '  workflow_dispatch:\n  schedule:\n    - cron: "*/10 21-23 * * 5"',
    );
    expect(validarWorkflow(comSchedule)).toContain("agendamento automático presente com MCP inativo");
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
});
