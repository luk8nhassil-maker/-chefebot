// Identidade dos projetos Vercel duplicados que pertencem à conta antiga.
//
// A produção oficial atual é chefebot-contingencia (time chefe-da-pizza).
// Estes três IDs antigos continuam ligados ao mesmo repositório e podem
// receber deploys da main. Enquanto existirem, qualquer automação com efeito
// real deve conseguir reconhecer esses deployments e sair sem efeito.
//
// VERCEL_PROJECT_ID é uma variável de sistema da própria Vercel. Ausência ou
// valor desconhecido é tratado como "não legado" (fail-open) para nunca
// derrubar produção por falta de metadado de ambiente.
export const VERCEL_PROJECT_CHEFEBOT_OFICIAL = "prj_ZVgxjFmInLjYNWOixF5szotok6SJ";

export const VERCEL_PROJECTS_CHEFEBOT_LEGADOS = [
  "prj_7yKXTeyjQaFTCxcZy6wyBySa3iTX", // chefebot
  "prj_rch8NOlR5BP5AXwCzJVXO3wGz1up", // chefebot-pjif
  "prj_Og9wgihmW0BDUrjBimKipP6JDeB6", // chefebot-3ke5
] as const;

const PROJETOS_LEGADOS = new Set<string>(VERCEL_PROJECTS_CHEFEBOT_LEGADOS);

export function ehProjetoVercelLegado(projectId: string | undefined = process.env.VERCEL_PROJECT_ID): boolean {
  if (typeof projectId !== "string") return false;
  const normalizado = projectId.trim();
  if (!normalizado) return false;
  return PROJETOS_LEGADOS.has(normalizado);
}
