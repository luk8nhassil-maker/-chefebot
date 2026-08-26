// Interpretação da resposta de GET /api/orders para a tela /pedidos.
//
// Incidente que originou este módulo: a tela ficava ETERNAMENTE em
// "Carregando...". O `loading` só terminava no caminho 100% feliz —
// resposta 200 cujo corpo era um array. Qualquer outro desfecho
// (5xx do backend, corpo que não é JSON, corpo JSON que não é array,
// falha de rede) caía num `.catch(() => {})` e o painel ficava preso no
// spinner para sempre, sem nenhum sinal para quem está atendendo.
//
// Regras que este módulo existe para garantir:
// 1. TODA resposta possível é classificada — não existe desfecho que
//    devolva "nada" e deixe a tela decidir sozinha.
// 2. Falha NUNCA vira lista vazia. "não consegui acessar os pedidos" e
//    "não existem pedidos" são estados diferentes e a operação não pode
//    confundir os dois.
// 3. 401 continua sendo sessão expirada (o painel desloga e volta ao
//    login), exatamente como antes — não é tratado como erro genérico.

/** Só o que este módulo precisa de um Response — mantém o módulo testável sem rede. */
export type RespostaPedidos = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type ResultadoCargaPedidos<TPedido> =
  | { tipo: "ok"; pedidos: TPedido[] }
  | { tipo: "nao_autenticado" }
  | { tipo: "erro"; motivo: MotivoFalhaPedidos; status: number | null };

export type MotivoFalhaPedidos =
  /** Não houve resposta HTTP: rede caiu, DNS, CORS, aba offline. */
  | "sem_resposta"
  /** Houve resposta, mas com status de erro (5xx, 402, 403, 429...). */
  | "status_http"
  /** Status OK, mas o corpo não pôde ser lido como JSON (ex.: página de erro em HTML). */
  | "corpo_ilegivel"
  /** Status OK e JSON válido, mas o formato não é a lista de pedidos esperada. */
  | "formato_inesperado";

/** Texto único mostrado ao atendente. Nunca expõe detalhe técnico na tela. */
export const MENSAGEM_FALHA_CARGA_PEDIDOS =
  "Não foi possível carregar os pedidos agora. Eles continuam salvos — ninguém foi perdido.";

/**
 * Classifica a resposta de GET /api/orders. Nunca lança: qualquer desfecho
 * inesperado vira um estado de erro EXPLÍCITO, jamais uma lista vazia e
 * jamais um "não faz nada" que preserve o spinner.
 */
export async function interpretarRespostaPedidos<TPedido>(
  resposta: RespostaPedidos | null | undefined
): Promise<ResultadoCargaPedidos<TPedido>> {
  if (!resposta) return { tipo: "erro", motivo: "sem_resposta", status: null };

  if (resposta.status === 401) return { tipo: "nao_autenticado" };

  if (!resposta.ok) return { tipo: "erro", motivo: "status_http", status: resposta.status };

  let corpo: unknown;
  try {
    corpo = await resposta.json();
  } catch {
    return { tipo: "erro", motivo: "corpo_ilegivel", status: resposta.status };
  }

  // Um corpo que não é array (ex.: `{ error: ... }` devolvido com 200, ou
  // `null`) costumava chegar até `data.map(...)`, lançar TypeError e ser
  // engolido pelo catch — a causa direta do spinner eterno.
  if (!Array.isArray(corpo)) {
    return { tipo: "erro", motivo: "formato_inesperado", status: resposta.status };
  }

  // Um item `null` (ou primitivo) dentro do array explodiria no primeiro
  // `p.id` da tela — mesmo TypeError, mesmo spinner eterno, só que uma
  // camada adiante. A lista só é aceita se cada item for objeto.
  if (!corpo.every((item) => typeof item === "object" && item !== null)) {
    return { tipo: "erro", motivo: "formato_inesperado", status: resposta.status };
  }

  return { tipo: "ok", pedidos: corpo as TPedido[] };
}
