import { NextRequest, NextResponse } from "next/server";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { definirCodigoAcessoSalao, obterConfigSalao } from "@/lib/salaoAuth";

export const dynamic = "force-dynamic";

// Configuração do código de acesso do Salão — só admin/dev, nunca atendente
// (mesmo nível de acesso restrito de /setup e /configuracoes sensíveis).
// Nunca devolve o código em texto claro em GET: só informa se já existe.
function autorizado(role: string | undefined): boolean {
  return role === "admin" || role === "dev";
}

export async function GET(req: NextRequest) {
  const sessao = await lerSessaoAdministrativa(req);
  if (!sessao || !autorizado(sessao.role)) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  const config = await obterConfigSalao();
  return NextResponse.json({ ok: true, configurado: !!config.codigoAcesso, atualizadoEm: config.atualizadoEm });
}

export async function POST(req: NextRequest) {
  const sessao = await lerSessaoAdministrativa(req);
  if (!sessao || !autorizado(sessao.role)) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  let body: { codigo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Payload inválido" }, { status: 400 });
  }

  const codigo = (body.codigo || "").trim();
  if (codigo.length < 4) {
    return NextResponse.json({ ok: false, error: "Código precisa ter pelo menos 4 caracteres" }, { status: 400 });
  }

  await definirCodigoAcessoSalao(codigo);
  return NextResponse.json({ ok: true });
}
