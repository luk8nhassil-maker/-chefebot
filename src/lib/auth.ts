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
    role: "atendente",
  },
  salao: {
    password: process.env.SALAO_PASSWORD!,
    name: "Atendente Salão",
    role: "atendente",
  },
  brito: {
    password: process.env.ADMIN_PASSWORD!,
    name: "Brito",
    role: "admin",
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
  { path: "/api/orders", roles: ["admin", "atendente", "dev"] },
  { path: "/api/padroes", roles: ["dev"] },
  { path: "/api/funcionarios", roles: ["admin", "dev"] },
];

function getSecret() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "chefebot-dev-secret-troque-em-producao"
  );
}

export function validateCredentials(
  username: string,
  password: string
): AuthUser | null {
  const user = USERS[username.toLowerCase()];
  if (!user || user.password !== password) return null;
  return { username: username.toLowerCase(), name: user.name, role: user.role };
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