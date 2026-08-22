// check-mcp-observer-cron-workflow.mjs — validações estáticas (sem parser de
// YAML) do workflow .github/workflows/mcp-observer-cron.yml. Enquanto
// MCP_MODE não estiver em "observador", o workflow deve permanecer somente
// manual: nenhum schedule automático pode acordar a função Vercel sem trabalho.
// A execução manual continua disponível como rollback/diagnóstico e mantém as
// mesmas proteções do CRON_SECRET.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const WORKFLOW_PATH = path.join(__dirname, "..", "..", ".github", "workflows", "mcp-observer-cron.yml");

export function lerWorkflow(caminho = WORKFLOW_PATH) {
  return readFileSync(caminho, "utf8");
}

export function extrairCrons(conteudo) {
  return [...conteudo.matchAll(/- cron:\s*"([^"]+)"/g)].map((m) => m[1]);
}

export function validarWorkflow(conteudo) {
  const problemas = [];

  if (extrairCrons(conteudo).length > 0 || /^\s*schedule:\s*$/m.test(conteudo)) {
    problemas.push("agendamento automático presente com MCP inativo");
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
  console.log("mcp-observer-cron.yml validado em modo manual/econômico.");
}
