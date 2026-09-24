import { createHash } from "node:crypto";
import type { MomentoPesquisaId } from "./pesquisaPreferencia";
import { derivarResearchCustomerKey } from "./pesquisaPreferenciaContatosRedis";
import { registrarOptOutPesquisa } from "./pesquisaPreferenciaOptOutRedis";
import { redis } from "./redis";

const TTL_PENDENTE_SEGUNDOS = 60 * 60; // mesma janela da avaliação 1–5 existente
const TTL_RESPOSTA_SEGUNDOS = 90 * 24 * 60 * 60;

export type PesquisaPendente = {
  exposureId: string;
  momentId: MomentoPesquisaId;
  questionId: string;
  questionVersion: number;
  sentAtMs: number;
};

export type RespostaPesquisaPersistida = {
  exposureId: string;
  momentId: MomentoPesquisaId;
  questionId: string;
  questionVersion: number;
  rawAnswer: string;
  createdAtMs: number;
};

export type ResultadoConsumoRespostaPesquisa =
  | { consumida: false }
  | { consumida: true; tipo: "resposta" | "opt_out"; exposureId: string };

function normalizarId(valor: string): string | null {
  const v = valor.trim();
  if (!v || v.length > 180) return null;
  return v;
}

function chavePendente(customerKey: string): string {
  return `pesquisa:pendente:v1:${customerKey}`;
}

function chaveResposta(exposureId: string): string {
  const hash = createHash("sha256")
    .update(`chefebot:research:response:v1:${exposureId}`)
    .digest("hex");
  return `pesquisa:respostas:v1:${hash}`;
}

function ehComandoOptOut(texto: string): boolean {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase() === "sair";
}

/**
 * Arma o contexto de resposta somente depois de um futuro envio confirmado.
 * Não envia mensagem e não contém telefone bruto no namespace de pesquisa.
 *
 * A janela de 1h replica a pesquisa 1–5 já existente, evitando introduzir
 * uma nova duração operacional sem evidência.
 */
export async function registrarPesquisaPendente(params: {
  telefone?: string;
  exposureId: string;
  momentId: MomentoPesquisaId;
  questionId: string;
  questionVersion: number;
  sentAtMs?: number;
}): Promise<boolean> {
  const customerKey = derivarResearchCustomerKey(params.telefone);
  const exposureId = normalizarId(params.exposureId);
  const questionId = normalizarId(params.questionId);
  const sentAtMs = params.sentAtMs ?? Date.now();

  if (
    !customerKey ||
    !exposureId ||
    !questionId ||
    !Number.isInteger(params.questionVersion) ||
    params.questionVersion <= 0 ||
    !Number.isFinite(sentAtMs) ||
    sentAtMs <= 0
  ) {
    return false;
  }

  const pendente: PesquisaPendente = {
    exposureId,
    momentId: params.momentId,
    questionId,
    questionVersion: params.questionVersion,
    sentAtMs,
  };

  await redis.set(chavePendente(customerKey), pendente, {
    ex: TTL_PENDENTE_SEGUNDOS,
  });
  return true;
}


/**
 * Leitura usada pelo gate para impedir novo contato enquanto uma pergunta
 * anterior ainda está aguardando resposta.
 */
export async function clienteTemPesquisaPendente(
  telefone?: string
): Promise<boolean> {
  const customerKey = derivarResearchCustomerKey(telefone);
  if (!customerKey) return false;
  const pendente = await redis.get<PesquisaPendente>(chavePendente(customerKey));
  return !!pendente;
}

/**
 * Intercepta a resposta ANTES do fluxo normal do bot.
 *
 * - sem pendência: não interfere;
 * - "SAIR" exato: grava opt-out e consome a mensagem;
 * - texto livre: persiste a resposta sem telefone/nome/endereço e consome;
 * - erro de persistência propaga para o webhook, que não deixa a resposta
 *   cair acidentalmente no fluxo de pedido.
 */
export async function consumirRespostaPesquisaPendente(params: {
  telefone?: string;
  resposta: string;
  agoraMs?: number;
}): Promise<ResultadoConsumoRespostaPesquisa> {
  const customerKey = derivarResearchCustomerKey(params.telefone);
  if (!customerKey) return { consumida: false };

  const pendingKey = chavePendente(customerKey);
  const pendente = await redis.get<PesquisaPendente>(pendingKey);
  if (!pendente) return { consumida: false };

  const exposureId = normalizarId(pendente.exposureId);
  const questionId = normalizarId(pendente.questionId);
  const resposta = params.resposta.trim();
  const agoraMs = params.agoraMs ?? Date.now();

  if (
    !exposureId ||
    !questionId ||
    !resposta ||
    !Number.isInteger(pendente.questionVersion) ||
    pendente.questionVersion <= 0 ||
    !Number.isFinite(agoraMs) ||
    agoraMs <= 0
  ) {
    // Há uma pendência real. Entrada inválida não deve virar pedido.
    return { consumida: true, tipo: "resposta", exposureId: pendente.exposureId };
  }

  if (ehComandoOptOut(resposta)) {
    const registrado = await registrarOptOutPesquisa({
      telefone: params.telefone,
      registradoEmMs: agoraMs,
    });
    if (!registrado) {
      throw new Error("research_optout_not_persisted");
    }
    await redis.del(pendingKey);
    return { consumida: true, tipo: "opt_out", exposureId };
  }

  const registro: RespostaPesquisaPersistida = {
    exposureId,
    momentId: pendente.momentId,
    questionId,
    questionVersion: pendente.questionVersion,
    rawAnswer: resposta.slice(0, 2000),
    createdAtMs: agoraMs,
  };

  const gravado = await redis.set(chaveResposta(exposureId), registro, {
    ex: TTL_RESPOSTA_SEGUNDOS,
    nx: true,
  });

  // Se já existe, é retry/idempotência. Em ambos os casos a mensagem foi
  // reconhecida como resposta de pesquisa e não segue para o bot.
  if (gravado === null) {
    await redis.del(pendingKey);
    return { consumida: true, tipo: "resposta", exposureId };
  }

  await redis.del(pendingKey);
  return { consumida: true, tipo: "resposta", exposureId };
}
