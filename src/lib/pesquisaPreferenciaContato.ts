import type { MomentoPesquisaId } from "./pesquisaPreferencia";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export const POLITICA_CONTATO_PESQUISA = {
  cooldownDias: 14,
  maxContatosEm90Dias: 3,
  janelaOrcamentoDias: 90,
} as const;

export type MotivoSupressaoPesquisa =
  | "fontes_operacionais_incompletas"
  | "checkout_em_andamento"
  | "pagamento_pendente"
  | "pedido_em_producao_ou_entrega"
  | "problema_aberto"
  | "disputa_ou_estorno_aberto"
  | "opt_out"
  | "identidade_incerta"
  | "falha_tecnica"
  | "pergunta_identica_respondida_recentemente"
  | "cooldown_14_dias"
  | "limite_3_contatos_90_dias";

export type ContextoSupressaoPesquisa = {
  fontesOperacionaisCompletas: boolean;
  checkoutEmAndamento?: boolean;
  pagamentoPendente?: boolean;
  pedidoEmProducaoOuEntrega?: boolean;
  problemaAberto?: boolean;
  disputaOuEstornoAberto?: boolean;
  optOut?: boolean;
  identidadeIncerta?: boolean;
  falhaTecnica?: boolean;
  perguntaIdenticaRespondidaRecentemente?: boolean;
};

export type ContatoPesquisaRegistrado = {
  momentId: MomentoPesquisaId;
  questionId: string;
  sentAtMs: number;
  answeredAtMs?: number | null;
};

export type ResultadoElegibilidadeContatoPesquisa = {
  status: "elegivel" | "suprimido";
  motivos: MotivoSupressaoPesquisa[];
  contatosUltimos14Dias: number;
  contatosUltimos90Dias: number;
};

function dentroDaJanela(timestamp: number, agoraMs: number, dias: number): boolean {
  const inicio = agoraMs - dias * MS_POR_DIA;
  return timestamp > inicio && timestamp <= agoraMs;
}

/**
 * Gate puro de contato.
 *
 * Não envia mensagem, não grava nada e não lê Redis. O chamador precisa
 * fornecer explicitamente todos os sinais operacionais. Se esses sinais ainda
 * não estiverem conectados, o resultado é suprimido por segurança.
 */
export function avaliarElegibilidadeContatoPesquisa(params: {
  agoraMs: number;
  contexto: ContextoSupressaoPesquisa;
  historicoContatos: readonly Pick<ContatoPesquisaRegistrado, "sentAtMs">[];
}): ResultadoElegibilidadeContatoPesquisa {
  const { agoraMs, contexto, historicoContatos } = params;
  const motivos: MotivoSupressaoPesquisa[] = [];

  if (!contexto.fontesOperacionaisCompletas) motivos.push("fontes_operacionais_incompletas");
  if (contexto.checkoutEmAndamento) motivos.push("checkout_em_andamento");
  if (contexto.pagamentoPendente) motivos.push("pagamento_pendente");
  if (contexto.pedidoEmProducaoOuEntrega) motivos.push("pedido_em_producao_ou_entrega");
  if (contexto.problemaAberto) motivos.push("problema_aberto");
  if (contexto.disputaOuEstornoAberto) motivos.push("disputa_ou_estorno_aberto");
  if (contexto.optOut) motivos.push("opt_out");
  if (contexto.identidadeIncerta) motivos.push("identidade_incerta");
  if (contexto.falhaTecnica) motivos.push("falha_tecnica");
  if (contexto.perguntaIdenticaRespondidaRecentemente) {
    motivos.push("pergunta_identica_respondida_recentemente");
  }

  const contatosUltimos14Dias = historicoContatos.filter((contato) =>
    dentroDaJanela(contato.sentAtMs, agoraMs, POLITICA_CONTATO_PESQUISA.cooldownDias)
  ).length;
  const contatosUltimos90Dias = historicoContatos.filter((contato) =>
    dentroDaJanela(contato.sentAtMs, agoraMs, POLITICA_CONTATO_PESQUISA.janelaOrcamentoDias)
  ).length;

  if (contatosUltimos14Dias > 0) motivos.push("cooldown_14_dias");
  if (contatosUltimos90Dias >= POLITICA_CONTATO_PESQUISA.maxContatosEm90Dias) {
    motivos.push("limite_3_contatos_90_dias");
  }

  return {
    status: motivos.length === 0 ? "elegivel" : "suprimido",
    motivos: [...new Set(motivos)],
    contatosUltimos14Dias,
    contatosUltimos90Dias,
  };
}

export function resumoSegurancaContatoDryRun() {
  return {
    envioAutomaticoAtivo: false as const,
    elegibilidadeFinalCalculada: false as const,
    candidatosComportamentaisNaoSaoElegiveisFinais: true as const,
    motivo:
      "O histórico prospectivo de exposições já está conectado ao gate, mas os sinais operacionais e opt-out ainda não estão completos; por segurança nenhum candidato é tratado como elegível final.",
    politica: {
      cooldownDias: POLITICA_CONTATO_PESQUISA.cooldownDias,
      maxContatosEm90Dias: POLITICA_CONTATO_PESQUISA.maxContatosEm90Dias,
    },
    fontesConectadas: [
      "historico_de_exposicoes_de_pesquisa",
    ],
    fontesPendentes: [
      "estado_operacional_do_pedido",
      "pagamento_ou_pix_pendente",
      "problema_ou_disputa_aberta",
      "opt_out",
      "identidade_confirmada",
    ],
  };
}
