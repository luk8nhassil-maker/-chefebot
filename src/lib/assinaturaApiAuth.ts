import type { NextRequest } from "next/server";
import { verifyToken } from "./auth";

export async function usuarioAssinatura(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function podeGerenciarAssinatura(req: NextRequest) {
  const user = await usuarioAssinatura(req);
  return Boolean(user && ["admin", "dev", "financeiro"].includes(user.role));
}
