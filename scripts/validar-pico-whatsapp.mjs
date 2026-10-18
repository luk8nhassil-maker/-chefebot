#!/usr/bin/env node
/**
 * Verificação local sem tocar na produção e sem acionar GitHub Actions ou Vercel.
 * Pré-requisito: npm ci concluído. Falha fechada se dependências ausentes.
 * Executar: node scripts/validar-pico-whatsapp.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const vitest = resolve(repo, "node_modules/vitest/vitest.mjs");
const tsc = resolve(repo, "node_modules/typescript/bin/tsc");
const next = resolve(repo, "node_modules/next/dist/bin/next");
if (![vitest, tsc, next].every((p) => existsSync(p))) {
  console.error("Dependências ausentes. Rode npm ci no repositório antes de validar.");
  process.exit(2);
}
if (process.env.VERCEL_ENV === "production" ||
    process.env.KV_REST_API_URL?.includes("upstash.io") ||
    process.env.EVOLUTION_API_URL) {
  console.error("Falha de segurança: remova as credenciais/variáveis de produção do ambiente.");
  process.exit(2);
}
const checks = [
  ["Vitest focado - pico + regressões", process.execPath, [
    vitest, "run",
    "src/lib/whatsappInboundMutex.test.ts",
    "src/lib/whatsappInbox.test.ts",
    "src/lib/whatsappOutbox.test.ts",
  ]],
  ["TypeScript", process.execPath, [tsc, "--noEmit", "--pretty", "false"]],
  ["Next.js build local", process.execPath, [next, "build"]],
];
const started = new Date().toISOString();
const results = [];
for (const [name, command, args] of checks) {
  console.log("\n" + "=".repeat(18) + " " + name + " " + "=".repeat(18));
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd: repo, stdio: "inherit", env: {
      ...process.env, CI: "1",
      WHATSAPP_INBOX_ROLLOUT: "off",
      WHATSAPP_OUTBOX_ROLLOUT: "off",
      VERCEL_ENV: "preview", // evita chamadas reais à Evolution
    },
    timeout: 180000,
  });
  results.push({
    check: name, status: result.error?.message ?? result.status,
    durationMs: Date.now() - start, passed: result.status === 0 && !result.error,
  });
  if (!results.at(-1).passed) break;
}
const dir = resolve(repo, "validation-results");
mkdirSync(dir, { recursive: true });
const path = resolve(dir, "whatsapp-peak-50.json");
writeFileSync(path, JSON.stringify({
  started, completed: new Date().toISOString(),
  note: "Execução local isolada; NÃO é teste de 50 POSTs HTTP nem de serviço WhatsApp real.",
  results,
}, null, 2));
console.log("\nRelatório:", path);
console.log(results.map(x => `${x.passed ? "PASS" : "FAIL"} ${x.check} (${x.durationMs}ms)`).join("\n"));
process.exit(results.every(x => x.passed) ? 0 : 1);
