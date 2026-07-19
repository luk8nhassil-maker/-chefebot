import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigJornadaChef, salvarConfigJornadaChef, type TipoRecompensaJornada } from "@/lib/jornadaChef";

const TIPOS_VALIDOS: TipoRecompensaJornada[] = ["bebida_sobremesa", "pizza", "presente_especial"];

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
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.role !== "admin" && auth.role !== "dev") {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const sequenciaRecompensas = Array.isArray(body?.sequenciaRecompensas)
    ? body.sequenciaRecompensas
        .map((r: Record<string, unknown>) => ({
          tipo: TIPOS_VALIDOS.includes(r?.tipo as TipoRecompensaJornada) ? r.tipo : "bebida_sobremesa",
          produtoId: String(r?.produtoId ?? "").trim(),
          produtoNome: String(r?.produtoNome ?? "").trim(),
          ativo: r?.ativo !== false,
        }))
        .filter((r: { produtoId: string }) => r.produtoId.length > 0)
    : undefined;

  // Mantém a blindagem econômica aprovada mesmo com body adulterado — a
  // validação final (limites seguros) é sempre feita dentro de
  // `salvarConfigJornadaChef`, nunca confiando só nesta camada.
  const config = await salvarConfigJornadaChef({
    ativo: Boolean(body?.ativo),
    metaPizzas: Number(body?.metaPizzas),
    limitePizzasPorPedido: Number(body?.limitePizzasPorPedido),
    validadeRecompensaDias: Number(body?.validadeRecompensaDias),
    mensagensWhatsappAtivas: Boolean(body?.mensagensWhatsappAtivas),
    sequenciaRecompensas,
    textos: body?.textos && typeof body.textos === "object" ? body.textos : undefined,
  });
  return NextResponse.json({ ok: true, config });
}
