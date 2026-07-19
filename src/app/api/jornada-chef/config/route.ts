import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigJornadaChef, salvarConfigJornadaChef } from "@/lib/jornadaChef";

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
  const config = await obterConfigJornadaChef();
  // `canaryClienteIds` nunca sai bruto desta rota (mesmo sendo só clienteId,
  // não telefone) — a lista canário só é exposta mascarada, e só pela rota
  // dedicada /api/admin/jornada-chef/canario.
  const { canaryClienteIds: _canaryClienteIds, ...configPublica } = config;
  return NextResponse.json({ ...configPublica, canaryCount: config.canaryClienteIds.length });
}

export async function POST(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.role !== "admin" && auth.role !== "dev") {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
  }

  const body = await req.json();

  // A normalização e a validação (limites econômicos seguros, integridade da
  // sequência de presentes contra o cardápio real, guard de ativação por
  // modo de rollout) vivem inteiramente em `salvarConfigJornadaChef` — esta
  // rota nunca confia em nada do body além de repassar bruto para lá. A
  // lista canário NÃO é editável por aqui (rota dedicada /canario).
  const resultado = await salvarConfigJornadaChef({
    modoRollout: body?.modoRollout,
    metaPizzas: Number(body?.metaPizzas),
    limitePizzasPorPedido: Number(body?.limitePizzasPorPedido),
    validadeRecompensaDias: Number(body?.validadeRecompensaDias),
    mensagensWhatsappAtivas: Boolean(body?.mensagensWhatsappAtivas),
    sequenciaRecompensas: Array.isArray(body?.sequenciaRecompensas) ? body.sequenciaRecompensas : undefined,
    textos: body?.textos && typeof body.textos === "object" ? body.textos : undefined,
  });

  if (!resultado.ok) {
    return NextResponse.json({ ok: false, error: resultado.erro, detalhes: resultado.detalhes }, { status: 400 });
  }
  const { canaryClienteIds: _canaryClienteIds, ...configPublica } = resultado.config;
  return NextResponse.json({ ok: true, config: { ...configPublica, canaryCount: resultado.config.canaryClienteIds.length } });
}
