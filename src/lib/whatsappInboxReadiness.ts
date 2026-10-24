/**
 * Avaliação técnica da fila; nunca confundir processamento local com mensagem
 * entregue no aparelho nem um canário bem-sucedido com capacidade irrestrita.
 * Função pura: nenhuma escrita, efeito comercial ou consulta a provedores.
 */
export type InboxQueueHealth = {
  pending: number;
  inFlight: number;
  queuedTotal: number;
  doneTotal: number;
  ambiguousTotal: number;
  unresolved: number;
  lastWorkerAt: number;
};
export type InboxScheduleHealth = "ok" | "ausente" | "incorreta" | "indisponivel" | "nao_configurada";
export type InboxHealthStatus = "saudavel" | "observando" | "problema";

/**
 * Confere o destino efetivo do QStash (URL calculada, nunca a referência da
 * função que calcula a URL). Sem rede, efeitos colaterais ou segredo exposto.
 */
export function agendaRecuperacaoCorreta(
  agenda: { destination?: unknown; cron?: unknown; isPaused?: unknown },
  urlEsperada: string,
): boolean {
  return urlEsperada.startsWith("https://")
    && agenda.destination === urlEsperada
    && agenda.cron === "*/5 * * * *"
    && agenda.isPaused !== true;
}

export function avaliarSaudeInbox(
  queue: InboxQueueHealth,
  schedule: InboxScheduleHealth,
  active: boolean,
  now = Date.now(),
): {
  status: InboxHealthStatus;
  motivos: string[];
  processamentoLocalConfirmado: boolean;
  recuperacaoConfigurada: boolean;
  capacidadeGeralComprovada: false;
  liberacaoGeralAutorizada: false;
} {
  const motivos: string[] = [];
  const workerRecente = queue.lastWorkerAt > 0
    && queue.lastWorkerAt <= now
    && now - queue.lastWorkerAt <= 15 * 60 * 1000;
  const anomalias = queue.ambiguousTotal > 0 || queue.unresolved > 0;
  // INVARIANTE: todo evento aceito está concluído ou ainda é pendente.
  // Sem isso, o painel poderia marcar "saudável" mesmo com jobs perdidos.
  const contadoresConsistentes =
    [queue.queuedTotal, queue.doneTotal, queue.pending, queue.inFlight]
      .every(n => Number.isSafeInteger(n) && n >= 0)
    && queue.doneTotal + queue.pending === queue.queuedTotal
    && queue.inFlight <= queue.pending;
  if (!active) motivos.push("Nova fila desativada ou configuração incompleta.");
  if (queue.queuedTotal === 0) motivos.push("Nenhuma mensagem real entrou nesta fila ainda.");
  if (queue.queuedTotal > 0 && queue.doneTotal === 0)
    motivos.push("Ainda não há confirmação de processamento local concluído.");
  if (queue.pending > 0 || queue.inFlight > 0)
    motivos.push("Há mensagens aguardando ou em processamento.");
  if (anomalias)
    motivos.push("Há mensagens de resultado incerto: precisam de reconciliação individual, nunca reenvio cego.");
  if (!contadoresConsistentes)
    motivos.push("Contadores da fila divergentes: verificar jobs individualmente, sem reenviar em massa.");
  if (!workerRecente) motivos.push("Não há execução recente confirmada do processador (últimos 15 minutos).");
  if (schedule !== "ok")
    motivos.push(schedule === "ausente" ? "Agenda de recuperação não encontrada no QStash."
      : schedule === "incorreta" ? "Agenda de recuperação diferente da esperada."
      : schedule === "nao_configurada" ? "QStash não configurado para consulta."
      : "Não foi possível confirmar a agenda de recuperação no QStash.");
  const processamentoLocalConfirmado = active && queue.doneTotal > 0 && !anomalias && contadoresConsistentes;
  const recuperacaoConfigurada = schedule === "ok" && workerRecente;
  const status: InboxHealthStatus = !active || anomalias || !contadoresConsistentes || schedule === "ausente" || schedule === "incorreta"
    ? "problema"
    : queue.queuedTotal === 0 || queue.doneTotal === 0 || !workerRecente || schedule !== "ok"
      || queue.pending > 0 || queue.inFlight > 0 ? "observando" : "saudavel";
  // Capacidade depende de pico real, quotas Upstash/QStash e orçamento;
  // métricas de 1 telefone não autorizam, sozinhas, expandir para todos.
  motivos.push("Capacidade geral ainda não comprovada: comparar pico real de todos os clientes com a quota do QStash e limites do worker.");
  return {
    status, motivos, processamentoLocalConfirmado,
    recuperacaoConfigurada,
    capacidadeGeralComprovada: false,
    liberacaoGeralAutorizada: false,
  };
}
