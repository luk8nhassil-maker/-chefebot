import { SignJWT, jwtVerify } from "jose";

export type Role = "admin" | "atendente";

export interface AuthUser {
  username: string;
  name: string;
  role: Role;
}

const USERS: Record<string, { password: string; name: string; role: Role }> = {
  kellyne: { password: "kellyne123", name: "Kellyne", role: "atendente" },
  brito: { password: "admin123", name: "Brito", role: "admin" },
};

// Routes and the minimum roles allowed to access them
export const ROUTE_ROLES: Array<{ path: string; roles: Role[] }> = [
  { path: "/relatorios", roles: ["admin"] },
  { path: "/pedidos", roles: ["admin", "atendente"] },
  { path: "/api/orders", roles: ["admin", "atendente"] },
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

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as AuthUser;
  } catch {
    return null;
  }
}

export function canAccess(role: Role, path: string): boolean {
  const rule = ROUTE_ROLES.find((r) => path.startsWith(r.path));
  if (!rule) return true;
  return rule.roles.includes(role);
}
