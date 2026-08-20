// Kill switch operacional da assinatura do ChefeBot.
//
// Em Preview/teste a UX continua disponível para validação sem cobrança real.
// Em Production a cobrança fica ativa por padrão. Definir explicitamente
// ASSINATURA_CHEFEBOT_ENABLED=false pausa modal, bloqueio de novos pedidos e
// novos checkouts, sem apagar estado/faturas e sem impedir a confirmação de
// pagamento já iniciado.
export function assinaturaChefeBotAtiva(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VERCEL_ENV !== "production") return true;
  return env.ASSINATURA_CHEFEBOT_ENABLED?.trim().toLowerCase() !== "false";
}
