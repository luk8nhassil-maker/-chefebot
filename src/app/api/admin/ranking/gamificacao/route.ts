import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  obterConfigGamificacao,
  salvarConfigGamificacao,
  CONFIG_GAMIFICACAO_PADRAO,
  type ConfigGamificacao,
} from "@/lib/rankingGamificacaoConfig";
import type { ConfigCarryoverPosicao, LimiarNivelChef } from "@/lib/rankingGamificacao";

async function checkAuthAdmin(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "dev"].includes(payload.role as string)) return null;
  return payload;
}

function numeroValido(valor: unknown, minimo = 0): number | undefined {
  const n = Number(valor);
  return Number.isFinite(n) && n >= minimo ? n : undefined;
}

// Valida e sanitiza a tabela de carryover: só aceita posições 1..10 e bônus > 0.
// Qualquer entrada malformada (posição fora do intervalo, bônus <= 0) é descartada
// silenciosamente — nunca propaga um valor inválido para a config salva.
function sanitizarCarryoverTabela(valor: unknown): ConfigCarryoverPosicao[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const tabela: ConfigCarryoverPosicao[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const posicao = numeroValido((item as Record<string, unknown>).posicao, 1);
    const bonus = numeroValido((item as Record<string, unknown>).bonus, 1);
    if (posicao === undefined || bonus === undefined) continue;
    if (posicao < 1 || posicao > 10) continue;
    tabela.push({ posicao: Math.round(posicao), bonus: Math.round(bonus) });
  }
  return tabela;
}

function sanitizarNivelLimiares(valor: unknown): LimiarNivelChef[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const limiares: LimiarNivelChef[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const registro = item as Record<string, unknown>;
    const nivel = numeroValido(registro.nivel, 1);
    const xpMinimo = numeroValido(registro.xpMinimo, 0);
    const nome = typeof registro.nome === "string" ? registro.nome.trim().slice(0, 40) : "";
    if (nivel === undefined || xpMinimo === undefined || !nome) continue;
    limiares.push({ nivel: Math.round(nivel), nome, xpMinimo: Math.round(xpMinimo) });
  }
  return limiares;
}

// GET /api/admin/ranking/gamificacao — lê a configuração atual (ou o padrão
// fail-closed, todo mundo desligado, se nunca foi salva). Requer admin ou dev.
export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await obterConfigGamificacao();
  return NextResponse.json(config);
}

// POST /api/admin/ranking/gamificacao — atualiza a configuração. Cada campo é
// opcional; campos ausentes preservam o valor já salvo (ou o padrão). Nenhum
// campo numérico/tabela aceita valor inválido — nesse caso mantém o anterior
// em vez de gravar algo que quebraria o fail-closed das funções puras.
export async function POST(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const existing = await obterConfigGamificacao();

  const novaConfig: ConfigGamificacao = {
    missaoSemanalAtiva: "missaoSemanalAtiva" in body ? Boolean(body.missaoSemanalAtiva) : existing.missaoSemanalAtiva,
    missaoSemanalMultiplicador: numeroValido(body.missaoSemanalMultiplicador, 1) ?? existing.missaoSemanalMultiplicador,
    missaoSemanalCooldownDias: numeroValido(body.missaoSemanalCooldownDias, 1) ?? existing.missaoSemanalCooldownDias,

    missaoIndicacaoAtiva: "missaoIndicacaoAtiva" in body ? Boolean(body.missaoIndicacaoAtiva) : existing.missaoIndicacaoAtiva,
    missaoIndicacaoBonus: numeroValido(body.missaoIndicacaoBonus, 0) ?? existing.missaoIndicacaoBonus,

    impulsoPodioAtivo: "impulsoPodioAtivo" in body ? Boolean(body.impulsoPodioAtivo) : existing.impulsoPodioAtivo,
    impulsoPodioBonus: numeroValido(body.impulsoPodioBonus, 0) ?? existing.impulsoPodioBonus,
    impulsoPodioCapTemporada: numeroValido(body.impulsoPodioCapTemporada, 0) ?? existing.impulsoPodioCapTemporada,

    carryoverAtivo: "carryoverAtivo" in body ? Boolean(body.carryoverAtivo) : existing.carryoverAtivo,
    carryoverTabela: sanitizarCarryoverTabela(body.carryoverTabela) ?? existing.carryoverTabela,

    nivelChefAtivo: "nivelChefAtivo" in body ? Boolean(body.nivelChefAtivo) : existing.nivelChefAtivo,
    nivelChefLimiares: sanitizarNivelLimiares(body.nivelChefLimiares) ?? existing.nivelChefLimiares,
  };

  await salvarConfigGamificacao(novaConfig);
  return NextResponse.json({ ok: true, config: novaConfig });
}

// Reexportado só para o admin poder resetar via UI sem hardcode duplicado.
export { CONFIG_GAMIFICACAO_PADRAO };
