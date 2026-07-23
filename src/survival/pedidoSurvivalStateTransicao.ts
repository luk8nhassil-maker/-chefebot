// Tabela explícita de transições do campo `survivalState` de um pedido
// (Modo Sobrevivência — idempotência do pedido). Função pura, sem I/O: a
// validação em si roda aqui; quem chama (marcarSurvivalStateDoPedido, dentro
// da seção atômica de pedidosStore.ts) decide o que fazer com o resultado.
//
// Estados: `pending_critical_confirmation` (persistido, mas ainda esperando
// um efeito crítico — ex.: resgate de pontos — ser confirmado antes de
// responder sucesso ao cliente); `completed` (efeito crítico confirmado,
// seguro reconstruir sucesso); `recovery_required` (o efeito crítico não
// pôde ser confirmado nem revertido com certeza — precisa de recuperação
// manual/automática comprovada antes de qualquer coisa).
export type PedidoSurvivalState = "pending_critical_confirmation" | "completed" | "recovery_required";

export type ResultadoTransicaoSurvivalState =
  | { permitida: true }
  | { permitida: false; motivo: "estado_atual_invalido" | "transicao_nao_permitida" | "estado_inalterado" };

const ESTADOS_VALIDOS = new Set<string>(["pending_critical_confirmation", "completed", "recovery_required"]);

// Grafo de transições permitidas. Um pedido sem `survivalState` (legado, ou
// nunca precisou de acompanhamento crítico) é tratado como estado inicial
// implícito — só pode ir para qualquer estado válido (equivalente a nunca
// ter existido). `completed` e `recovery_required` são terminais: nenhuma
// transição sai deles (recovery_required só "sai" via recuperação
// comprovada fora deste fluxo — nunca virando `completed` por uma simples
// re-tentativa da mesma mutação).
const TRANSICOES_PERMITIDAS: Record<string, Set<string>> = {
  __inicial__: new Set(["pending_critical_confirmation", "completed", "recovery_required"]),
  pending_critical_confirmation: new Set(["completed", "recovery_required"]),
  completed: new Set(),
  recovery_required: new Set(),
};

/** Valida se `estadoAtual -> novoEstado` é uma transição permitida.
 * `estadoAtual` pode ser `undefined` (pedido legado/sem o campo ainda) —
 * tratado como estado inicial implícito. Nunca aceita transição para um
 * estado desconhecido/corrompido (fora dos 3 valores válidos), nunca
 * sobrescreve silenciosamente um estado atual já corrompido/desconhecido, e
 * nunca permite `completed`/`recovery_required` "voltarem" para qualquer
 * outro estado. Repetir o MESMO estado (idempotência de retry) é permitido
 * — sinalizado como `estado_inalterado`, não como falha, mas também não
 * requer nova escrita. */
export function validarTransicaoSurvivalState(
  estadoAtual: string | undefined,
  novoEstado: string
): ResultadoTransicaoSurvivalState {
  if (!ESTADOS_VALIDOS.has(novoEstado)) {
    return { permitida: false, motivo: "transicao_nao_permitida" };
  }
  if (estadoAtual !== undefined && !ESTADOS_VALIDOS.has(estadoAtual)) {
    // Estado atual corrompido/desconhecido — nunca sobrescrito
    // silenciosamente por uma transição automática.
    return { permitida: false, motivo: "estado_atual_invalido" };
  }
  if (estadoAtual === novoEstado) {
    return { permitida: false, motivo: "estado_inalterado" };
  }
  const origem = estadoAtual ?? "__inicial__";
  const permitidas = TRANSICOES_PERMITIDAS[origem] ?? new Set<string>();
  if (!permitidas.has(novoEstado)) {
    return { permitida: false, motivo: "transicao_nao_permitida" };
  }
  return { permitida: true };
}
