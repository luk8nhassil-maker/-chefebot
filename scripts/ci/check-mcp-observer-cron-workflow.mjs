// check-mcp-observer-cron-workflow.mjs — validações estáticas (sem parser de
// YAML) do workflow .github/workflows/mcp-observer-cron.yml: garante que a
// janela de pico sex/sáb/dom a cada 10min está presente, que existe
// workflow_dispatch para execução manual, e que o segredo nunca é logado.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKFLOW_PATH = path.join(__dirname, "..", "..", ".github", "workflows", "mcp-observer-cron.yml");

export function lerWorkflow(caminho = WORKFLOW_PATH) {
  return readFileSync(caminho, "utf8");
}

// As 6 janelas UTC que cobrem sex/sáb/dom 18:00–23:59 horário de Brasília
// (ver comentário no próprio workflow para o raciocínio da conversão).
export const CRONS_ESPERADOS = [
  "*/10 21-23 * * 5",
  "*/10 0-2 * * 6",
  "*/10 21-23 * * 6",
  "*/10 0-2 * * 0",
  "*/10 21-23 * * 0",
  "*/10 0-2 * * 1",
];

export function extrairCrons(conteudo) {
  return [...conteudo.matchAll(/- cron:\s*"([^"]+)"/g)].map((m) => m[1]);
}

export function validarWorkflow(conteudo) {
  const problemas = [];

  const crons = extrairCrons(conteudo);
  for (const esperado of CRONS_ESPERADOS) {
    if (!crons.includes(esperado)) problemas.push(`cron ausente: ${esperado}`);
  }

  if (!/workflow_dispatch:/.test(conteudo)) problemas.push("workflow_dispatch ausente (sem gatilho manual)");
  if (!/secrets\.CRON_SECRET/.test(conteudo)) problemas.push("não referencia secrets.CRON_SECRET");
  if (!/::add-mask::/.test(conteudo)) problemas.push("não mascara o segredo explicitamente com ::add-mask::");
  if (/echo\s+["']?\$\{?CRON_SECRET\}?["']?\s*$/m.test(conteudo)) problemas.push("imprime CRON_SECRET diretamente");
  if (/-v\b.*curl|curl\b.*-v\b/.test(conteudo)) problemas.push("curl em modo verbose (-v) pode vazar headers no log");
  if (!/Authorization: Bearer/.test(conteudo)) problemas.push("não envia o header Authorization: Bearer");

  return problemas;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problemas = validarWorkflow(lerWorkflow());
  if (problemas.length > 0) {
    console.error("Problemas encontrados no workflow mcp-observer-cron.yml:");
    for (const p of problemas) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log("mcp-observer-cron.yml validado com sucesso.");
}
