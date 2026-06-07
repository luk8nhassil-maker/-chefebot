import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken } from "@/lib/auth";

type PadraoAprendido = {
  original: string;
  interpretado: string;
  vezes: number;
  criadoEm: string;
};

async function checkAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;
  if (!token) return false;
  const user = await verifyToken(token);
  return user?.role === "admin";
}

export async function GET(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const padroes = await redis.get<Record<string, PadraoAprendido>>("padroes_aprendidos") || {};
  const lista = Object.values(padroes).sort((a, b) => b.vezes - a.vezes);
  return NextResponse.json(lista);
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { original } = await req.json();
  const padroes = await redis.get<Record<string, PadraoAprendido>>("padroes_aprendidos") || {};
  delete padroes[original];
  await redis.set("padroes_aprendidos", padroes);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { original, interpretado } = await req.json();
  const padroes = await redis.get<Record<string, PadraoAprendido>>("padroes_aprendidos") || {};
  if (padroes[original]) {
    padroes[original].interpretado = interpretado;
    await redis.set("padroes_aprendidos", padroes);
  }
  return NextResponse.json({ ok: true });
}