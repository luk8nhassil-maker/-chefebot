import "server-only";

import { createHmac, randomUUID } from "crypto";
import { redis } from "./redis";

export const FINALIDADES_CONSENTIMENTO_RANKING = [
  "ranking_primeiro_nome",
  "ranking_telefone_mascarado",
  "ranking_foto_perfil",
] as const;

export type FinalidadeConsentimentoRanking = (typeof FINALIDADES_CONSENTIMENTO_RANKING)[number];
export type EstadoConsentimentoRanking = "concedido" | "revogado";

export type RegistroConsentimentoRanking = {
  eventoId: string;
  finalidade: FinalidadeConsentimentoRanking;
  estado: EstadoConsentimentoRanking;
  /** Versao do texto aprovado que foi exibido na concessao. Nulo em uma
   * revogacao sem concessao anterior. O texto em si nao e duplicado no log. */
  textoVersao: string | null;
  registradoEm: string;
  origem: "area_cliente_autenticada";
};

export type ConfiguracaoFinalidadeRanking = {
  finalidade: FinalidadeConsentimentoRanking;
  texto: string | null;
  textoVersao: string | null;
  disponivel: boolean;
  motivoIndisponivel: "texto_nao_aprovado" | "infraestrutura_nao_configurada" | "fonte_oficial_indisponivel" | null;
};

export type PreferenciaConsentimentoRanking = ConfiguracaoFinalidadeRanking & {
  estado: EstadoConsentimentoRanking;
  atualizadoEm: string | null;
};

export class ErroConsentimentoRanking extends Error {
  constructor(
    readonly codigo:
      | "finalidade_invalida"
      | "infraestrutura_nao_configurada"
      | "texto_nao_aprovado"
      | "versao_texto_desatualizada"
      | "fonte_oficial_indisponivel",
  ) {
    super(codigo);
    this.name = "ErroConsentimentoRanking";
  }
}

const ENV_TEXTO: Record<Exclude<FinalidadeConsentimentoRanking, "ranking_foto_perfil">, string> = {
  ranking_primeiro_nome: "RANKING_CONSENT_FIRST_NAME_TEXT",
  ranking_telefone_mascarado: "RANKING_CONSENT_MASKED_PHONE_TEXT",
};

const ENV_VERSAO: Record<Exclude<FinalidadeConsentimentoRanking, "ranking_foto_perfil">, string> = {
  ranking_primeiro_nome: "RANKING_CONSENT_FIRST_NAME_TEXT_VERSION",
  ranking_telefone_mascarado: "RANKING_CONSENT_MASKED_PHONE_TEXT_VERSION",
};

const SEGREDO_MINIMO_CARACTERES = 32;
const LIMITE_PAGINA_HISTORICO = 100;

function lerEnv(nome: string): string | null {
  const valor = process.env[nome]?.trim();
  return valor ? valor : null;
}

function segredoConsentimento(): string | null {
  const segredo = lerEnv("PRIVACY_CONSENT_HMAC_SECRET");
  return segredo && segredo.length >= SEGREDO_MINIMO_CARACTERES ? segredo : null;
}

function referenciaTitular(clienteId: string): string | null {
  const segredo = segredoConsentimento();
  if (!segredo || !clienteId) return null;
  return createHmac("sha256", segredo).update(clienteId).digest("hex");
}

function chaveEstado(referencia: string, finalidade: FinalidadeConsentimentoRanking): string {
  return `privacidade:ranking:estado:${referencia}:${finalidade}`;
}

function chaveHistorico(referencia: string): string {
  return `privacidade:ranking:historico:${referencia}`;
}

function finalidadeValida(valor: unknown): valor is FinalidadeConsentimentoRanking {
  return typeof valor === "string" && (FINALIDADES_CONSENTIMENTO_RANKING as readonly string[]).includes(valor);
}

function registroValido(valor: unknown, finalidade?: FinalidadeConsentimentoRanking): valor is RegistroConsentimentoRanking {
  if (!valor || typeof valor !== "object") return false;
  const registro = valor as Partial<RegistroConsentimentoRanking>;
  return (
    typeof registro.eventoId === "string" &&
    finalidadeValida(registro.finalidade) &&
    (!finalidade || registro.finalidade === finalidade) &&
    (registro.estado === "concedido" || registro.estado === "revogado") &&
    (registro.textoVersao === null || typeof registro.textoVersao === "string") &&
    typeof registro.registradoEm === "string" &&
    registro.origem === "area_cliente_autenticada"
  );
}

export function configuracaoFinalidadeRanking(finalidade: FinalidadeConsentimentoRanking): ConfiguracaoFinalidadeRanking {
  if (finalidade === "ranking_foto_perfil") {
    // Nenhum adaptador de fonte oficial/autorizada existe no projeto atual.
    // Mesmo que uma variavel seja criada por engano, esta finalidade segue
    // bloqueada ate uma integracao de provedor ser implementada e revisada.
    return {
      finalidade,
      texto: null,
      textoVersao: null,
      disponivel: false,
      motivoIndisponivel: "fonte_oficial_indisponivel",
    };
  }

  const texto = lerEnv(ENV_TEXTO[finalidade]);
  const textoVersao = lerEnv(ENV_VERSAO[finalidade]);
  if (!segredoConsentimento()) {
    return { finalidade, texto, textoVersao, disponivel: false, motivoIndisponivel: "infraestrutura_nao_configurada" };
  }
  if (!texto || !textoVersao) {
    return { finalidade, texto, textoVersao, disponivel: false, motivoIndisponivel: "texto_nao_aprovado" };
  }
  return { finalidade, texto, textoVersao, disponivel: true, motivoIndisponivel: null };
}

function configuracoesRanking(): ConfiguracaoFinalidadeRanking[] {
  return FINALIDADES_CONSENTIMENTO_RANKING.map(configuracaoFinalidadeRanking);
}

async function obterRegistrosAtuaisParaClientes(
  clienteIds: string[],
): Promise<Map<string, Map<FinalidadeConsentimentoRanking, RegistroConsentimentoRanking>>> {
  const pares = Array.from(new Set(clienteIds.filter(Boolean)))
    .map((clienteId) => ({ clienteId, referencia: referenciaTitular(clienteId) }))
    .filter((item): item is { clienteId: string; referencia: string } => !!item.referencia);
  const resultado = new Map<string, Map<FinalidadeConsentimentoRanking, RegistroConsentimentoRanking>>();
  for (const { clienteId } of pares) resultado.set(clienteId, new Map());
  if (pares.length === 0) return resultado;

  const consultas = pares.flatMap(({ clienteId, referencia }) =>
    FINALIDADES_CONSENTIMENTO_RANKING.map((finalidade) => ({ clienteId, finalidade, chave: chaveEstado(referencia, finalidade) })),
  );
  const valores = await redis.mget<Array<RegistroConsentimentoRanking | null>>(...consultas.map((item) => item.chave));
  consultas.forEach(({ clienteId, finalidade }, index) => {
    const valor = valores[index];
    if (registroValido(valor, finalidade)) resultado.get(clienteId)?.set(finalidade, valor);
  });
  return resultado;
}

async function obterRegistrosAtuais(clienteId: string): Promise<Map<FinalidadeConsentimentoRanking, RegistroConsentimentoRanking>> {
  return (await obterRegistrosAtuaisParaClientes([clienteId])).get(clienteId) ?? new Map();
}

export async function obterPreferenciasConsentimentoRanking(clienteId: string): Promise<PreferenciaConsentimentoRanking[]> {
  const registros = await obterRegistrosAtuais(clienteId);
  return configuracoesRanking().map((config) => {
    const registro = registros.get(config.finalidade);
    return {
      ...config,
      estado: registro?.estado ?? "revogado",
      atualizadoEm: registro?.registradoEm ?? null,
    };
  });
}

/** Um consentimento so autoriza exposicao quando continua concedido, a
 * finalidade esta operacionalmente disponivel e a versao ainda coincide com
 * o texto aprovado atual. Mudanca de versao portanto volta a anonimizar. */
export async function obterFinalidadesAtivasRanking(clienteId: string): Promise<Set<FinalidadeConsentimentoRanking>> {
  return (await obterFinalidadesAtivasRankingParaClientes([clienteId])).get(clienteId) ?? new Set();
}

export async function obterFinalidadesAtivasRankingParaClientes(
  clienteIds: string[],
): Promise<Map<string, Set<FinalidadeConsentimentoRanking>>> {
  const registrosPorCliente = await obterRegistrosAtuaisParaClientes(clienteIds);
  const configs = configuracoesRanking();
  const resultado = new Map<string, Set<FinalidadeConsentimentoRanking>>();
  for (const clienteId of Array.from(new Set(clienteIds.filter(Boolean)))) {
    const registros = registrosPorCliente.get(clienteId) ?? new Map();
    const ativas = new Set<FinalidadeConsentimentoRanking>();
    for (const config of configs) {
      const registro = registros.get(config.finalidade);
      if (
        config.disponivel &&
        registro?.estado === "concedido" &&
        registro.textoVersao === config.textoVersao
      ) {
        ativas.add(config.finalidade);
      }
    }
    resultado.set(clienteId, ativas);
  }
  return resultado;
}

function exigirReferencia(clienteId: string): string {
  const referencia = referenciaTitular(clienteId);
  if (!referencia) throw new ErroConsentimentoRanking("infraestrutura_nao_configurada");
  return referencia;
}

function criarRegistro(
  finalidade: FinalidadeConsentimentoRanking,
  estado: EstadoConsentimentoRanking,
  textoVersao: string | null,
  registradoEm = new Date().toISOString(),
): RegistroConsentimentoRanking {
  return {
    eventoId: randomUUID(),
    finalidade,
    estado,
    textoVersao,
    registradoEm,
    origem: "area_cliente_autenticada",
  };
}

async function persistirRegistrosAtomicos(
  referencia: string,
  registros: RegistroConsentimentoRanking[],
): Promise<void> {
  const transacao = redis.multi();
  for (const registro of registros) {
    transacao.set(chaveEstado(referencia, registro.finalidade), registro);
    transacao.lpush(chaveHistorico(referencia), JSON.stringify(registro));
  }
  await transacao.exec();
}

export async function registrarConsentimentoRanking(params: {
  clienteId: string;
  finalidade: unknown;
  estado: EstadoConsentimentoRanking;
  textoVersaoInformada?: unknown;
}): Promise<RegistroConsentimentoRanking> {
  if (!finalidadeValida(params.finalidade)) throw new ErroConsentimentoRanking("finalidade_invalida");
  const referencia = exigirReferencia(params.clienteId);
  const finalidade = params.finalidade;
  const config = configuracaoFinalidadeRanking(finalidade);
  const atuais = await obterRegistrosAtuais(params.clienteId);

  let textoVersao: string | null = atuais.get(finalidade)?.textoVersao ?? config.textoVersao;
  if (params.estado === "concedido") {
    if (finalidade === "ranking_foto_perfil") throw new ErroConsentimentoRanking("fonte_oficial_indisponivel");
    if (config.motivoIndisponivel === "infraestrutura_nao_configurada") {
      throw new ErroConsentimentoRanking("infraestrutura_nao_configurada");
    }
    if (!config.disponivel || !config.textoVersao) throw new ErroConsentimentoRanking("texto_nao_aprovado");
    if (params.textoVersaoInformada !== config.textoVersao) {
      throw new ErroConsentimentoRanking("versao_texto_desatualizada");
    }
    textoVersao = config.textoVersao;
  }

  const registro = criarRegistro(finalidade, params.estado, textoVersao ?? null);
  await persistirRegistrosAtomicos(referencia, [registro]);
  return registro;
}

export async function revogarTodosConsentimentosRanking(clienteId: string): Promise<RegistroConsentimentoRanking[]> {
  const referencia = exigirReferencia(clienteId);
  const atuais = await obterRegistrosAtuais(clienteId);
  const agora = new Date().toISOString();
  const registros = FINALIDADES_CONSENTIMENTO_RANKING.map((finalidade) =>
    criarRegistro(finalidade, "revogado", atuais.get(finalidade)?.textoVersao ?? null, agora),
  );
  await persistirRegistrosAtomicos(referencia, registros);
  return registros;
}

export async function obterHistoricoConsentimentoRanking(
  clienteId: string,
  offset = 0,
  limite = 50,
): Promise<{ eventos: RegistroConsentimentoRanking[]; proximoOffset: number | null }> {
  const referencia = exigirReferencia(clienteId);
  const inicio = Math.max(0, Math.trunc(offset));
  const tamanho = Math.min(Math.max(1, Math.trunc(limite)), LIMITE_PAGINA_HISTORICO);
  const itens = await redis.lrange<string>(chaveHistorico(referencia), inicio, inicio + tamanho);
  const eventos: RegistroConsentimentoRanking[] = [];
  for (const item of itens.slice(0, tamanho)) {
    try {
      const valor = JSON.parse(item) as unknown;
      if (registroValido(valor)) eventos.push(valor);
    } catch {}
  }
  return { eventos, proximoOffset: itens.length > tamanho ? inicio + tamanho : null };
}
