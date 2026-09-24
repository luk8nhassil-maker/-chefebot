import { createHash } from "node:crypto";
import { derivarClienteIdPorTelefone } from "./fidelidade";
import { redis } from "./redis";

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const JANELA_DIAS = 90;
const TTL_SEGUNDOS = JANELA_DIAS * 24 * 60 * 60;

export type OrigemContatoPesquisa = "avaliacao_pos_entrega" | "motor_preferencia";

export type ContatoPesquisaPersistido = {
  origem: OrigemContatoPesquisa;
  eventId: string;
  sentAtMs: number;
};

type RedisContatoPesquisa = typeof redis & {
  zadd: (
    key: string,
    entry: { score: number; member: string }
  ) => Promise<number>;
  zrange: (
    key: string,
    min: number | string,
    max: number | string,
    opts?: { byScore?: boolean }
  ) => Promise<string[]>;
  zscore: (key: string, member: string) => Promise<number | null>;
  zremrangebyscore: (
    key: string,
    min: number | string,
    max: number | string
  ) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};

const rredis = redis as RedisContatoPesquisa;

function normalizarEventId(eventId: string): string | null {
  const valor = eventId.trim();
  if (!valor || valor.length > 180) return null;
  return valor;
}

/**
 * Chave estável derivada da identidade canônica já usada pelo ChefeBot.
 * Não armazena telefone bruto no namespace de pesquisa.
 */
export function derivarResearchCustomerKey(telefone: string | undefined): string | null {
  const clienteId = derivarClienteIdPorTelefone(telefone);
  if (!clienteId) return null;
  return createHash("sha256")
    .update(`chefebot:research:v1:${clienteId}`)
    .digest("hex");
}

function chaveContatos(customerKey: string): string {
  return `pesquisa:contatos:v1:${customerKey}`;
}

function memberContato(origem: OrigemContatoPesquisa, eventId: string): string {
  return `${origem}:${eventId}`;
}

function parseMember(member: string): Pick<ContatoPesquisaPersistido, "origem" | "eventId"> | null {
  const separador = member.indexOf(":");
  if (separador <= 0) return null;
  const origem = member.slice(0, separador);
  const eventId = member.slice(separador + 1);
  if (
    origem !== "avaliacao_pos_entrega" &&
    origem !== "motor_preferencia"
  ) {
    return null;
  }
  if (!eventId) return null;
  return { origem, eventId };
}

/**
 * Registra somente contatos que já foram confirmados pelo canal de envio.
 *
 * ZADD torna o eventId idempotente. Nenhum telefone, nome ou endereço entra
 * no valor persistido. A janela antiga é podada a cada gravação e o conjunto
 * expira 90 dias após o último contato.
 */
export async function registrarContatoPesquisaConfirmado(params: {
  telefone?: string;
  origem: OrigemContatoPesquisa;
  eventId: string;
  sentAtMs?: number;
}): Promise<boolean> {
  const customerKey = derivarResearchCustomerKey(params.telefone);
  const eventId = normalizarEventId(params.eventId);
  const sentAtMs = params.sentAtMs ?? Date.now();

  if (!customerKey || !eventId || !Number.isFinite(sentAtMs) || sentAtMs <= 0) {
    return false;
  }

  const key = chaveContatos(customerKey);
  const inicioJanela = sentAtMs - JANELA_DIAS * MS_POR_DIA;
  const member = memberContato(params.origem, eventId);

  await rredis.zadd(key, { score: sentAtMs, member });
  await rredis.zremrangebyscore(key, "-inf", inicioJanela);
  await rredis.expire(key, TTL_SEGUNDOS);
  return true;
}

/**
 * Lê somente a janela relevante ao orçamento de contato.
 */
export async function listarContatosPesquisaPorTelefone(params: {
  telefone?: string;
  agoraMs?: number;
}): Promise<ContatoPesquisaPersistido[]> {
  const customerKey = derivarResearchCustomerKey(params.telefone);
  const agoraMs = params.agoraMs ?? Date.now();
  if (!customerKey || !Number.isFinite(agoraMs) || agoraMs <= 0) return [];

  const key = chaveContatos(customerKey);
  const inicio = agoraMs - JANELA_DIAS * MS_POR_DIA;
  const members = await rredis.zrange(key, inicio, agoraMs, { byScore: true });

  const contatos: ContatoPesquisaPersistido[] = [];
  for (const member of members) {
    const parsed = parseMember(member);
    if (!parsed) continue;
    const score = await rredis.zscore(key, member);
    if (score === null || !Number.isFinite(score) || score <= inicio || score > agoraMs) {
      continue;
    }
    contatos.push({ ...parsed, sentAtMs: score });
  }

  return contatos.sort((a, b) => a.sentAtMs - b.sentAtMs);
}
