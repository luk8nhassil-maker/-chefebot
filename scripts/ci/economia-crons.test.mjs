import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const vercelPath = fileURLToPath(new URL("../../vercel.json", import.meta.url));
const config = JSON.parse(readFileSync(vercelPath, "utf8"));
const paths = (config.crons ?? []).map((cron) => cron.path);

describe("Vercel crons — modo economia seguro", () => {
  it("mantém a retenção diária de pedidos terminais", () => {
    expect(paths).toContain("/api/cron");
  });

  it("mantém Pix pendente até existir substituto 6/13 validado", () => {
    expect(paths).toContain("/api/cron/pix-pendente");
  });

  it("não agenda mais o cron legado destrutivo de sessões", () => {
    expect(paths).not.toContain("/api/cron/sessoes");
  });

  it("não agenda MCP Observer enquanto o modo está inativo", () => {
    expect(paths).not.toContain("/api/cron/mcp-observer");
  });

  it("não introduz outros despertares automáticos", () => {
    expect(paths.sort()).toEqual(["/api/cron", "/api/cron/pix-pendente"].sort());
  });
});
