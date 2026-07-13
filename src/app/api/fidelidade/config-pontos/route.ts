import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  obterConfigFidelidadePontosEfetiva,
  salvarConfigFidelidadePontos,
  type ConfigFidelidadePontos,
} from "@/lib/fidelidade";

// Rota dedicada (separada de /api/fidelidade/config, que é do modelo legado
// por pizzas) para o painel admin ler/gravar a config do programa por pontos
// usado pela tela "Meus pontos". Rota nova para não arriscar o formato/
// consumidores já existentes de /api/fidelidade/config.

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

  const config = await obterConfigFidelidadePontosEfetiva();
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const auth = await checkAuthLeitura(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.role !== "admin" && auth.role !== "dev") {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corpo invalido" }, { status: 400 });
  }

  const descricaoRecompensa = String((body as Record<string, unknown>).descricaoRecompensa ?? "").trim().slice(0, 120);
  if (!descricaoRecompensa) {
    return NextResponse.json({ error: "descricaoRecompensa e obrigatoria" }, { status: 400 });
  }

  const metaPontosBruta = (body as Record<string, unknown>).metaPontos;
  const metaPontosNumero = Number(metaPontosBruta);
  if (!Number.isFinite(metaPontosNumero) || metaPontosNumero <= 0) {
    return NextResponse.json({ error: "metaPontos precisa ser um numero maior que zero" }, { status: 400 });
  }

  const config: ConfigFidelidadePontos = {
    ativo: Boolean((body as Record<string, unknown>).ativo),
    metaPontos: Math.round(metaPontosNumero),
    descricaoRecompensa,
  };

  await salvarConfigFidelidadePontos(config);
  return NextResponse.json({ ok: true, config });
}
