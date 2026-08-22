type DocumentoPolling = {
  hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

type AmbientePolling = {
  documento?: DocumentoPolling | null;
  agora?: () => number;
  setTimeoutFn?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
};

export type OpcoesPollingVisivel = {
  executar: () => void | Promise<void>;
  intervaloMs: number;
  pausarOculto?: boolean;
  executarAoIniciar?: boolean;
  ambiente?: AmbientePolling;
};

/**
 * Polling sem sobreposição: o próximo disparo só é armado quando o
 * anterior termina. O intervalo é medido a partir do INÍCIO da chamada,
 * então requisições rápidas preservam a mesma cadência nominal (ex.: 3s)
 * e requisições lentas nunca empilham concorrência.
 *
 * Quando `pausarOculto` é true, uma aba invisível não gera tráfego e a
 * volta ao foreground dispara uma atualização imediata. Para fluxos que
 * também funcionam como alarme de pedido, use false para preservar a
 * cobertura em segundo plano.
 */
export function iniciarPollingVisivel(opcoes: OpcoesPollingVisivel): () => void {
  if (!Number.isFinite(opcoes.intervaloMs) || opcoes.intervaloMs <= 0) {
    throw new Error("intervaloMs deve ser maior que zero");
  }

  const documento = opcoes.ambiente?.documento ??
    (typeof document !== "undefined" ? document : null);
  const agora = opcoes.ambiente?.agora ?? Date.now;
  const setTimeoutFn = opcoes.ambiente?.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opcoes.ambiente?.clearTimeoutFn ?? clearTimeout;
  const pausarOculto = opcoes.pausarOculto ?? true;
  const executarAoIniciar = opcoes.executarAoIniciar ?? true;

  let cancelado = false;
  let emExecucao = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const limparTimer = () => {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  };

  const estaOculto = () => pausarOculto && documento?.hidden === true;

  const agendar = (delayMs: number = opcoes.intervaloMs) => {
    if (cancelado || estaOculto()) return;
    limparTimer();
    timer = setTimeoutFn(() => { void rodar(); }, Math.max(0, delayMs));
  };

  const rodar = async () => {
    if (cancelado || estaOculto() || emExecucao) return;
    limparTimer();
    emExecucao = true;
    const iniciouEm = agora();
    try {
      await opcoes.executar();
    } catch {
      // O chamador continua responsável pelo estado de erro. Uma falha
      // transitória não mata o polling nem cria retry agressivo.
    } finally {
      emExecucao = false;
      if (cancelado || estaOculto()) return;
      const duracao = Math.max(0, agora() - iniciouEm);
      agendar(Math.max(0, opcoes.intervaloMs - duracao));
    }
  };

  const aoMudarVisibilidade = () => {
    if (!pausarOculto) return;
    if (estaOculto()) {
      limparTimer();
      return;
    }
    if (!emExecucao) void rodar();
  };

  if (pausarOculto && documento) {
    documento.addEventListener("visibilitychange", aoMudarVisibilidade);
  }

  if (executarAoIniciar) {
    if (!estaOculto()) void rodar();
  } else {
    agendar();
  }

  return () => {
    cancelado = true;
    limparTimer();
    if (pausarOculto && documento) {
      documento.removeEventListener("visibilitychange", aoMudarVisibilidade);
    }
  };
}
