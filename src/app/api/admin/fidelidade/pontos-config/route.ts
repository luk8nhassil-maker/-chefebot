import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  obterConfigFidelidadePontos,
  salvarConfigFidelidadePontos,
  CONFIG_FIDELIDADE_PONTOS_PADRAO,
  type ConfigFidelidadePontos,
} from "@/lib/fidelidade";
import { REGRA_ESTRELAS_V1 } from "@/lib/estrelas";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

// GET /api/admin/fidelidade/pontos-config — lê a configuração atual de pontos/estrelas.
// Requer admin ou dev.
export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await obterConfigFidelidadePontos();
  return NextResponse.json(config);
}

// POST /api/admin/fidelidade/pontos-config — atualiza a configuração de pontos/estrelas.
// Requer admin ou dev.
//
// Campos aceitos no body:
//   ativo: boolean                          — liga/desliga o sistema de pontos
//   regraVersao: "estrelas-faixas-v1" | null — null ou ausente = modelo legado
//   coberturaEconomicaAprovada: boolean    — libera apresentação de presentes ao cliente
//   metaEstrelas: number                    — meta de estrelas para o presente (padrão 50)
//   descricaoRecompensa: string             — texto do presente exibido ao cliente
//
// Para rollback: POST com { ativo: false } ou { regraVersao: null }.
export async function POST(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const existing = await obterConfigFidelidadePontos();

  const ativo = "ativo" in body ? Boolean(body.ativo) : existing.ativo;

  // regraVersao: aceita só o valor conhecido ou null/ausente (never bypass)
  let regraVersao: typeof REGRA_ESTRELAS_V1 | undefined;
  if ("regraVersao" in body) {
    if (body.regraVersao === REGRA_ESTRELAS_V1) {
      regraVersao = REGRA_ESTRELAS_V1;
    }
    // qualquer outro valor (null, "", desconhecido) → remove o campo (volta ao legado)
  } else {
    regraVersao = existing.regraVersao;
  }

  const coberturaEconomicaAprovada =
    "coberturaEconomicaAprovada" in body
      ? Boolean(body.coberturaEconomicaAprovada)
      : existing.coberturaEconomicaAprovada;

  const metaEstrelas =
    "metaEstrelas" in body && Number.isFinite(Number(body.metaEstrelas)) && Number(body.metaEstrelas) > 0
      ? Math.round(Number(body.metaEstrelas))
      : existing.metaEstrelas;

  const descricaoRecompensa =
    typeof body.descricaoRecompensa === "string" && body.descricaoRecompensa.trim()
      ? body.descricaoRecompensa.trim().slice(0, 120)
      : (existing.descricaoRecompensa ?? CONFIG_FIDELIDADE_PONTOS_PADRAO.descricaoRecompensa);

  const novaConfig: ConfigFidelidadePontos = {
    ...existing,
    ativo,
    descricaoRecompensa,
    ...(regraVersao !== undefined ? { regraVersao } : {}),
    ...(coberturaEconomicaAprovada !== undefined ? { coberturaEconomicaAprovada } : {}),
    ...(metaEstrelas !== undefined ? { metaEstrelas } : {}),
  };

  // Se regraVersao foi explicitamente removida, limpa o campo
  if ("regraVersao" in body && body.regraVersao !== REGRA_ESTRELAS_V1) {
    delete novaConfig.regraVersao;
    delete novaConfig.coberturaEconomicaAprovada;
    delete novaConfig.metaEstrelas;
  }

  await salvarConfigFidelidadePontos(novaConfig);
  return NextResponse.json({ ok: true, config: novaConfig });
}
