// Kill switch operacional da assinatura do ChefeBot.
//
// Em Preview/teste a UX continua disponível para validação sem cobrança real.
// Em Production a assinatura está temporariamente pausada por decisão operacional.
// Enquanto esta chave estiver true, modal, bloqueio de novos pedidos e novos
// checkouts ficam desligados, sem apagar estado/faturas e sem impedir a confirmação
// de pagamento já iniciado. Reativar somente por nova decisão explícita do usuário.
const ASSINATURA_CHEFEBOT_PAUSADA_TEMPORARIAMENTE = true;

export function assinaturaChefeBotAtiva(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV !== "production") return true;
  if (ASSINATURA_CHEFEBOT_PAUSADA_TEMPORARIAMENTE) return false;
  return env.ASSINATURA_CHEFEBOT_ENABLED?.trim().toLowerCase() !== "false";
}
