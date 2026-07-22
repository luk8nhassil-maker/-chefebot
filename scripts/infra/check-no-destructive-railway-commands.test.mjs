import { describe, expect, it } from "vitest";
import { findDestructiveCommands, scanRepoFiles } from "./check-no-destructive-railway-commands.mjs";

describe("findDestructiveCommands", () => {
  it("detecta cada comando destrutivo listado", () => {
    expect(findDestructiveCommands("run: railway up")).toContain("railway up");
    expect(findDestructiveCommands("railway deploy --yes")).toContain("railway deploy");
    expect(findDestructiveCommands("railway redeploy")).toContain("railway redeploy");
    expect(findDestructiveCommands("railway restart")).toContain("railway restart");
    expect(findDestructiveCommands("railway down")).toContain("railway down");
    expect(findDestructiveCommands("railway delete")).toContain("railway delete");
    expect(findDestructiveCommands("railway volume delete")).toContain("railway volume delete");
    expect(findDestructiveCommands("railway volume detach")).toContain("railway volume detach");
    expect(findDestructiveCommands("railway variable set X=1")).toContain("railway variable");
    expect(findDestructiveCommands("railway environment edit")).toContain("railway environment edit");
  });

  it("é case-insensitive", () => {
    expect(findDestructiveCommands("RAILWAY UP")).toContain("railway up");
  });

  it("não acusa comandos de leitura permitidos", () => {
    const texto = "railway status --json\nrailway volume list --json\nrailway metrics";
    expect(findDestructiveCommands(texto)).toEqual([]);
  });
});

describe("scanRepoFiles — workflow e coletor reais do repositório", () => {
  it("o workflow do monitor não contém nenhum comando destrutivo", () => {
    const findings = scanRepoFiles();
    expect(findings).toEqual([]);
  });
});
