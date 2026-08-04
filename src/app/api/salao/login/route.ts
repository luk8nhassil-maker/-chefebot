import { NextResponse } from "next/server";
import { SALAO_COOKIE, criarTokenSalao } from "@/lib/salaoAuth";

// Sem código de acesso: qualquer requisição aqui recebe uma sessão do
// Salão válida (ver src/lib/salaoAuth.ts para o contexto da decisão). O
// terminal chama isto automaticamente ao abrir — não há mais formulário de
// código para o garçom digitar.
export async function POST() {
  const token = await criarTokenSalao();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SALAO_COOKIE, token, {
    path: "/",
    maxAge: 60 * 60 * 12,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });
  return res;
}
