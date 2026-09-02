import { SignJWT, jwtVerify } from "jose";

export type Role = "admin" | "atendente" | "dev" | "contador" | "financeiro" | "entregador";

export interface AuthUser {
  username: string;
  name: string;
  role: Role;
}

const USERS: Record<string, { password: string; name: string; role: Role }> = {
  kellyne: {
    password: process.env.KELLYNE_PASSWORD!,
    name: "Kellyne",
    role: "admin",
  },
  salao: {
    password: process.env.SALAO_PASSWORD!,
    name: "Atendente Salão",
    role: "atendente",
  },
  ominix: {
    password: process.env.OMINIX_PASSWORD!,
    name: "Ominix Dev",
    role: "dev",
  },
};

export const ROUTE_ROLES: Array<{ path: string; roles: Role[] }> = [
  { path: "/dev", roles: ["dev"] },
  { path: "/admin", roles: ["admin", "dev"] },
  { path: "/relatorios", roles: ["admin", "dev"] },
  { path: "/setup", roles: ["admin", "dev"] },
  { path: "/pedidos", roles: ["admin", "atendente", "dev"] },
  { path: "/configuracoes", roles: ["admin", "atendente", "dev"] },
  { path: "/financeiro", roles: ["admin", "dev", "financeiro"] },
  { path: "/contador", roles: ["admin", "dev", "contador"] },
  { path: "/api/orders", roles: ["admin", "atendente", "dev"] },
  { path: "/api/padroes", roles: ["dev"] },
  { path: "/api/funcionarios", roles: ["admin", "dev"] },
];

// /entregador NÃO está listada aqui de propósito, e propositalmente FORA DE
// ESCOPO desta PR (claude/protege-rotas-operacionais). Entregadores não têm
// conta no sistema de login da equipe (nenhum usuário em USERS tem role
// "entregador", e a página /entregador não passa por /login — o acesso é
// hoje só por um entregadorId enviado por WhatsApp ou digitado, sem senha,
// OTP ou token assinado). Gatear essa rota atrás de auth-token quebraria a
// atribuição/entrega de pedidos para qualquer entregador real, que nunca
// recebe esse cookie. A área do entregador (/entregador, /api/entregador-
// pedidos, /api/localizacao e o link enviado ao motoboy) permanece
// EXATAMENTE como está hoje — nenhum endurecimento, nem parcial, foi feito
// aqui. Requer uma PR dedicada introduzindo autenticação real de entregador
// antes de qualquer proteção ser adicionada, e o subdomínio
// painel.chefedapizza.com.br continua bloqueado até essa PR ser concluída
// e validada.

function getSecret() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "chefebot-dev-secret-troque-em-producao"
  );
}

export function validateCredentials(
  username: string,
  password: string
): AuthUser | null {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedPassword = password.trim();
  const user = USERS[normalizedUsername];
  if (!user || user.password !== normalizedPassword) return null;
  return { username: normalizedUsername, name: user.name, role: user.role };
}

export async function createToken(user: AuthUser): Promise<string> {
  return new SignJWT({ username: user.username, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<{ username: string; name: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as { username: string; name: string; role: string };
  } catch {
    return null;
  }
}

export function canAccess(role: Role, path: string): boolean {
  const route = ROUTE_ROLES.find((r) => path.startsWith(r.path));
  if (!route) return true;
  return route.roles.includes(role);
}
