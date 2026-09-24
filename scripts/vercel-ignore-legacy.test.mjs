import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./vercel-ignore-legacy.mjs", import.meta.url));
const vercelJson = fileURLToPath(new URL("../vercel.json", import.meta.url));

const LEGADOS = [
  "prj_7yKXTeyjQaFTCxcZy6wyBySa3iTX",
  "prj_rch8NOlR5BP5AXwCzJVXO3wGz1up",
  "prj_Og9wgihmW0BDUrjBimKipP6JDeB6",
];
const OFICIAL = "prj_ZVgxjFmInLjYNWOixF5szotok6SJ";

function executar(projectId) {
  const env = { ...process.env };
  if (projectId === undefined) delete env.VERCEL_PROJECT_ID;
  else env.VERCEL_PROJECT_ID = projectId;
  return spawnSync(process.execPath, [script], { env, encoding: "utf8" });
}

for (const projectId of LEGADOS) {
  test(`ignora build do projeto legado ${projectId}`, () => {
    const resultado = executar(projectId);
    assert.equal(resultado.status, 0, resultado.stderr);
    assert.match(resultado.stdout, /build ignorado/);
  });
}

test("permite build do projeto oficial", () => {
  const resultado = executar(OFICIAL);
  assert.equal(resultado.status, 1);
  assert.match(resultado.stdout, /build permitido/);
});

test("permite build quando VERCEL_PROJECT_ID está ausente", () => {
  assert.equal(executar(undefined).status, 1);
});

test("permite build para projeto desconhecido", () => {
  assert.equal(executar("prj_desconhecido").status, 1);
});

test("vercel.json preserva os dois crons e aponta para o guard de build", () => {
  const config = JSON.parse(readFileSync(vercelJson, "utf8"));
  assert.equal(config.ignoreCommand, "node scripts/vercel-ignore-legacy.mjs");
  assert.deepEqual(config.crons, [
    { path: "/api/cron", schedule: "0 3 * * *" },
    { path: "/api/cron/pix-pendente", schedule: "0 5 * * *" },
  ]);
});
