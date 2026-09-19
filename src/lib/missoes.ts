// Motor de Missões / Próxima Melhor Ação — função pura que traduz o estado
// atual do cliente em UMA ação clara e prioritária.
//
// Regra de segurança (Manual Mestre): missão NÃO cria pontos; os pontos
// só entram quando o evento real é validado pelo servidor. Aqui só texto/tipo.
//
// Prioridade (Manual Mestre, Decisão de Produto — Motor de Missões, 18/09/2026):
// 1. presente disponível para uso
// 2. presente quase conquistado
// 3. nível quase liberado
// 4. indicação nova como melhor caminho de avanço
// 5. risco de inatividade
// 6. sabor / coleção
// 7. ranking
// 8. descoberta de benefício ainda pouco usado (não implementado — aguarda regra)
//
// Limiares operacionais (prioridades 2, 5, 7) NÃO estão definidos no Manual Mestre.
// A função é fail-closed: essas missões só disparam se o chamador passar
// os limiares explicitamente via ConfigMissoes.

export type TipoMissao =
  | "presente_disponivel"
  | "presente_quase_conquistado"
  | "nivel_quase_liberado"
  | "indicar_amigo"
  | "risco_inatividade"
  | "desbloquear_sabor"
  | "subir_ranking";

export type MissaoAtual = {
  tipo: TipoMissao;
  mensagem: string;
};

export type EstadoClienteMissao = {
  presentesDisponiveis: number;
  estrelasAtivas: boolean;
  saldoEstrelas: number;
  metaEstrelas: number;
  temIndicacoesPendentes?: boolean;
  diasDesdeUltimaCompra?: number;
  posicaoRanking?: number;
  totalNoRanking?: number;
};

/**
 * Limiares operacionais para missões que dependem de regras comerciais.
 * PENDENTES de aprovação (Manual Mestre, seção Motor de Missões).
 * Sem estes valores, as missões correspondentes não disparam (fail-closed).
 */
export type ConfigMissoes = {
  /** Fração da meta de estrelas a partir da qual considerar "quase conquistado". Ex: 0.80 */
  limiarQuaseConquistado?: number;
  /** Dias desde a última compra a partir dos quais emitir alerta de inatividade. Ex: 30 */
  limiarInativiaDias?: number;
  /** Posição do Top a ser atingido. Ex: 5 para Top 5 */
  limiarProximoTop?: number;
  /** Quantas posições acima do limiarProximoTop ainda são consideradas "perto". Ex: 5 */
  limiarRangeTop?: number;
};

export function calcularMissaoAtual(
  estado: EstadoClienteMissao,
  config?: ConfigMissoes,
): MissaoAtual | null {
  if (!estado) return null;

  // 1. Presente disponível
  if (estado.presentesDisponiveis > 0) {
    const qtd = estado.presentesDisponiveis;
    return {
      tipo: "presente_disponivel",
      mensagem: qtd === 1
        ? "Você tem um presente disponível! Use no seu próximo pedido."
        : `Você tem ${qtd} presentes disponíveis! Use no seu próximo pedido.`,
    };
  }

  // 2. Presente quase conquistado — requer limiar aprovado comercialmente
  if (
    estado.estrelasAtivas &&
    estado.metaEstrelas > 0 &&
    typeof config?.limiarQuaseConquistado === "number"
  ) {
    const progresso = estado.saldoEstrelas / estado.metaEstrelas;
    if (progresso >= config.limiarQuaseConquistado && progresso < 1) {
      const faltam = Math.max(1, estado.metaEstrelas - estado.saldoEstrelas);
      return {
        tipo: "presente_quase_conquistado",
        mensagem: faltam === 1
          ? "Falta 1 Estrela para conquistar seu próximo presente!"
          : `Faltam ${faltam} Estrelas para seu próximo presente.`,
      };
    }
  }

  // 3. Nível quase liberado — placeholder até nível ser implementado
  // (sem regra comercial: só quando há estado de nível concreto)

  // 4. Indicação nova como melhor caminho
  if (estado.temIndicacoesPendentes) {
    return {
      tipo: "indicar_amigo",
      mensagem: "Indique 1 amigo novo e avance mais rápido.",
    };
  }

  // 5. Risco de inatividade — requer limiar aprovado comercialmente
  if (
    typeof estado.diasDesdeUltimaCompra === "number" &&
    typeof config?.limiarInativiaDias === "number" &&
    estado.diasDesdeUltimaCompra >= config.limiarInativiaDias
  ) {
    return {
      tipo: "risco_inatividade",
      mensagem: "Continue ativo para manter sua vantagem.",
    };
  }

  // 6. Sabor / coleção — sem regra comercial definida, não exibir por ora

  // 7. Ranking — requer limiares aprovados comercialmente
  if (
    typeof estado.posicaoRanking === "number" &&
    typeof estado.totalNoRanking === "number" &&
    typeof config?.limiarProximoTop === "number" &&
    typeof config?.limiarRangeTop === "number"
  ) {
    const top = config.limiarProximoTop;
    const range = config.limiarRangeTop;
    if (estado.posicaoRanking > top && estado.posicaoRanking <= top + range) {
      return {
        tipo: "subir_ranking",
        mensagem: `Você está perto do Top ${top}. Faça mais pedidos para avançar.`,
      };
    }
  }

  // Sem missão identificada
  return null;
}
