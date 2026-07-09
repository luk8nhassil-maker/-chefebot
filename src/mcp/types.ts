export type McpMode = 'observador' | 'copiloto' | 'automatico';

export type PadraoObservado =
  | 'avanco_normal'
  | 'interpretacao_ok'
  | 'confusao_simples'
  | 'confusao_com_escalacao'
  | 'escalacao_direta'
  | 'sem_mudanca'
  | 'desconhecido';

// Payload da fila Redis (mcp:fila:eventos).
// Contém exclusivamente metadados estruturais — sem telefone cru, mensagem,
// nome, endereço, bairro, valor monetário ou itens do carrinho.
export interface McpEventoFila {
  phoneHash: string;       // anonimizarConversaId(phone) — ex: "***4821"
  msgId: string;           // ID da mensagem Evolution API (idempotência no cron)

  stepAntes: string;
  stepDepois: string;
  houveMudancaStep: boolean;

  cartLength: number;
  deliveryType?: 'delivery' | 'pickup' | 'dine_in';

  precisouIA: boolean;        // interpretarMensagem() foi chamado
  escalou: boolean;           // result.escalar === true
  foiFallbackSeco: boolean;   // pareceFallbackSeco() nas mensagens originais

  timestamp: number;
}

// Entrada de observação processada pelo cron (mcp:log:obs).
export interface McpLogEntryObs {
  ts: number;
  phoneHash: string;
  stepAntes: string;
  stepDepois: string;
  houveMudancaStep: boolean;
  cartLength: number;
  deliveryType?: string;
  precisouIA: boolean;
  escalou: boolean;
  foiFallbackSeco: boolean;
  padraoObservado: PadraoObservado;
  confiancaEstrutura: number;
}

// Entrada de erro do módulo MCP (mcp:log:erros) — sempre sanitizada.
export interface McpLogEntryErro {
  ts: number;
  origem: string;
  mensagem: string;
}

// ── Fase 2A: Copiloto Determinístico ────────────────────────────────────────

export type McpPeriodo = '24h' | '7d' | '30d';

export type TipoSugestao =
  | 'confusao_recorrente'
  | 'escalacao_frequente'
  | 'necessidade_ia_frequente';

export type SeveridadeSugestao = 'alta' | 'media' | 'baixa';

export interface McpSugestaoEvidencia {
  totalEventos: number;
  problemas: number;
  taxaProblema: number;
  confiancaMedia: number;
  padroesDominantes: PadraoObservado[];
}

// Sugestão candidata persistida em mcp:sugestoes:candidatas.
// Sem PII — apenas metadados estruturais e resumo textual sem dados do cliente.
export interface McpSugestaoCandidata {
  id: string;
  ts: number;
  periodo: McpPeriodo;
  step: string;
  tipo: TipoSugestao;
  severidade: SeveridadeSugestao;
  confianca: number;
  evidencia: McpSugestaoEvidencia;
  resumo: string;
}
