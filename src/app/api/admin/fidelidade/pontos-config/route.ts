import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { redis } from "@/lib/redis";
import {
  salvarConfigFidelidadePontos,
  CONFIG_FIDELIDADE_PONTOS_PADRAO,
  type ConfigFidelidadePontos,
} from "@/lib/fidelidade";
import { REGRA_ESTRELAS_V1 } from "@/lib/estrelas";

const CHAVE_CONFIG_PONTOS = "config:fidelidade:pontos";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

// GET /api/admin/fidelidade/pontos-config — lê a configuração atual de pontos/estrelas.
// Requer admin ou dev. Retorna o estado salvo explicitamente no Redis; nunca inventa
// valores de apresentação (descricaoRecompensa ausente = presente ainda não aprovado).
export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const rawSalva = await redis.get<ConfigFidelidadePontos>(CHAVE_CONFIG_PONTOS);
  return NextResponse.json(rawSalva ?? { ativo: false });
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
// descricaoRecompensa é OPCIONAL: ativar Estrelas sem enviá-lo deixa o campo ausente
// (estado neutro seguro). O campo só é escrito no Redis se o admin explicitamente o
// enviar no body, ou se já estava salvo de uma chamada anterior.
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

  // rawSalva: o que está efetivamente no Redis (null se nunca salvo).
  // existing: rawSalva ou padrao — usado para defaults de campos operacionais (ativo, metas).
  const rawSalva = await redis.get<ConfigFidelidadePontos>(CHAVE_CONFIG_PONTOS);
  const existing: ConfigFidelidadePontos = rawSalva ?? CONFIG_FIDELIDADE_PONTOS_PADRAO;

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

  // descricaoRecompensa: só persiste se foi enviada no body ou já estava salva no Redis.
  // rawSalva?.descricaoRecompensa garante que o padrao "1 Pizza Família" nunca é escrito
  // sem aprovação explícita do admin.
  const descricaoRecompensa: string | undefined =
    typeof body.descricaoRecompensa === "string" && body.descricaoRecompensa.trim()
      ? body.descricaoRecompensa.trim().slice(0, 120)
      : rawSalva?.descricaoRecompensa;

  const novaConfig: Record<string, unknown> = {
    ...existing,
    ativo,
    ...(regraVersao !== undefined ? { regraVersao } : {}),
    ...(coberturaEconomicaAprovada !== undefined ? { coberturaEconomicaAprovada } : {}),
    ...(metaEstrelas !== undefined ? { metaEstrelas } : {}),
  };

  // Aplicar descricaoRecompensa sem usar o padrão inventado
  if (descricaoRecompensa !== undefined) {
    novaConfig.descricaoRecompensa = descricaoRecompensa;
  } else {
    delete novaConfig.descricaoRecompensa;
  }

  // Se regraVersao foi explicitamente removida, limpa campos dependentes
  if ("regraVersao" in body && body.regraVersao !== REGRA_ESTRELAS_V1) {
    delete novaConfig.regraVersao;
    delete novaConfig.coberturaEconomicaAprovada;
    delete novaConfig.metaEstrelas;
  }

  await salvarConfigFidelidadePontos(novaConfig as ConfigFidelidadePontos);
  return NextResponse.json({ ok: true, config: novaConfig });
}
