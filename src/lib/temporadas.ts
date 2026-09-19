// Camada de Temporadas — janelas temporais de progresso (estrelas, indicações).
// Aprovado conceitualmente; duração e metas são definidas pelo admin ao criar.
// Estado: "rascunho" → "ativa" → "encerrada". Só uma temporada pode ser
// "ativa" por tenant ao mesmo tempo.
//
// Regras críticas (Manual Mestre):
// - Zerar progresso da temporada NÃO apaga direitos já conquistados.
// - Presentes desbloqueados permanecem na carteira.
// - Histórico da temporada anterior nunca é apagado.

import { redis } from "./redis";

export type EstadoTemporada = "rascunho" | "ativa" | "encerrada";

export type ConfigTemporada = {
  temporadaId: string;
  tenantId: string;
  nome?: string;
  estado: EstadoTemporada;
  criadaEm: string;
  ativadaEm?: string;
  encerradaEm?: string;
  metaCompras?: number;
  metaIndicacoes?: number;
};

function chaveTemporada(tenantId: string, temporadaId: string): string {
  return `temporada:config:${tenantId}:${temporadaId}`;
}
function chaveTemporadaAtiva(tenantId: string): string {
  return `temporada:ativa:${tenantId}`;
}
function chaveListaTemporadas(tenantId: string): string {
  return `temporada:lista:${tenantId}`;
}

export async function criarTemporada(
  tenantId: string,
  temporadaId: string,
  params: Partial<Pick<ConfigTemporada, "nome" | "metaCompras" | "metaIndicacoes">> = {}
): Promise<ConfigTemporada> {
  const existente = await obterTemporada(tenantId, temporadaId);
  // Temporada ativa ou encerrada é imutável — apenas atualiza campos opcionais de rascunho
  if (existente && existente.estado !== "rascunho") {
    return existente;
  }
  const config: ConfigTemporada = {
    temporadaId,
    tenantId,
    estado: "rascunho",
    criadaEm: existente?.criadaEm ?? new Date().toISOString(),
    ...params,
  };
  await redis.set(chaveTemporada(tenantId, temporadaId), config);
  const lista = (await redis.get<string[]>(chaveListaTemporadas(tenantId))) ?? [];
  if (!lista.includes(temporadaId)) {
    await redis.set(chaveListaTemporadas(tenantId), [...lista, temporadaId]);
  }
  return config;
}

export async function obterTemporada(tenantId: string, temporadaId: string): Promise<ConfigTemporada | null> {
  if (!tenantId || !temporadaId) return null;
  return redis.get<ConfigTemporada>(chaveTemporada(tenantId, temporadaId));
}

export async function obterTemporadaAtiva(tenantId: string): Promise<ConfigTemporada | null> {
  if (!tenantId) return null;
  const temporadaId = await redis.get<string>(chaveTemporadaAtiva(tenantId));
  if (!temporadaId) return null;
  return obterTemporada(tenantId, temporadaId);
}

export async function listarTemporadas(tenantId: string): Promise<ConfigTemporada[]> {
  if (!tenantId) return [];
  const lista = (await redis.get<string[]>(chaveListaTemporadas(tenantId))) ?? [];
  const configs = await Promise.all(lista.map((id) => obterTemporada(tenantId, id)));
  return configs.filter((c): c is ConfigTemporada => c !== null);
}

export type ResultadoTransicaoTemporada =
  | { ok: true; config: ConfigTemporada }
  | { ok: false; erro: string };

export async function ativarTemporada(
  tenantId: string,
  temporadaId: string
): Promise<ResultadoTransicaoTemporada> {
  if (!tenantId || !temporadaId) return { ok: false, erro: "parametros_invalidos" };
  const config = await obterTemporada(tenantId, temporadaId);
  if (!config) return { ok: false, erro: "temporada_nao_encontrada" };
  if (config.estado === "encerrada") return { ok: false, erro: "temporada_ja_encerrada" };
  if (config.estado === "ativa") return { ok: true, config };

  const ativaAtual = await obterTemporadaAtiva(tenantId);
  if (ativaAtual && ativaAtual.temporadaId !== temporadaId) {
    const encerrada: ConfigTemporada = {
      ...ativaAtual,
      estado: "encerrada",
      encerradaEm: new Date().toISOString(),
    };
    await redis.set(chaveTemporada(tenantId, ativaAtual.temporadaId), encerrada);
  }

  const nova: ConfigTemporada = { ...config, estado: "ativa", ativadaEm: new Date().toISOString() };
  await redis.set(chaveTemporada(tenantId, temporadaId), nova);
  await redis.set(chaveTemporadaAtiva(tenantId), temporadaId);
  return { ok: true, config: nova };
}

export async function encerrarTemporada(
  tenantId: string,
  temporadaId: string
): Promise<ResultadoTransicaoTemporada> {
  if (!tenantId || !temporadaId) return { ok: false, erro: "parametros_invalidos" };
  const config = await obterTemporada(tenantId, temporadaId);
  if (!config) return { ok: false, erro: "temporada_nao_encontrada" };
  if (config.estado === "encerrada") return { ok: true, config };

  const encerrada: ConfigTemporada = {
    ...config,
    estado: "encerrada",
    encerradaEm: new Date().toISOString(),
  };
  await redis.set(chaveTemporada(tenantId, temporadaId), encerrada);

  const ativaId = await redis.get<string>(chaveTemporadaAtiva(tenantId));
  if (ativaId === temporadaId) {
    await redis.del(chaveTemporadaAtiva(tenantId));
  }

  return { ok: true, config: encerrada };
}
