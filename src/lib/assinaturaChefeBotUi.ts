export const ROTAS_OPERACIONAIS_ASSINATURA = [
  "/pedidos",
  "/conversas",
  "/cardapio",
  "/admin",
  "/financeiro",
  "/contador",
  "/configuracoes",
  "/relatorios",
  "/integracoes",
  "/setup",
  "/dev",
] as const;

const ROLES_OPERACIONAIS_ASSINATURA = [
  "admin",
  "atendente",
  "dev",
  "contador",
  "financeiro",
] as const;

export function ehRotaOperacionalAssinatura(pathname: string) {
  if (pathname === "/login" || pathname.startsWith("/entregador")) return false;
  return ROTAS_OPERACIONAIS_ASSINATURA.some(
    (rota) => pathname === rota || pathname.startsWith(`${rota}/`),
  );
}

export function temSessaoOperacionalAssinatura(cookieString: string) {
  const cookie = cookieString
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("auth-user="));
  if (!cookie) return false;

  try {
    const valor = decodeURIComponent(cookie.slice("auth-user=".length));
    const user = JSON.parse(valor) as { role?: string };
    return ROLES_OPERACIONAIS_ASSINATURA.includes(
      user.role as (typeof ROLES_OPERACIONAIS_ASSINATURA)[number],
    );
  } catch {
    return false;
  }
}

export function estadoCtaAssinatura(params: {
  planoSelecionado: boolean;
  regular: boolean;
  canManage: boolean;
  loading: boolean;
}) {
  const disabled = !params.canManage || params.loading || !params.planoSelecionado;
  const label = !params.planoSelecionado
    ? "Escolha um plano"
    : params.regular
      ? "Continuar"
      : "Continuar para o pagamento";
  return { disabled, label };
}

export function planoIndisponivelPorPendencia(params: {
  blocked: boolean;
  daysLate: number;
  isCurrent: boolean;
}) {
  return (params.blocked || params.daysLate > 0) && !params.isCurrent;
}
