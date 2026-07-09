import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigFidelidade, salvarConfigFidelidade, CONFIG_FIDELIDADE_PADRAO, type ConfigFidelidade, type TipoRecompensa } from "@/lib/fidelidade";

const TIPOS_VALIDOS: TipoRecompensa[] = ["pizza_gratis", "desconto_fixo", "desconto_percentual"];

async function checkAuthLeitura(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await obterConfigFidelidade();
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.role !== "admin" && auth.role !== "dev") {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const tipoRecompensa: TipoRecompensa = TIPOS_VALIDOS.includes(body?.tipoRecompensa)
    ? body.tipoRecompensa
    : CONFIG_FIDELIDADE_PADRAO.tipoRecompensa;

  const config: ConfigFidelidade = {
    ativo: Boolean(body?.ativo),
    pizzasParaPremio: Math.max(1, Number(body?.pizzasParaPremio) || CONFIG_FIDELIDADE_PADRAO.pizzasParaPremio),
    tipoRecompensa,
    descricaoRecompensa: (body?.descricaoRecompensa || CONFIG_FIDELIDADE_PADRAO.descricaoRecompensa).toString().slice(0, 120),
    ...(body?.validadeDias ? { validadeDias: Math.max(1, Number(body.validadeDias)) } : {}),
  };

  await salvarConfigFidelidade(config);
  return NextResponse.json({ ok: true, config });
}
