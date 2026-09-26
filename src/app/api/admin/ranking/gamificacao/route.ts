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

// Limites técnicos de segurança — nunca decidem a regra de negócio (isso é
// do admin), só impedem que um erro de digitação vire incidente (ex.: "2"
// virar "20" sem querer no multiplicador da missão semanal).
//
// missaoSemanalMultiplicador: min=max=2 é DELIBERADO, não um limite técnico
// comum — a regra de produto aprovada para esta versão da "Caçada ao Pódio"
// é EXATAMENTE 2x ("Seu próximo pedido vale 2x no Ranking desta
// temporada."). 3x/4x/5x nunca foram aprovados; o admin pode ativar/
// desativar a missão e ajustar o cooldown, mas não reinventar a mecânica.
const LIMITES = {
  missaoSemanalMultiplicador: { min: 2, max: 2 },
  missaoSemanalCooldownDias: { min: 1, max: 90 },
  missaoIndicacaoBonus: { min: 0, max: 100_000 },
  impulsoPodioBonus: { min: 0, max: 100_000 },
  impulsoPodioCapTemporada: { min: 0, max: 1_000_000 },
  carryoverBonus: { min: 0, max: 100_000 },
  nivelXpMinimo: { min: 0, max: 10_000_000 },
  ameacaPodioMaxGap: { min: 0, max: 100_000 },
} as const;

type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Booleano ESTRITO — nunca `Boolean(valor)`, que trataria a string "false" como `true`. */
function parseBooleanoEstrito(campo: string, valor: unknown): Resultado<boolean> {
  if (typeof valor === "boolean") return { ok: true, valor };
  return { ok: false, erro: `${campo} deve ser true ou false` };
}

function parseNumero(campo: string, valor: unknown, limites: { min: number; max: number }): Resultado<number> {
  const n = Number(valor);
  if (typeof valor !== "number" && typeof valor !== "string") return { ok: false, erro: `${campo} deve ser um número` };
  if (!Number.isFinite(n)) return { ok: false, erro: `${campo} deve ser um número` };
  if (n < limites.min || n > limites.max) return { ok: false, erro: `${campo} deve estar entre ${limites.min} e ${limites.max}` };
  return { ok: true, valor: Math.round(n * 100) / 100 };
}

/**
 * Valida a tabela de carryover por inteiro: posições únicas em 1..10,
 * bônus dentro do limite técnico, e ORDEM ESTRITAMENTE decrescente (regra de
 * produto: #1 > #2 > #3 > ... > #10 — nunca empate entre posições
 * adjacentes). Config incoerente é rejeitada por inteiro — nunca filtra
 * silenciosamente linhas ruins, nunca salva parcialmente. A EXIGÊNCIA de
 * cobrir todas as 10 posições (quando `carryoverAtivo=true`) é validada à
 * parte, depois do merge com a config existente (ver regra cruzada no POST).
 */
function parseCarryoverTabela(valor: unknown): Resultado<ConfigCarryoverPosicao[]> {
  if (!Array.isArray(valor)) return { ok: false, erro: "carryoverTabela deve ser uma lista" };
  const tabela: ConfigCarryoverPosicao[] = [];
  const posicoesVistas = new Set<number>();
  for (const item of valor) {
    if (!item || typeof item !== "object") return { ok: false, erro: "carryoverTabela tem uma entrada inválida" };
    const registro = item as Record<string, unknown>;
    const posicao = Number(registro.posicao);
    const bonus = Number(registro.bonus);
    if (!Number.isInteger(posicao) || posicao < 1 || posicao > 10) {
      return { ok: false, erro: `carryoverTabela: posição inválida (${String(registro.posicao)}) — deve ser um inteiro entre 1 e 10` };
    }
    if (posicoesVistas.has(posicao)) {
      return { ok: false, erro: `carryoverTabela: posição #${posicao} duplicada` };
    }
    if (!Number.isFinite(bonus) || bonus < LIMITES.carryoverBonus.min || bonus > LIMITES.carryoverBonus.max) {
      return { ok: false, erro: `carryoverTabela: bônus inválido para #${posicao} (deve estar entre ${LIMITES.carryoverBonus.min} e ${LIMITES.carryoverBonus.max})` };
    }
    posicoesVistas.add(posicao);
    tabela.push({ posicao, bonus: Math.round(bonus) });
  }
  const ordenada = [...tabela].sort((a, b) => a.posicao - b.posicao);
  for (let i = 1; i < ordenada.length; i++) {
    if (ordenada[i].bonus >= ordenada[i - 1].bonus) {
      return {
        ok: false,
        erro: `carryoverTabela: bônus deve ser ESTRITAMENTE decrescente por posição (#${ordenada[i].posicao} precisa valer menos que #${ordenada[i - 1].posicao}, nunca igual ou mais)`,
      };
    }
  }
  return { ok: true, valor: ordenada };
}

/** As 10 posições que uma tabela de carryover precisa cobrir quando ativa. */
const POSICOES_CARRYOVER_OBRIGATORIAS = Array.from({ length: 10 }, (_, i) => i + 1);

/** Níveis únicos, nome sanitizado obrigatório, XP estritamente crescente por nível. */
function parseNivelLimiares(valor: unknown): Resultado<LimiarNivelChef[]> {
  if (!Array.isArray(valor)) return { ok: false, erro: "nivelChefLimiares deve ser uma lista" };
  const limiares: LimiarNivelChef[] = [];
  const niveisVistos = new Set<number>();
  for (const item of valor) {
    if (!item || typeof item !== "object") return { ok: false, erro: "nivelChefLimiares tem uma entrada inválida" };
    const registro = item as Record<string, unknown>;
    const nivel = Number(registro.nivel);
    const xpMinimo = Number(registro.xpMinimo);
    const nome = typeof registro.nome === "string" ? registro.nome.trim().slice(0, 40) : "";
    if (!Number.isInteger(nivel) || nivel < 1) {
      return { ok: false, erro: `nivelChefLimiares: nível inválido (${String(registro.nivel)})` };
    }
    if (niveisVistos.has(nivel)) return { ok: false, erro: `nivelChefLimiares: nível ${nivel} duplicado` };
    if (!nome) return { ok: false, erro: `nivelChefLimiares: nível ${nivel} sem nome` };
    if (!Number.isFinite(xpMinimo) || xpMinimo < LIMITES.nivelXpMinimo.min || xpMinimo > LIMITES.nivelXpMinimo.max) {
      return { ok: false, erro: `nivelChefLimiares: XP mínimo inválido para o nível ${nivel}` };
    }
    niveisVistos.add(nivel);
    limiares.push({ nivel, nome, xpMinimo: Math.round(xpMinimo) });
  }
  const ordenados = [...limiares].sort((a, b) => a.nivel - b.nivel);
  for (let i = 1; i < ordenados.length; i++) {
    if (ordenados[i].xpMinimo <= ordenados[i - 1].xpMinimo) {
      return {
        ok: false,
        erro: `nivelChefLimiares: XP deve crescer com o nível (nível ${ordenados[i].nivel} precisa de mais XP que o nível ${ordenados[i - 1].nivel})`,
      };
    }
  }
  return { ok: true, valor: ordenados };
}

// GET /api/admin/ranking/gamificacao — lê a configuração atual (ou o padrão
// fail-closed, todo mundo desligado, se nunca foi salva). Requer admin ou dev.
export async function GET(req: NextRequest) {
  const auth = await checkAuthAdmin(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const config = await obterConfigGamificacao();
  return NextResponse.json(config);
}

// POST /api/admin/ranking/gamificacao — atualiza a configuração. Cada campo
// é opcional; campo ausente preserva o valor já salvo. VALIDA TUDO antes de
// escrever qualquer coisa: um único campo inválido rejeita a requisição
// inteira com 400 e a lista de erros — nunca salva parcialmente, nunca
// ignora silenciosamente um valor ruim (correção de hardening da auditoria
// do #446).
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
  const erros: string[] = [];
  const novaConfig: ConfigGamificacao = { ...existing };

  if ("missaoSemanalAtiva" in body) {
    const r = parseBooleanoEstrito("missaoSemanalAtiva", body.missaoSemanalAtiva);
    if (r.ok) novaConfig.missaoSemanalAtiva = r.valor; else erros.push(r.erro);
  }
  if ("missaoSemanalMultiplicador" in body) {
    const r = parseNumero("missaoSemanalMultiplicador", body.missaoSemanalMultiplicador, LIMITES.missaoSemanalMultiplicador);
    if (r.ok) novaConfig.missaoSemanalMultiplicador = r.valor; else erros.push(r.erro);
  }
  if ("missaoSemanalCooldownDias" in body) {
    const r = parseNumero("missaoSemanalCooldownDias", body.missaoSemanalCooldownDias, LIMITES.missaoSemanalCooldownDias);
    if (r.ok) novaConfig.missaoSemanalCooldownDias = r.valor; else erros.push(r.erro);
  }

  if ("missaoIndicacaoAtiva" in body) {
    const r = parseBooleanoEstrito("missaoIndicacaoAtiva", body.missaoIndicacaoAtiva);
    if (r.ok) novaConfig.missaoIndicacaoAtiva = r.valor; else erros.push(r.erro);
  }
  if ("missaoIndicacaoBonus" in body) {
    const r = parseNumero("missaoIndicacaoBonus", body.missaoIndicacaoBonus, LIMITES.missaoIndicacaoBonus);
    if (r.ok) novaConfig.missaoIndicacaoBonus = r.valor; else erros.push(r.erro);
  }

  if ("impulsoPodioAtivo" in body) {
    const r = parseBooleanoEstrito("impulsoPodioAtivo", body.impulsoPodioAtivo);
    if (r.ok) novaConfig.impulsoPodioAtivo = r.valor; else erros.push(r.erro);
  }
  if ("impulsoPodioBonus" in body) {
    const r = parseNumero("impulsoPodioBonus", body.impulsoPodioBonus, LIMITES.impulsoPodioBonus);
    if (r.ok) novaConfig.impulsoPodioBonus = r.valor; else erros.push(r.erro);
  }
  if ("impulsoPodioCapTemporada" in body) {
    const r = parseNumero("impulsoPodioCapTemporada", body.impulsoPodioCapTemporada, LIMITES.impulsoPodioCapTemporada);
    if (r.ok) novaConfig.impulsoPodioCapTemporada = r.valor; else erros.push(r.erro);
  }

  if ("carryoverAtivo" in body) {
    const r = parseBooleanoEstrito("carryoverAtivo", body.carryoverAtivo);
    if (r.ok) novaConfig.carryoverAtivo = r.valor; else erros.push(r.erro);
  }
  if ("carryoverTabela" in body) {
    const r = parseCarryoverTabela(body.carryoverTabela);
    if (r.ok) novaConfig.carryoverTabela = r.valor; else erros.push(r.erro);
  }

  if ("nivelChefAtivo" in body) {
    const r = parseBooleanoEstrito("nivelChefAtivo", body.nivelChefAtivo);
    if (r.ok) novaConfig.nivelChefAtivo = r.valor; else erros.push(r.erro);
  }
  if ("nivelChefLimiares" in body) {
    const r = parseNivelLimiares(body.nivelChefLimiares);
    if (r.ok) novaConfig.nivelChefLimiares = r.valor; else erros.push(r.erro);
  }

  if ("ameacaPodioMaxGap" in body) {
    const r = parseNumero("ameacaPodioMaxGap", body.ameacaPodioMaxGap, LIMITES.ameacaPodioMaxGap);
    if (r.ok) novaConfig.ameacaPodioMaxGap = r.valor; else erros.push(r.erro);
  }

  // Regra cruzada: o bônus do impulso nunca pode valer mais que o teto da
  // temporada quando o teto está configurado (teto 0 = feature ainda não
  // configurada, fail-closed — não é "incoerente", só inativa).
  if (novaConfig.impulsoPodioCapTemporada > 0 && novaConfig.impulsoPodioBonus > novaConfig.impulsoPodioCapTemporada) {
    erros.push("impulsoPodioBonus não pode ser maior que impulsoPodioCapTemporada");
  }

  // Regra cruzada: com o carryover ATIVO, a tabela precisa cobrir as 10
  // posições — nunca inventa valor para uma posição que o admin não
  // configurou, e nunca liga a feature com um "buraco" no meio do Top 10.
  // Com carryoverAtivo=false a tabela pode ficar vazia/parcial sem problema
  // (a feature está desligada, então uma tabela incompleta não é incoerente).
  if (novaConfig.carryoverAtivo) {
    const posicoesPresentes = new Set(novaConfig.carryoverTabela.map((e) => e.posicao));
    const faltando = POSICOES_CARRYOVER_OBRIGATORIAS.filter((p) => !posicoesPresentes.has(p));
    if (faltando.length > 0) {
      erros.push(`carryoverTabela: com carryoverAtivo=true, todas as posições 1 a 10 são obrigatórias (faltando: #${faltando.join(", #")})`);
    }
  }

  if (erros.length > 0) {
    return NextResponse.json({ error: "Configuração inválida", detalhes: erros }, { status: 400 });
  }

  await salvarConfigGamificacao(novaConfig);
  return NextResponse.json({ ok: true, config: novaConfig });
}

// Reexportado só para o admin poder resetar via UI sem hardcode duplicado.
export { CONFIG_GAMIFICACAO_PADRAO };
