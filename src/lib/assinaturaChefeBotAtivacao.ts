// Kill switch operacional da assinatura do ChefeBot.
//
// Em Preview/teste a UX continua disponível para validação sem cobrança real.
// Em Production a cobrança só fica ativa com opt-in explícito. Ausente ou
// "false" mantém modal, bloqueio de novos pedidos e novos checkouts desligados,
// sem apagar estado/faturas e sem impedir a confirmação de pagamento já iniciado.
export function assinaturaChefeBotAtiva(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV !== "production") return true;
  return env.ASSINATURA_CHEFEBOT_ENABLED?.trim().toLowerCase() === "true";
}
