import type {
  EstadoComportamentalId,
  MomentoPesquisaId,
} from "./pesquisaPreferencia";
import { MOMENTOS_PESQUISA } from "./pesquisaPreferencia";
import type { MotivoSupressaoPesquisa } from "./pesquisaPreferenciaContato";

export type CanalPesquisa =
  | "whatsapp"
  | "app"
  | "painel_longitudinal"
  | "entrevista_moderada";

export type ResearchExposure = {
  exposureId: string;
  customerKey: string;
  momentId: MomentoPesquisaId;
  behaviorState: EstadoComportamentalId;
  triggerEventId: string | null;
  questionId: string;
  questionVersion: number;
  variantId: string;
  channel: CanalPesquisa;
  sentAtMs: number | null;
  answeredAtMs: number | null;
  skippedAtMs: number | null;
  suppressionReason: MotivoSupressaoPesquisa | null;
  experimentBucket: string | null;
};

export type ResearchResponse = {
  responseId: string;
  exposureId: string;
  rawAnswer: string;
  codedThemes: string[];
  otherFlag: boolean;
  researcherNote: string | null;
  confidenceTag: string | null;
  followUpEligible: boolean;
  createdAtMs: number;
};

export type ResearchContextSnapshot = {
  comprasAteOMomento: number;
  intervaloDesdeCompraAnteriorDias: number | null;
  canal: "app" | "whatsapp" | "salao" | "desconhecido";
  behaviorState: EstadoComportamentalId;
  faixaComportamento: string | null;
  estadoRecorrencia: string | null;
  contextoPedidoMinimo: Readonly<Record<string, string | number | boolean | null>>;
};

export type InstrumentoPesquisa = {
  questionId: string;
  version: number;
  momentId: MomentoPesquisaId;
  pergunta: string;
  objetivo: string;
  tipoResposta: "texto_livre";
  habilitadaParaEnvio: false;
};

/**
 * Registro versionado dos instrumentos já descritos na matriz aprovada.
 *
 * A versão é parte do contrato. Alterar o texto exige nova versão; este
 * módulo deliberadamente não possui qualquer função de envio ou persistência.
 */
export const INSTRUMENTOS_PESQUISA: readonly InstrumentoPesquisa[] =
  MOMENTOS_PESQUISA
    .filter((momento) => momento.perguntaPrincipal !== null)
    .map((momento) => ({
      questionId: `research-${momento.id.toLowerCase()}-main`,
      version: 1,
      momentId: momento.id,
      pergunta: momento.perguntaPrincipal as string,
      objetivo: momento.objetivo,
      tipoResposta: "texto_livre" as const,
      habilitadaParaEnvio: false as const,
    }));

export function obterInstrumentoPesquisa(
  momentId: MomentoPesquisaId
): InstrumentoPesquisa | null {
  return INSTRUMENTOS_PESQUISA.find((instrumento) => instrumento.momentId === momentId) ?? null;
}

const CAMPOS_PESSOAIS_PROIBIDOS = new Set([
  "telefone",
  "phone",
  "nome",
  "endereco",
  "address",
  "email",
  "cpf",
  "documento",
  "dadosPagamento",
  "paymentData",
]);

/**
 * Guarda de defesa para qualquer futura persistência do dataset analítico de
 * pesquisa. Não substitui pseudonimização na origem, mas impede que campos
 * pessoais óbvios entrem silenciosamente no contrato.
 */
export function possuiCampoPessoalProibido(valor: unknown): boolean {
  if (valor === null || typeof valor !== "object") return false;
  if (Array.isArray(valor)) return valor.some(possuiCampoPessoalProibido);

  for (const [chave, conteudo] of Object.entries(valor as Record<string, unknown>)) {
    if (CAMPOS_PESSOAIS_PROIBIDOS.has(chave)) return true;
    if (possuiCampoPessoalProibido(conteudo)) return true;
  }

  return false;
}
