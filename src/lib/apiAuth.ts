import { NextRequest, NextResponse } from "next/server";
import { verifyToken, type Role } from "./auth";

export type UsuarioAutenticado = { username: string; name: string; role: string };

/** Lê e valida o cookie auth-token de uma requisição de API (equipe, não cliente).
 *  Retorna o payload do JWT ou null se o cookie estiver ausente, inválido ou expirado. */
export async function autenticarRequisicao(req: NextRequest): Promise<UsuarioAutenticado | null> {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Verifica se o usuário autenticado tem uma das roles permitidas.
 *  Retorna a resposta de erro pronta (401 sem token/token inválido, 403 role
 *  sem permissão) para o handler retornar imediatamente, ou null se autorizado.
 *  Nunca inclui detalhes de token, segredo ou stack trace na resposta. */
export function exigirRole(
  usuario: UsuarioAutenticado | null,
  rolesPermitidas: Role[]
): NextResponse | null {
  if (!usuario) {
    return NextResponse.json({ ok: false, error: "Não autenticado" }, { status: 401 });
  }
  if (!rolesPermitidas.includes(usuario.role as Role)) {
    return NextResponse.json({ ok: false, error: "Sem permissão" }, { status: 403 });
  }
  return null;
}
