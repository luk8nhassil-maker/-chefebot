import { NextRequest, NextResponse } from "next/server";
import { SALAO_COOKIE, criarTokenSalao, validarCodigoAcessoSalao } from "@/lib/salaoAuth";

export async function POST(req: NextRequest) {
  let body: { codigo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const codigo = (body.codigo || "").trim();
  if (!codigo) {
    return NextResponse.json({ ok: false, error: "Informe o código de acesso" }, { status: 400 });
  }

  const valido = await validarCodigoAcessoSalao(codigo);
  if (!valido) {
    return NextResponse.json({ ok: false, error: "Código de acesso incorreto" }, { status: 401 });
  }

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
