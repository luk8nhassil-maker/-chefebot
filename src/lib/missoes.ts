// Motor de Missões / Próxima Melhor Ação — função pura que traduz o estado
// atual do cliente em UMA ação clara e prioritária.
//
// Regra de segurança (Manual Mestre): missão NÃO cria pontos; os pontos
// só entram quando o evento real é validado pelo servidor. Aqui só texto/tipo.
//
// Prioridade (Manual Mestre, seção Camada 4):
// 1. presente disponível para uso
// 2. presente quase conquistado
// 3. nível quase liberado
// 4. indicação nova como melhor caminho de avanço
// 5. risco de inatividade
// 6. sabor / coleção
// 7. ranking

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

const LIMIAR_QUASE_CONQUISTADO = 0.80;
const LIMIAR_INATIVIDADE_DIAS = 30;
const LIMIAR_PROXIMO_TOP5 = 5;

export function calcularMissaoAtual(estado: EstadoClienteMissao): MissaoAtual | null {
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

  // 2. Presente quase conquistado
  if (estado.estrelasAtivas && estado.metaEstrelas > 0) {
    const progresso = estado.saldoEstrelas / estado.metaEstrelas;
    if (progresso >= LIMIAR_QUASE_CONQUISTADO && progresso < 1) {
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
  // (sem comercial: só quando há estado de nível concreto)

  // 4. Indicação nova como melhor caminho
  if (estado.temIndicacoesPendentes) {
    return {
      tipo: "indicar_amigo",
      mensagem: "Indique 1 amigo novo e avance mais rápido.",
    };
  }

  // 5. Risco de inatividade
  if (
    typeof estado.diasDesdeUltimaCompra === "number" &&
    estado.diasDesdeUltimaCompra >= LIMIAR_INATIVIDADE_DIAS
  ) {
    return {
      tipo: "risco_inatividade",
      mensagem: "Continue ativo para manter sua vantagem.",
    };
  }

  // 6. Sabor / coleção — sem regra comercial definida, não exibir por ora

  // 7. Ranking
  if (
    typeof estado.posicaoRanking === "number" &&
    typeof estado.totalNoRanking === "number" &&
    estado.posicaoRanking > LIMIAR_PROXIMO_TOP5 &&
    estado.posicaoRanking <= LIMIAR_PROXIMO_TOP5 + 5
  ) {
    return {
      tipo: "subir_ranking",
      mensagem: "Você está perto do Top 5. Faça mais pedidos para avançar.",
    };
  }

  // Sem missão identificada
  return null;
}
