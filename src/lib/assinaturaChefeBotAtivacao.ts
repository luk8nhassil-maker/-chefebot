// Kill switch operacional da assinatura do ChefeBot.
//
// Em Preview/teste a UX continua disponível para validação sem cobrança real.
// false = assinatura ativa em produção (banner warning, bloqueio, checkout habilitados).
const ASSINATURA_CHEFEBOT_PAUSADA_TEMPORARIAMENTE = false;

export function assinaturaChefeBotAtiva(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV !== "production") return true;
  if (ASSINATURA_CHEFEBOT_PAUSADA_TEMPORARIAMENTE) return false;
  return env.ASSINATURA_CHEFEBOT_ENABLED?.trim().toLowerCase() !== "false";
}
