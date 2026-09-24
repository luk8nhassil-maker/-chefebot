const PROJETOS_LEGADOS = new Set([
  "prj_7yKXTeyjQaFTCxcZy6wyBySa3iTX", // chefebot
  "prj_rch8NOlR5BP5AXwCzJVXO3wGz1up", // chefebot-pjif
  "prj_Og9wgihmW0BDUrjBimKipP6JDeB6", // chefebot-3ke5
]);

const projectId = (process.env.VERCEL_PROJECT_ID || "").trim();

if (PROJETOS_LEGADOS.has(projectId)) {
  console.log(`[vercel] build ignorado para projeto legado: ${projectId}`);
  process.exit(0);
}

// Fail-open: projeto oficial, projeto novo ou ambiente sem VERCEL_PROJECT_ID
// continua o build. Assim uma falha de metadado nunca derruba produção.
console.log(`[vercel] build permitido para projeto: ${projectId || "nao-identificado"}`);
process.exit(1);
