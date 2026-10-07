import "server-only";

import { createHmac, randomUUID } from "crypto";
import { redis } from "./redis";

export const FINALIDADES_CONSENTIMENTO_RANKING = [
  "ranking_primeiro_nome",
  "ranking_nome_completo",
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
  /** Vincula a autorização à entrada atual no jogo; impede que um PATCH
   * atrasado reexponha identidade depois de sair e entrar de novo. */
  participacaoEventoId?: string;
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
      | "participacao_inativa"
      | "fonte_oficial_indisponivel",
  ) {
    super(codigo);
    this.name = "ErroConsentimentoRanking";
  }
}

const ENV_TEXTO: Record<Exclude<FinalidadeConsentimentoRanking, "ranking_foto_perfil" | "ranking_nome_completo">, string> = {
  ranking_primeiro_nome: "RANKING_CONSENT_FIRST_NAME_TEXT",
  ranking_telefone_mascarado: "RANKING_CONSENT_MASKED_PHONE_TEXT",
};

const ENV_VERSAO: Record<Exclude<FinalidadeConsentimentoRanking, "ranking_foto_perfil" | "ranking_nome_completo">, string> = {
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

function chaveParticipacao(referencia: string): string {
  return `privacidade:ranking:participacao:${referencia}`;
}

function chaveHistoricoParticipacao(referencia: string): string {
  return `privacidade:ranking:participacao:historico:${referencia}`;
}

export type RegistroParticipacao = {
  ativo: boolean;
  eventoId: string;
  registradoEm: string;
  origem: "area_cliente_autenticada";
  versao: "ranking-participacao-v1" | "ranking-participacao-v2";
  aceitaRevelacao30d?: boolean;
  regraJogoVersao?: "ranking-jogo-secreto-v1";
};

function participacaoValida(valor: unknown): valor is RegistroParticipacao {
  if (!valor || typeof valor !== "object") return false;
  const item = valor as Partial<RegistroParticipacao>;
  return typeof item.ativo === "boolean" && typeof item.eventoId === "string" &&
    typeof item.registradoEm === "string" && item.origem === "area_cliente_autenticada" &&
    (item.versao === "ranking-participacao-v1" || item.versao === "ranking-participacao-v2");
}

function registroParticipacao(
  ativo: boolean,
  eventoId: string = randomUUID(),
  aceitaRevelacao30d = false,
): RegistroParticipacao {
  return {
    ativo,
    eventoId,
    registradoEm: new Date().toISOString(),
    origem: "area_cliente_autenticada",
    versao: "ranking-participacao-v2",
    aceitaRevelacao30d,
    regraJogoVersao: aceitaRevelacao30d ? "ranking-jogo-secreto-v1" : undefined,
  };
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
    && (registro.participacaoEventoId === undefined || typeof registro.participacaoEventoId === "string")
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

  if (finalidade === "ranking_nome_completo") {
    if (!segredoConsentimento()) {
      return {
        finalidade,
        texto: "Mostrar meu nome completo no Ranking durante a temporada.",
        textoVersao: "ranking-nome-completo-v1",
        disponivel: false,
        motivoIndisponivel: "infraestrutura_nao_configurada",
      };
    }
    return {
      finalidade,
      texto: "Mostrar meu nome completo no Ranking durante a temporada.",
      textoVersao: "ranking-nome-completo-v1",
      disponivel: true,
      motivoIndisponivel: null,
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
  const unicos = Array.from(new Set(clienteIds.filter(Boolean)));
  const [registrosPorCliente, participacoes] = await Promise.all([
    obterRegistrosAtuaisParaClientes(unicos),
    unicos.length && segredoConsentimento()
      ? redis.mget<Array<RegistroParticipacao | null>>(...unicos.map((id) => chaveParticipacao(exigirReferencia(id))))
      : Promise.resolve(unicos.map(() => null)),
  ]);
  const configs = configuracoesRanking();
  const resultado = new Map<string, Set<FinalidadeConsentimentoRanking>>();
  for (const [index, clienteId] of unicos.entries()) {
    const registros = registrosPorCliente.get(clienteId) ?? new Map();
    const estado = participacoes[index];
    const ativas = new Set<FinalidadeConsentimentoRanking>();
    for (const config of configs) {
      const registro = registros.get(config.finalidade);
      if (
        config.disponivel &&
        registro?.estado === "concedido" &&
        registro.textoVersao === config.textoVersao &&
        (estado === null || (participacaoValida(estado) && estado.ativo && registro.participacaoEventoId === estado.eventoId))
      ) {
        ativas.add(config.finalidade);
      }
    }
    resultado.set(clienteId, ativas);
  }
  return resultado;
}

/** Estado explícito prevalece. Ausência preserva a participação dos clientes
 * que já tinham concedido identidade antes desta separação. Novos clientes
 * entram anonimamente pelo botão de ativação, sem consentimento implícito. */
export async function obterParticipacaoRankingParaClientes(
  clienteIds: string[],
  finalidadesPorCliente?: Map<string, Set<FinalidadeConsentimentoRanking>>,
): Promise<Map<string, boolean>> {
  const unicos = Array.from(new Set(clienteIds.filter(Boolean)));
  const referencias = unicos.map((clienteId) => exigirReferencia(clienteId));
  if (unicos.length === 0) return new Map();
  const [valores, finalidades] = await Promise.all([
    redis.mget<Array<RegistroParticipacao | null>>(...referencias.map(chaveParticipacao)),
    finalidadesPorCliente ? Promise.resolve(finalidadesPorCliente) : obterFinalidadesAtivasRankingParaClientes(unicos),
  ]);
  return new Map(unicos.map((id, i) => {
    const valor = valores[i];
    // Fallback apenas para chave ausente (cliente legado). Registro presente
    // mas corrompido nunca pode reativar alguém que havia saído.
    const ativo = participacaoValida(valor) ? valor.ativo
      : valor === null ? !!(finalidades.get(id)?.has("ranking_primeiro_nome") || finalidades.get(id)?.has("ranking_nome_completo") || finalidades.get(id)?.has("ranking_telefone_mascarado"))
        : false;
    return [id, ativo];
  }));
}

export async function obterParticipacaoRanking(clienteId: string): Promise<boolean> {
  return (await obterParticipacaoRankingParaClientes([clienteId])).get(clienteId) ?? false;
}

export async function obterRegraJogoSecretoRanking(clienteId: string): Promise<{
  participa: boolean;
  aceitaRevelacao30d: boolean;
  regraJogoVersao: string | null;
}> {
  const referencia = exigirReferencia(clienteId);
  const valor = await redis.get<RegistroParticipacao>(chaveParticipacao(referencia));
  if (!participacaoValida(valor)) {
    return { participa: false, aceitaRevelacao30d: false, regraJogoVersao: null };
  }
  return {
    participa: valor.ativo,
    aceitaRevelacao30d: valor.ativo && valor.aceitaRevelacao30d === true,
    regraJogoVersao: valor.regraJogoVersao ?? null,
  };
}

export async function obterRegrasJogoSecretoParaClientes(
  clienteIds: string[],
): Promise<Map<string, { participa: boolean; aceitaRevelacao30d: boolean }>> {
  const unicos = Array.from(new Set(clienteIds.filter(Boolean)));
  if (unicos.length === 0) return new Map();
  const referencias = unicos.map((id) => exigirReferencia(id));
  const valores = await redis.mget<Array<RegistroParticipacao | null>>(...referencias.map(chaveParticipacao));
  return new Map(unicos.map((id, index) => {
    const valor = valores[index];
    return [id, {
      participa: participacaoValida(valor) ? valor.ativo : false,
      aceitaRevelacao30d: participacaoValida(valor) && valor.ativo && valor.aceitaRevelacao30d === true,
    }];
  }));
}

export async function registrarParticipacaoRanking(
  clienteId: string,
  ativo: boolean,
  opcoes: { aceitaRevelacao30d?: boolean } = {},
): Promise<void> {
  const referencia = exigirReferencia(clienteId);
  const anterior = await redis.get<RegistroParticipacao>(chaveParticipacao(referencia));
  const aceitaRevelacao30d = opcoes.aceitaRevelacao30d === true;

  if (
    ativo &&
    participacaoValida(anterior) &&
    anterior.ativo &&
    anterior.aceitaRevelacao30d === aceitaRevelacao30d
  ) return;

  // Retries/concessões concorrentes da mesma entrada compartilham a época.
  // Sair gera outra época, invalidando concessões atrasadas da entrada antiga.
  const registro = registroParticipacao(
    ativo,
    ativo ? (participacaoValida(anterior) ? anterior.eventoId : "primeira-entrada") : randomUUID(),
    ativo ? aceitaRevelacao30d : false,
  );
  await redis.multi()
    .set(chaveParticipacao(referencia), registro)
    .lpush(chaveHistoricoParticipacao(referencia), JSON.stringify(registro))
    .exec();
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
  participacaoEventoId?: string,
): RegistroConsentimentoRanking {
  return {
    eventoId: randomUUID(),
    finalidade,
    estado,
    textoVersao,
    registradoEm,
    origem: "area_cliente_autenticada",
    ...(participacaoEventoId ? { participacaoEventoId } : {}),
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

  const participacao = await redis.get<RegistroParticipacao>(chaveParticipacao(referencia));
  if (params.estado === "concedido" && participacao !== null && (!participacaoValida(participacao) || !participacao.ativo)) {
    throw new ErroConsentimentoRanking("participacao_inativa");
  }
  const registro = criarRegistro(finalidade, params.estado, textoVersao ?? null, new Date().toISOString(),
    participacaoValida(participacao) ? participacao.eventoId : undefined);
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
  // Sair do jogo e remover a exposição pública são uma única transação.
  const participacao = registroParticipacao(false);
  const transacao = redis.multi();
  transacao.set(chaveParticipacao(referencia), participacao);
  transacao.lpush(chaveHistoricoParticipacao(referencia), JSON.stringify(participacao));
  for (const registro of registros) {
    transacao.set(chaveEstado(referencia, registro.finalidade), registro);
    transacao.lpush(chaveHistorico(referencia), JSON.stringify(registro));
  }
  await transacao.exec();
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
