// Memória universal de nomes de rua — autocomplete do campo "Rua" no
// checkout do cliente (ver AGENTS.md, item 8 da missão de UX/UI do
// cardápio/checkout). Compartilhada entre TODOS os clientes (não é por
// cliente/telefone) e guarda SOMENTE o nome da rua, nunca número,
// referência ou qualquer dado pessoal.
//
// Reaproveita a infraestrutura Redis já usada no projeto (src/lib/redis.ts
// — mesmo client Upstash usado por conversasHistorico, localizacao etc.),
// sem inventar armazenamento novo. Estrutura: um sorted set (score =
// timestamp da última vez que a rua foi usada) com o nome "de exibição"
// como member, deduplicado por uma chave normalizada (acentos/caixa) para
// nunca guardar "Rua das Flores" e "rua das flores" como entradas
// diferentes.
import { redis } from "./redis";

const RUAS_ZSET = "ruas:conhecidas";
const MAX_SUGESTOES = 8;
// Zera o "lixo" de digitação incompleta antes de gravar: nomes muito curtos
// não viram sugestão para outros clientes.
const MIN_LEN_PARA_SALVAR = 3;
const MAX_LEN = 120;

/** Normaliza para deduplicar (minúsculas, sem acento, espaços colapsados). */
export function normalizarRua(rua: string): string {
  return rua
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Grava o nome de uma rua na base global, SOMENTE deve ser chamado após
 * submissão válida de um pedido (nunca a cada tecla digitada). Best-effort:
 * qualquer falha aqui nunca pode impactar a confirmação do pedido — o
 * chamador deve envolver em try/catch e ignorar erros.
 */
export async function registrarRuaConhecida(ruaBruta: string): Promise<void> {
  const rua = ruaBruta.trim().replace(/\s+/g, " ").slice(0, MAX_LEN);
  const chave = normalizarRua(rua);
  if (chave.length < MIN_LEN_PARA_SALVAR) return;

  // Remove uma eventual variante de grafia/caixa já salva com a mesma
  // chave normalizada antes de gravar a atual, para não acumular
  // duplicatas ("Rua Dez" e "rua dez") ao longo do tempo.
  const existentes = await redis.zrange<string[]>(RUAS_ZSET, 0, -1);
  const duplicadas = (existentes || []).filter((m) => normalizarRua(m) === chave && m !== rua);
  if (duplicadas.length > 0) {
    await redis.zrem(RUAS_ZSET, ...duplicadas);
  }
  await redis.zadd(RUAS_ZSET, { score: Date.now(), member: rua });
}

/** Sugestões para autocomplete — mais usadas/recentes primeiro, filtradas por prefixo/substring. */
export async function sugerirRuas(query: string): Promise<string[]> {
  const termo = normalizarRua(query);
  if (!termo) return [];
  const todas = await redis.zrange<string[]>(RUAS_ZSET, 0, -1, { rev: true });
  const lista = todas || [];
  const porPrefixo = lista.filter((r) => normalizarRua(r).startsWith(termo));
  const porSubstring = lista.filter((r) => !normalizarRua(r).startsWith(termo) && normalizarRua(r).includes(termo));
  return [...porPrefixo, ...porSubstring].slice(0, MAX_SUGESTOES);
}
