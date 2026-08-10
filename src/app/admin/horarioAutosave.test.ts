import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const fonte = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("admin — horario com salvamento automatico", () => {
  test("os dois campos persistem no momento da alteracao, sem depender do botao geral de salvar", () => {
    expect(fonte).toContain("onChange={e => atualizarHorario('horaAbertura', Number(e.target.value))}");
    expect(fonte).toContain("onChange={e => atualizarHorario('horaFechamento', Number(e.target.value))}");
    expect(fonte).toMatch(/const atualizarHorario = \([\s\S]*persistirHorario\(novaConfig\)/);
  });

  test("usa PATCH dedicado e fila sequencial para a ultima alteracao sempre prevalecer", () => {
    expect(fonte).toContain("method: 'PATCH'");
    expect(fonte).toContain("horarioSaveQueueRef.current = horarioSaveQueueRef.current");
  });
});
