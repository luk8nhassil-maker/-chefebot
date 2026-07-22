#!/usr/bin/env node
// Teste estático (spec seção 13): falha se o workflow do monitor ou os
// scripts de coleta contiverem qualquer comando destrutivo da Railway CLI.
// Roda tanto como script standalone no workflow (exit code) quanto
// importado pelo vitest (ver check-no-destructive-railway-commands.test.mjs).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DESTRUCTIVE_RAILWAY_COMMANDS = [
  "railway up",
  "railway deploy",
  "railway redeploy",
  "railway restart",
  "railway down",
  "railway delete",
  "railway volume delete",
  "railway volume detach",
  "railway variable",
  "railway environment edit",
];

/** Procura por qualquer comando destrutivo dentro de um texto (case-insensitive). */
export function findDestructiveCommands(content) {
  const lower = content.toLowerCase();
  return DESTRUCTIVE_RAILWAY_COMMANDS.filter((cmd) => lower.includes(cmd));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Arquivos vigiados: o workflow do monitor e o coletor. O próprio checker e
// seu teste ficam de fora (contêm a lista permitida como dado, não uso).
const FILES_TO_SCAN = [
  path.join(REPO_ROOT, ".github", "workflows", "railway-infra-monitor.yml"),
  path.join(REPO_ROOT, "scripts", "infra", "collect-railway-metrics.mjs"),
];

export function scanRepoFiles(files = FILES_TO_SCAN) {
  const results = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const matches = findDestructiveCommands(content);
    if (matches.length > 0) results.push({ file, matches });
  }
  return results;
}

function main() {
  const findings = scanRepoFiles();
  if (findings.length > 0) {
    for (const f of findings) {
      console.error(`[check-no-destructive-railway-commands] ${f.file}: ${f.matches.join(", ")}`);
    }
    console.error("Comando(s) destrutivo(s) da Railway CLI encontrado(s). Falhando.");
    process.exit(1);
  }
  console.log("[check-no-destructive-railway-commands] OK — nenhum comando destrutivo encontrado.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
