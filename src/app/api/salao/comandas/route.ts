import { NextRequest, NextResponse } from "next/server";
import { lerSessaoSalao } from "@/lib/salaoAuth";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { abrirComanda, listarComandas } from "@/lib/comandas";

export const dynamic = "force-dynamic";

// Lista de comandas: o próprio Salão consulta (para saber quais mesas estão
// abertas) e o painel administrativo também consulta (visão de comandas
// integrada só onde necessário) — duas sessões diferentes, mesmo dado.
export async function GET(req: NextRequest) {
  const [sessaoSalao, sessaoAdmin] = await Promise.all([lerSessaoSalao(req), lerSessaoAdministrativa(req)]);
  if (!sessaoSalao && !sessaoAdmin) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get("status");
  const todas = await listarComandas();
  const comandas = status ? todas.filter((c) => c.status === status) : todas;
  return NextResponse.json({ ok: true, comandas });
}

// Abrir uma comanda é uma ação exclusiva do terminal do Salão.
export async function POST(req: NextRequest) {
  const sessaoSalao = await lerSessaoSalao(req);
  if (!sessaoSalao) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  let body: { mesa?: string; complemento?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const mesa = (body.mesa || "").trim();
  if (!mesa) {
    return NextResponse.json({ ok: false, error: "Informe a mesa" }, { status: 400 });
  }

  const comanda = await abrirComanda(mesa, body.complemento);
  return NextResponse.json({ ok: true, comanda });
}
