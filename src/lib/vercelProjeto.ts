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

export const VERCEL_HOSTS_CHEFEBOT_LEGADOS = [
  "chefebot.vercel.app",
  "chefebot-pjif.vercel.app",
  "chefebot-3ke5.vercel.app",
] as const;

const HOSTS_LEGADOS = new Set<string>(VERCEL_HOSTS_CHEFEBOT_LEGADOS);
const SUFIXO_TIME_LEGADO = "-luk8nhassil-makers-projects.vercel.app";

export function normalizarHostnameVercel(hostname: string | null | undefined): string {
  if (typeof hostname !== "string") return "";
  const primeiro = hostname.split(",")[0]?.trim().toLowerCase() ?? "";
  return primeiro.replace(/:\d+$/, "").replace(/\.$/, "");
}

export function ehHostVercelLegado(hostname: string | null | undefined): boolean {
  const normalizado = normalizarHostnameVercel(hostname);
  if (!normalizado) return false;
  if (HOSTS_LEGADOS.has(normalizado)) return true;

  // Previews/deployments gerados dentro do antigo time da Vercel terminam
  // neste sufixo. Como esta função vive no repositório do ChefeBot, qualquer
  // execução deste código nesse time é um deployment legado deste produto.
  return normalizado.endsWith(SUFIXO_TIME_LEGADO);
}

export function ehRequisicaoVercelLegada(
  req: Pick<Request, "headers" | "url">,
  projectId: string | undefined = process.env.VERCEL_PROJECT_ID,
): boolean {
  if (ehProjetoVercelLegado(projectId)) return true;

  const encaminhado = req.headers.get("x-forwarded-host");
  const host = req.headers.get("host");
  const pelaUrl = (() => {
    try {
      return new URL(req.url).hostname;
    } catch {
      return "";
    }
  })();

  return ehHostVercelLegado(encaminhado || host || pelaUrl);
}

