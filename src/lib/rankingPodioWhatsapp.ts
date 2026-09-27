import "server-only";

import { createHash } from "node:crypto";
import { redis } from "./redis";
import { FUSO_EXPEDIENTE } from "./expedienteOperacional";
import { obterTemporadaAtiva } from "./temporadas";
import { obterRankingCompleto, reindexarPorFiltro, type EntradaRanking } from "./rankingClientes";
import { obterParticipacaoRankingParaClientes } from "./consentimentoRanking";
import { buscarClientePorId } from "./clientes";
import { clienteTemOptOutConviteRankingWhatsapp } from "./rankingConviteWhatsapp";
import { enviarTextoWhatsApp } from "./whatsappMensagem";
import { necessarioParaUltrapassar } from "./rankingRetencao";
import { obterReferenciaCoroaDinamica } from "./rankingCoroaDinamica";

const LINK_AREA_CLIENTE = "https://chefedapizza.com.br/cliente";
const TTL_ESTADO_SEGUNDOS = 120 * 24 * 60 * 60;
const TTL_RESERVA_DIA_SEGUNDOS = 3 * 24 * 60 * 60;
const HORA_DISPARO = 18;

export const POLITICA_PODIO_WHATSAPP = {
  horaLocal: HORA_DISPARO,
  maxMensagensPorClientePorDia: 1,
  somenteTop3Atual: true,
  repetirMesmoCenario: false,
} as const;

export type SnapshotPodioWhatsapp = {
  dataLocal: string;
  criadoEmMs: number;
  entradas: Array<Pick<EntradaRanking, "clienteId" | "posicao" | "score">>;
};

type UltimaMensagemPodio = {
  fingerprint: string;
  enviadoEmMs: number;
  temporadaId: string;
};

export type AcaoPedidoPodio = {
  estrelas: 3 | 5 | 7 | 9 | 12;
  minimoElegivelCents: number | null;
};

export type ContextoMensagemPodio = {
  posicao: 1 | 2 | 3;
  score: number;
  posicaoAnterior: number | null;
  alvoPosicao: 1 | 2 | null;
  necessarioParaUltrapassar: number | null;
  vantagemSobreSegundo: number | null;
  coroaAmeacada: boolean;
  nome?: string | null;
};

export type ResultadoProcessamentoPodioWhatsapp = {
  ok: boolean;
  temporadaId: string | null;
  participantesTop3: number;
  enviados: number;
  suprimidos: number;
  falhas: number;
  motivos: Record<string, number>;
};

function incrementar(motivos: Record<string, number>, motivo: string): void {
  motivos[motivo] = (motivos[motivo] ?? 0) + 1;
}

function partesLocais(agoraMs: number): { data: string; hora: number } | null {
  if (!Number.isFinite(agoraMs) || agoraMs <= 0) return null;
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO_EXPEDIENTE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date(agoraMs));
    const ano = partes.find((p) => p.type === "year")?.value;
    const mes = partes.find((p) => p.type === "month")?.value;
    const dia = partes.find((p) => p.type === "day")?.value;
    const hora = Number(partes.find((p) => p.type === "hour")?.value) % 24;
    if (!ano || !mes || !dia || !Number.isFinite(hora)) return null;
    return { data: `${ano}-${mes}-${dia}`, hora };
  } catch {
    return null;
  }
}

export function ehHorarioDisparoPodioWhatsapp(agoraMs: number = Date.now()): boolean {
  return partesLocais(agoraMs)?.hora === HORA_DISPARO;
}

export function dataLocalPodioWhatsapp(agoraMs: number = Date.now()): string | null {
  return partesLocais(agoraMs)?.data ?? null;
}

/**
 * Traduz a distância real no Ranking para a MENOR faixa normal de pedido
 * capaz de gerar Estrelas suficientes. Nunca promete um pedido único quando
 * a distância exige mais que o máximo normal de 12 Estrelas.
 */
export function acaoPedidoParaUltrapassar(necessario: number): AcaoPedidoPodio | null {
  const n = Number.isFinite(necessario) ? Math.max(0, Math.ceil(necessario)) : 0;
  if (n <= 0) return null;
  if (n <= 3) return { estrelas: 3, minimoElegivelCents: null };
  if (n <= 5) return { estrelas: 5, minimoElegivelCents: 4_000 };
  if (n <= 7) return { estrelas: 7, minimoElegivelCents: 7_000 };
  if (n <= 9) return { estrelas: 9, minimoElegivelCents: 10_000 };
  if (n <= 12) return { estrelas: 12, minimoElegivelCents: 15_000 };
  return null;
}

function pluralEstrelas(valor: number): string {
  return valor === 1 ? "Estrela" : "Estrelas";
}

function moeda(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function primeiroNome(nome?: string | null): string | null {
  const limpo = typeof nome === "string" ? nome.trim().replace(/\s+/g, " ") : "";
  if (!limpo) return null;
  return limpo.split(" ")[0].slice(0, 30);
}

function prefixoMovimento(contexto: ContextoMensagemPodio): string {
  const nome = primeiroNome(contexto.nome);
  const chamada = nome ? `*${nome}*, ` : "";

  if (contexto.posicaoAnterior === null) {
    return contexto.posicao === 1
      ? `${chamada}👑 você está no *#1* do Ranking do Chefe.`
      : `${chamada}🔥 você está no *#${contexto.posicao}* do Pódio do Chefe.`;
  }
  if (contexto.posicaoAnterior > 3 && contexto.posicao <= 3) {
    return `${chamada}🔥 você entrou no Pódio: agora é *#${contexto.posicao}*.`;
  }
  if (contexto.posicao < contexto.posicaoAnterior) {
    return contexto.posicao === 1
      ? `${chamada}🏆 você assumiu o *#1* do Ranking do Chefe.`
      : `${chamada}🔥 você subiu para *#${contexto.posicao}*.`;
  }
  if (contexto.posicao > contexto.posicaoAnterior) {
    return `${chamada}🔥 a disputa mudou: agora você está em *#${contexto.posicao}*.`;
  }
  return contexto.posicao === 1
    ? `${chamada}👑 você segue no *#1* do Ranking do Chefe.`
    : `${chamada}🔥 você segue no *#${contexto.posicao}* do Pódio.`;
}

export function montarMensagemPodioWhatsapp(contexto: ContextoMensagemPodio): string | null {
  if (![1, 2, 3].includes(contexto.posicao)) return null;
  const linhas = [prefixoMovimento(contexto)];

  if (contexto.posicao === 1) {
    if (contexto.vantagemSobreSegundo === null) return null;
    const vantagem = Math.max(0, Math.round(contexto.vantagemSobreSegundo));
    if (contexto.coroaAmeacada) {
      linhas.push(
        `👀 O #2 está a *${vantagem} ${pluralEstrelas(vantagem)}* de você. Sua Coroa entrou em disputa.`,
        "Acompanhe de perto e defenda a liderança."
      );
    } else {
      linhas.push(
        `Sua vantagem sobre o #2 está em *${vantagem} ${pluralEstrelas(vantagem)}*.`,
        "A disputa continua — acompanhe sua posição."
      );
    }
  } else {
    const necessario = contexto.necessarioParaUltrapassar;
    const alvo = contexto.alvoPosicao;
    if (!necessario || !alvo) return null;
    const n = Math.max(1, Math.round(necessario));
    linhas.push(`Faltam *${n} ${pluralEstrelas(n)}* para ultrapassar o #${alvo}.`);

    const acao = acaoPedidoParaUltrapassar(n);
    if (acao?.minimoElegivelCents === null) {
      linhas.push(`Seu próximo pedido que gere Estrelas já pode colocar você no *#${alvo}*.`);
    } else if (acao) {
      linhas.push(
        `Um pedido com pelo menos *${moeda(acao.minimoElegivelCents)} em produtos que geram Estrelas* já pode colocar você no *#${alvo}*.`
      );
    } else {
      linhas.push("A diferença ainda exige mais de um pedido normal. Continue acumulando Estrelas.");
    }
  }

  linhas.push(
    `Veja o Ranking: ${LINK_AREA_CLIENTE}`,
    "",
    "Se quiser pausar estas mensagens, responda *SAIR RANKING*."
  );
  return linhas.join("\n");
}

function fingerprintContexto(contexto: ContextoMensagemPodio): string {
  const base = contexto.posicao === 1
    ? `p1|gap:${contexto.vantagemSobreSegundo ?? "na"}|coroa:${contexto.coroaAmeacada ? 1 : 0}`
    : `p${contexto.posicao}|alvo:${contexto.alvoPosicao ?? "na"}|need:${contexto.necessarioParaUltrapassar ?? "na"}`;
  return createHash("sha256").update(base).digest("hex");
}

function chaveSnapshot(tenantId: string, temporadaId: string): string {
  return `ranking:podio-whatsapp:snapshot:${tenantId}:${temporadaId}`;
}

function chaveUltimaMensagem(tenantId: string, temporadaId: string, clienteId: string): string {
  return `ranking:podio-whatsapp:ultima:${tenantId}:${temporadaId}:${clienteId}`;
}

function chaveReservaDia(tenantId: string, temporadaId: string, dataLocal: string, clienteId: string): string {
  return `ranking:podio-whatsapp:dia:${tenantId}:${temporadaId}:${dataLocal}:${clienteId}`;
}

function telefoneWhatsapp(telefone: string): string | null {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  return `55${digitos}`;
}

function posicaoAnteriorDoSnapshot(snapshot: SnapshotPodioWhatsapp | null, clienteId: string): number | null {
  if (!snapshot) return null;
  return snapshot.entradas.find((e) => e.clienteId === clienteId)?.posicao ?? 4;
}

function contextoParaEntrada(params: {
  entrada: EntradaRanking;
  top3: EntradaRanking[];
  snapshotAnterior: SnapshotPodioWhatsapp | null;
  coroaMaxGap: number | null;
  nome?: string | null;
}): ContextoMensagemPodio {
  const { entrada, top3, snapshotAnterior, coroaMaxGap, nome } = params;
  const posicao = entrada.posicao as 1 | 2 | 3;
  const anterior = posicaoAnteriorDoSnapshot(snapshotAnterior, entrada.clienteId);

  if (posicao === 1) {
    const segundo = top3[1] ?? null;
    const vantagem = segundo ? Math.max(0, Math.round(entrada.score - segundo.score)) : null;
    return {
      posicao,
      score: entrada.score,
      posicaoAnterior: anterior,
      alvoPosicao: null,
      necessarioParaUltrapassar: null,
      vantagemSobreSegundo: vantagem,
      coroaAmeacada: vantagem !== null && coroaMaxGap !== null && coroaMaxGap > 0 && vantagem <= coroaMaxGap,
      nome,
    };
  }

  const acima = top3[posicao - 2];
  const alvoPosicao = acima?.posicao === 1 || acima?.posicao === 2 ? acima.posicao : null;
  const necessario = acima ? necessarioParaUltrapassar(entrada.score, acima.score) : null;
  return {
    posicao,
    score: entrada.score,
    posicaoAnterior: anterior,
    alvoPosicao,
    necessarioParaUltrapassar: necessario,
    vantagemSobreSegundo: null,
    coroaAmeacada: false,
    nome,
  };
}

export async function processarPodioWhatsapp18h(params?: {
  tenantId?: string;
  agoraMs?: number;
}): Promise<ResultadoProcessamentoPodioWhatsapp> {
  const tenantId = params?.tenantId?.trim() || "default";
  const agoraMs = params?.agoraMs ?? Date.now();
  const motivos: Record<string, number> = {};

  const dataLocal = dataLocalPodioWhatsapp(agoraMs);
  if (!dataLocal || !ehHorarioDisparoPodioWhatsapp(agoraMs)) {
    return { ok: true, temporadaId: null, participantesTop3: 0, enviados: 0, suprimidos: 0, falhas: 0, motivos: { fora_horario: 1 } };
  }

  const temporada = await obterTemporadaAtiva(tenantId);
  if (!temporada) {
    return { ok: true, temporadaId: null, participantesTop3: 0, enviados: 0, suprimidos: 0, falhas: 0, motivos: { sem_temporada_ativa: 1 } };
  }

  const rankingCompleto = await obterRankingCompleto(tenantId, temporada.temporadaId);
  if (rankingCompleto.length === 0) {
    return { ok: true, temporadaId: temporada.temporadaId, participantesTop3: 0, enviados: 0, suprimidos: 0, falhas: 0, motivos: { ranking_vazio: 1 } };
  }

  const ids = rankingCompleto.map((e) => e.clienteId);
  const participacoes = await obterParticipacaoRankingParaClientes(ids);
  const participantes = reindexarPorFiltro(rankingCompleto, (id) => participacoes.get(id) === true);
  const top3 = participantes.slice(0, 3);
  const snapshotKey = chaveSnapshot(tenantId, temporada.temporadaId);
  const snapshotAnterior = await redis.get<SnapshotPodioWhatsapp>(snapshotKey);

  const referenciaCoroa = top3.length >= 2
    ? await obterReferenciaCoroaDinamica(tenantId).catch(() => null)
    : null;

  let enviados = 0;
  let suprimidos = 0;
  let falhas = 0;

  for (const entrada of top3) {
    const cliente = await buscarClientePorId(entrada.clienteId);
    if (!cliente?.telefone) {
      suprimidos++;
      incrementar(motivos, "sem_telefone_cadastrado");
      continue;
    }

    const phone = telefoneWhatsapp(cliente.telefone);
    if (!phone) {
      suprimidos++;
      incrementar(motivos, "telefone_invalido");
      continue;
    }

    if (await clienteTemOptOutConviteRankingWhatsapp(phone)) {
      suprimidos++;
      incrementar(motivos, "opt_out");
      continue;
    }

    const contexto = contextoParaEntrada({
      entrada,
      top3,
      snapshotAnterior,
      coroaMaxGap: referenciaCoroa?.maxGapEstrelas ?? null,
      nome: cliente.nome,
    });
    const mensagem = montarMensagemPodioWhatsapp(contexto);
    if (!mensagem) {
      suprimidos++;
      incrementar(motivos, "sem_disputa_util");
      continue;
    }

    const fingerprint = fingerprintContexto(contexto);
    const ultima = await redis.get<UltimaMensagemPodio>(
      chaveUltimaMensagem(tenantId, temporada.temporadaId, entrada.clienteId)
    );
    if (ultima?.fingerprint === fingerprint) {
      suprimidos++;
      incrementar(motivos, "cenario_inalterado");
      continue;
    }

    // Reserva ANTES do provider: retry do cron no mesmo dia nunca duplica.
    const reservaKey = chaveReservaDia(tenantId, temporada.temporadaId, dataLocal, entrada.clienteId);
    const reservou = await redis.set(
      reservaKey,
      { fingerprint, reservadoEmMs: agoraMs },
      { nx: true, ex: TTL_RESERVA_DIA_SEGUNDOS },
    );
    if (!reservou) {
      suprimidos++;
      incrementar(motivos, "ja_reservado_no_dia");
      continue;
    }

    try {
      const resultado = await enviarTextoWhatsApp(phone, mensagem);
      if (!resultado.ok) {
        falhas++;
        incrementar(motivos, resultado.motivo ? `provider_${resultado.motivo}` : "provider_falhou");
        continue;
      }
      await redis.set(
        chaveUltimaMensagem(tenantId, temporada.temporadaId, entrada.clienteId),
        { fingerprint, enviadoEmMs: agoraMs, temporadaId: temporada.temporadaId } satisfies UltimaMensagemPodio,
        { ex: TTL_ESTADO_SEGUNDOS },
      );
      enviados++;
    } catch {
      falhas++;
      incrementar(motivos, "erro_envio");
    }
  }

  const snapshot: SnapshotPodioWhatsapp = {
    dataLocal,
    criadoEmMs: agoraMs,
    entradas: top3.map(({ clienteId, posicao, score }) => ({ clienteId, posicao, score })),
  };
  await redis.set(snapshotKey, snapshot, { ex: TTL_ESTADO_SEGUNDOS });

  return {
    ok: true,
    temporadaId: temporada.temporadaId,
    participantesTop3: top3.length,
    enviados,
    suprimidos,
    falhas,
    motivos,
  };
}
