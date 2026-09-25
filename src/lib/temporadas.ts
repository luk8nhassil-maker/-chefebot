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
  duracaoDias?: number;
  fimEm?: string;
  // Prêmio da TEMPORADA (ranking), distinto do presente por meta individual
  // (ConfigFidelidadePontos.descricaoRecompensa). Nada aqui tem default
  // inventado: sem premioAprovado === true e premioQuantidadePremiados > 0
  // definidos pelo admin nesta temporada, o encerramento nunca declara
  // vencedor — só arquiva o resultado do ranking (fail-closed).
  premioDescricao?: string;
  premioQuantidadePremiados?: number;
  premioAprovado?: boolean;
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

// Retorna true se a temporada ativa expirou pelo campo fimEm.
// agora permite injeção de data em testes.
export function temporadaExpirada(config: ConfigTemporada, agora?: Date): boolean {
  if (!config.fimEm) return false;
  const ref = agora ?? new Date();
  return ref.getTime() > new Date(config.fimEm).getTime();
}

export async function criarTemporada(
  tenantId: string,
  temporadaId: string,
  params: Partial<Pick<
    ConfigTemporada,
    "nome" | "metaCompras" | "metaIndicacoes" | "duracaoDias" | "premioDescricao" | "premioQuantidadePremiados" | "premioAprovado"
  >> = {}
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
  const config = await obterTemporada(tenantId, temporadaId);
  if (!config) return null;
  // Auto-expiry server-side: sem cron, verifica no momento da leitura
  if (config.estado === "ativa" && temporadaExpirada(config)) {
    const encerrada: ConfigTemporada = {
      ...config,
      estado: "encerrada",
      encerradaEm: new Date().toISOString(),
    };
    await redis.set(chaveTemporada(tenantId, temporadaId), encerrada);
    await redis.del(chaveTemporadaAtiva(tenantId));
    return null;
  }
  return config;
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

  const ativadaEm = new Date().toISOString();
  const fimEm = config.duracaoDias
    ? new Date(new Date(ativadaEm).getTime() + config.duracaoDias * 86400000).toISOString()
    : config.fimEm;
  const nova: ConfigTemporada = { ...config, estado: "ativa", ativadaEm, fimEm };
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
