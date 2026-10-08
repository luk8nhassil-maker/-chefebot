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

  it("mantém somente os quatro crons explicitamente aprovados", () => {
    expect(paths.sort()).toEqual([
      "/api/cron",
      "/api/cron/pix-pendente",
      "/api/cron/ranking-autopilot",
      "/api/cron/ranking-podio",
    ].sort());
  });

  it("agenda o Pódio somente uma vez por dia às 21:00 UTC", () => {
    const cron = (config.crons ?? []).find((item) => item.path === "/api/cron/ranking-podio");
    expect(cron).toEqual({ path: "/api/cron/ranking-podio", schedule: "0 21 * * *" });
  });

  it("agenda o robô em observação uma vez por dia", () => {
    const cron = (config.crons ?? []).find((item) => item.path === "/api/cron/ranking-autopilot");
    expect(cron).toEqual({ path: "/api/cron/ranking-autopilot", schedule: "30 4 * * *" });
  });
});
