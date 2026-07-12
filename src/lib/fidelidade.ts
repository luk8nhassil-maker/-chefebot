import { redis } from "./redis";
import { sanitizeTelefoneCliente, clienteIdDoTelefone } from "./clientes";

export type TipoRecompensa = "pizza_gratis" | "desconto_fixo" | "desconto_percentual";

export type ConfigFidelidade = {
  ativo: boolean;
  pizzasParaPremio: number;
  tipoRecompensa: TipoRecompensa;
  descricaoRecompensa: string;
  validadeDias?: number;
};

export const CONFIG_FIDELIDADE_PADRAO: ConfigFidelidade = {
  ativo: false,
  pizzasParaPremio: 10,
  tipoRecompensa: "pizza_gratis",
  descricaoRecompensa: "Pizza grátis",
};

const CHAVE_CONFIG = "config:fidelidade";

export async function obterConfigFidelidade(): Promise<ConfigFidelidade> {
  const salva = await redis.get<ConfigFidelidade>(CHAVE_CONFIG);
  return salva ?? CONFIG_FIDELIDADE_PADRAO;
}

export async function salvarConfigFidelidade(config: ConfigFidelidade): Promise<void> {
  await redis.set(CHAVE_CONFIG, config);
}

export type TipoMovimentoFidelidade = "credito" | "resgate" | "ajuste" | "recompensa";

export type MovimentoFidelidade = {
  movimentoId: string;
  clienteId: string;
  pedidoId?: string;
  tipo: TipoMovimentoFidelidade;
  quantidade: number;
  motivo: string;
  createdAt: string;
};

export type StatusRecompensa = "disponivel" | "usada" | "expirada";

export type Recompensa = {
  recompensaId: string;
  clienteId: string;
  status: StatusRecompensa;
  tipo: TipoRecompensa;
  descricao: string;
  pedidoOrigemId: string;
  createdAt: string;
  expiresAt?: string;
};

type SaldoFidelidade = {
  progresso: number;
};

function chaveExtrato(clienteId: string): string {
  return `fidelidade:extrato:${clienteId}`;
}

function chaveSaldo(clienteId: string): string {
  return `fidelidade:saldo:${clienteId}`;
}

function chaveRecompensas(clienteId: string): string {
  return `fidelidade:recompensas:${clienteId}`;
}

function chaveIdempotencia(pedidoId: string): string {
  return `fidelidade:creditado:${pedidoId}`;
}

function novoId(prefixo: string): string {
  return `${prefixo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Conta apenas pizzas (kind === "pizza"); bebidas/sucos/lanches nao contam para fidelidade. */
export function contarPizzas(itens: Array<{ kind?: string; qty?: number }>): number {
  if (!Array.isArray(itens)) return 0;
  return itens
    .filter((item) => item?.kind === "pizza")
    .reduce((soma, item) => soma + (Number(item.qty) || 0), 0);
}

async function registrarMovimento(
  clienteId: string,
  movimento: Omit<MovimentoFidelidade, "movimentoId" | "clienteId" | "createdAt">
): Promise<MovimentoFidelidade> {
  const extrato = (await redis.get<MovimentoFidelidade[]>(chaveExtrato(clienteId))) ?? [];
  const registro: MovimentoFidelidade = {
    movimentoId: novoId("mov"),
    clienteId,
    createdAt: new Date().toISOString(),
    ...movimento,
  };
  await redis.set(chaveExtrato(clienteId), [...extrato, registro]);
  return registro;
}

async function criarRecompensa(
  clienteId: string,
  config: ConfigFidelidade,
  pedidoOrigemId: string
): Promise<Recompensa> {
  const recompensas = (await redis.get<Recompensa[]>(chaveRecompensas(clienteId))) ?? [];
  const agora = new Date();
  const recompensa: Recompensa = {
    recompensaId: novoId("rec"),
    clienteId,
    status: "disponivel",
    tipo: config.tipoRecompensa,
    descricao: config.descricaoRecompensa,
    pedidoOrigemId,
    createdAt: agora.toISOString(),
    ...(config.validadeDias
      ? { expiresAt: new Date(agora.getTime() + config.validadeDias * 86400000).toISOString() }
      : {}),
  };
  await redis.set(chaveRecompensas(clienteId), [...recompensas, recompensa]);
  return recompensa;
}

/**
 * Credita fidelidade para um pedido finalizado. Idempotente por pedidoId
 * (chave fidelidade:creditado:{pedidoId} com SET NX). Nunca lanca excecao
 * que impeca o chamador de responder — quem chama deve envolver em try/catch,
 * mas mesmo aqui os efeitos colaterais sao best-effort.
 */
export async function creditarFidelidadePedido(params: {
  pedidoId: string;
  clienteId?: string;
  pizzas: number;
}): Promise<void> {
  const { pedidoId, clienteId, pizzas } = params;
  if (!clienteId || !pedidoId || pizzas <= 0) return;

  const config = await obterConfigFidelidade();
  if (!config.ativo || config.pizzasParaPremio <= 0) return;

  const marcou = await redis.set(chaveIdempotencia(pedidoId), true, { nx: true });
  if (!marcou) return; // ja creditado antes (idempotencia)

  await registrarMovimento(clienteId, {
    pedidoId,
    tipo: "credito",
    quantidade: pizzas,
    motivo: `Credito por pedido ${pedidoId}`,
  });

  const saldo = (await redis.get<SaldoFidelidade>(chaveSaldo(clienteId))) ?? { progresso: 0 };
  let progresso = saldo.progresso + pizzas;

  while (progresso >= config.pizzasParaPremio) {
    progresso -= config.pizzasParaPremio;
    await criarRecompensa(clienteId, config, pedidoId);
    await registrarMovimento(clienteId, {
      pedidoId,
      tipo: "recompensa",
      quantidade: config.pizzasParaPremio,
      motivo: "Meta de fidelidade atingida",
    });
  }

  await redis.set(chaveSaldo(clienteId), { progresso });
}

export type ProgressoFidelidade = {
  ativo: boolean;
  progresso: number;
  meta: number;
  faltam: number;
  tipoRecompensa: TipoRecompensa;
  descricaoRecompensa: string;
  recompensasDisponiveis: Recompensa[];
};

export async function obterProgressoFidelidade(clienteId: string): Promise<ProgressoFidelidade> {
  const config = await obterConfigFidelidade();
  const saldo = (await redis.get<SaldoFidelidade>(chaveSaldo(clienteId))) ?? { progresso: 0 };
  const recompensas = (await redis.get<Recompensa[]>(chaveRecompensas(clienteId))) ?? [];
  const recompensasDisponiveis = recompensas.filter((r) => r.status === "disponivel");

  return {
    ativo: config.ativo,
    progresso: saldo.progresso,
    meta: config.pizzasParaPremio,
    faltam: Math.max(config.pizzasParaPremio - saldo.progresso, 0),
    tipoRecompensa: config.tipoRecompensa,
    descricaoRecompensa: config.descricaoRecompensa,
    recompensasDisponiveis,
  };
}

// ============================================================================
// MODELO NOVO — FIDELIDADE POR PONTOS (fundação, Etapa 1 do plano aprovado)
//
// Tudo abaixo é aditivo e isolado do modelo antigo (pizzas) acima: chaves de
// Redis próprias, com o prefixo "fidelidade:pontos:", nunca sobrescrevem ou
// leem as chaves antigas (`fidelidade:saldo:`, `fidelidade:extrato:`,
// `fidelidade:creditado:`). Nada aqui é chamado por nenhuma rota de pedido
// real ainda — é só a fundação de tipos/dados/helpers puros para a próxima
// etapa conectar ao fluxo de `/api/orders` (crédito) e ao checkout (resgate).
//
// Unidades não são conversíveis automaticamente: o saldo antigo é em
// "pizzas" (unidade), o novo é em "pontos" (1 ponto = R$1 gasto). Por isso
// não existe aqui nenhuma função de migração — decisão de negócio em aberto,
// documentada na auditoria técnica aprovada.
// ============================================================================

/**
 * Estado de um movimento de pontos. Distinção explícita exigida pelo modelo:
 * - previsto: calculado na criação do pedido, ainda não é saldo real (é a
 *   estimativa "este pedido renderá X pontos"). Nunca afeta o saldo.
 * - confirmado: pedido chegou a "entregue" — pontos passam a valer no saldo.
 * - cancelado: pedido previsto que não virou confirmado (pedido cancelado
 *   antes da entrega); fica registrado no extrato para transparência, nunca
 *   some silenciosamente. Nunca afeta o saldo (nunca havia sido somado).
 * - estornado: reverte um crédito que **já tinha sido confirmado** (ex.:
 *   pedido marcado "entregue" por engano e depois corrigido para
 *   "cancelado"). Diferente de "cancelado": aqui os pontos já estavam no
 *   saldo e precisam ser retirados. O extrato nunca é reescrito ou apagado —
 *   o estorno é sempre um novo movimento (subtrai no cálculo do saldo, como
 *   "resgatado"), referenciando o mesmo `pedidoId` do crédito original, mas
 *   com um `eventoId` próprio (ver `registrarMovimentoPontosIdempotente`).
 * - resgatado: débito de pontos por resgate de recompensa.
 * - ajuste: correção manual (positiva ou negativa), fora do fluxo automático.
 */
export type TipoMovimentoPontos = "previsto" | "confirmado" | "cancelado" | "estornado" | "resgatado" | "ajuste";

export type MovimentoPontos = {
  movimentoId: string;
  clienteId: string;
  pedidoId?: string;
  tipo: TipoMovimentoPontos;
  pontos: number;
  motivo: string;
  createdAt: string;
  /** Chave de idempotência usada para gravar este movimento (ver registrarMovimentoPontosIdempotente). */
  eventoId?: string;
  /** Valor em R$ que originou os pontos (antes da conversão R$1=1 ponto), quando aplicável. */
  valorElegivel?: number;
  /** Saldo confirmado logo após este movimento — snapshot para auditoria, recalculável a qualquer momento a partir do extrato completo. */
  saldoApos?: number;
};

export type SaldoPontos = {
  /** Pontos confirmados e ainda não resgatados/estornados. Nunca inclui "previstos". */
  disponivel: number;
};

export type ConfigFidelidadePontos = {
  ativo: boolean;
  /**
   * Meta em pontos — fonte principal e explícita da configuração. Quando
   * definida (> 0), sempre vence sobre o cálculo derivado das referências de
   * Pizza Família abaixo.
   */
  metaPontos?: number;
  /**
   * Referência opcional, só para documentar/derivar a meta quando
   * `metaPontos` não é informado (compatibilidade com a forma como a meta
   * foi originalmente descrita: "equivalente a N Pizzas Família"). Nunca é
   * obrigatória para o modelo por pontos funcionar.
   */
  valorPizzaFamiliaReferencia?: number;
  /** Referência opcional, ver `valorPizzaFamiliaReferencia`. */
  metaPizzasFamilia?: number;
  descricaoRecompensa: string;
  validadeDias?: number;
};

export const CONFIG_FIDELIDADE_PONTOS_PADRAO: ConfigFidelidadePontos = {
  ativo: false,
  metaPontos: 720,
  valorPizzaFamiliaReferencia: 60,
  metaPizzasFamilia: 12,
  descricaoRecompensa: "1 Pizza Família",
};

const CHAVE_CONFIG_PONTOS = "config:fidelidade:pontos";

// Extrato e recompensas do modelo por pontos vivem numa ÚNICA chave por
// cliente (EstadoPontosCliente) — não em duas chaves separadas. É essa
// escolha, e não o lock sozinho, que garante que um movimento e a eventual
// recompensa que ele desbloqueia sejam persistidos atomicamente: os dois só
// existem juntos porque são escritos num único `redis.set`. Não há como um
// ser gravado sem o outro (ver `registrarMovimentoPontosIdempotente`).
export type EstadoPontosCliente = {
  extrato: MovimentoPontos[];
  recompensas: RecompensaPontosDesbloqueada[];
};

function chaveEstadoPontos(clienteId: string): string {
  return `fidelidade:pontos:estado:${clienteId}`;
}

export function chaveLockPontos(clienteId: string): string {
  return `fidelidade:pontos:lock:${clienteId}`;
}

async function obterEstadoPontos(clienteId: string): Promise<EstadoPontosCliente> {
  const estado = await redis.get<EstadoPontosCliente>(chaveEstadoPontos(clienteId));
  return estado ?? { extrato: [], recompensas: [] };
}

const LOCK_TTL_SEGUNDOS = 5;
const LOCK_MAX_TENTATIVAS = 50;
const LOCK_ESPERA_MS = 20;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gerarTokenLock(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Compare-and-delete atômico via Lua: só apaga o lock se o valor atual ainda
// for exatamente o token de quem está liberando. Isso é o que impede um
// processo cujo lock já expirou (TTL) de apagar o lock de outro processo que
// tenha assumido a chave depois da expiração — um `DEL` incondicional não
// tem como saber se ainda é o dono.
const LOCK_UNLOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/**
 * Libera o lock de fidelidade por pontos de um cliente, mas só se o valor
 * atual da chave ainda for exatamente este `token` (comparação e exclusão
 * atômicas via script Lua — `GET` + `DEL` condicional numa única operação,
 * sem janela entre checar e apagar). Retorna `true` se de fato apagou (era
 * o dono do lock), `false` caso contrário (não era mais o dono — nada é
 * apagado, o lock do outro processo fica intacto).
 */
export async function liberarLockPontosSeDono(clienteId: string, token: string): Promise<boolean> {
  const resultado = await redis.eval(LOCK_UNLOCK_SCRIPT, [chaveLockPontos(clienteId)], [token]);
  return resultado === 1;
}

/**
 * Serializa qualquer leitura-modificação-escrita do estado (extrato +
 * recompensas) de UM cliente por vez, via lock exclusivo em Redis (`SET NX`
 * + TTL curto, com token próprio por aquisição). Isso é o que impede duas
 * requisições concorrentes (dois pedidos entregues quase ao mesmo tempo, ou
 * o mesmo pedido reprocessado em paralelo) de lerem o mesmo estado "antes" e
 * se sobrescreverem uma à outra na escrita — o cenário que um `SET NX` de
 * idempotência sozinho, seguido de leitura/escrita de array sem proteção,
 * não resolve.
 *
 * Propriedade do lock: cada aquisição gera um token aleatório único: o
 * `finally` libera com `liberarLockPontosSeDono`, que só apaga se o valor
 * atual ainda for o MESMO token — se o TTL expirou no meio da operação e
 * outro processo já assumiu a chave com um token diferente, este `finally`
 * NUNCA apaga o lock do outro (nunca um `DEL` incondicional).
 *
 * TTL curto (5s) é uma rede de segurança contra deadlock se o processo
 * morrer com o lock preso — não é o mecanismo principal de liberação (isso
 * é o `finally`/compare-and-delete). Backoff simples com várias tentativas
 * curtas: em caso de falha real (não conseguiu o lock em nenhuma
 * tentativa), lança erro — quem chama (sempre em try/catch, ver
 * `creditarPontosPedidoEntregue`) trata como falha best-effort e o pedido
 * pode ser reprocessado depois com segurança, já que nada é marcado como
 * "processado" antes da escrita real do estado.
 */
async function comBloqueioCliente<T>(clienteId: string, fn: () => Promise<T>): Promise<T> {
  const chave = chaveLockPontos(clienteId);
  for (let tentativa = 0; tentativa < LOCK_MAX_TENTATIVAS; tentativa++) {
    const token = gerarTokenLock();
    const obtido = await redis.set(chave, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
    if (obtido) {
      try {
        return await fn();
      } finally {
        await liberarLockPontosSeDono(clienteId, token);
      }
    }
    await esperar(LOCK_ESPERA_MS);
  }
  throw new Error(`Nao foi possivel obter o bloqueio de fidelidade por pontos para ${clienteId}`);
}

/**
 * Constrói um `eventoId` padrão a partir de (pedidoId, tipo), com um sufixo
 * opcional para diferenciar múltiplos eventos do mesmo tipo no mesmo pedido
 * (ex.: um estorno parcial e outro complementar). Uso conveniente, não
 * obrigatório — quem chama `registrarMovimentoPontosIdempotente` pode sempre
 * passar seu próprio `eventoId`.
 */
export function construirEventoIdPontos(pedidoId: string, tipo: TipoMovimentoPontos, sufixo?: string): string {
  return sufixo ? `${tipo}:${pedidoId}:${sufixo}` : `${tipo}:${pedidoId}`;
}

/**
 * Meta em pontos. Prioridade: `metaPontos` explícito (se > 0) sempre vence;
 * na ausência dele, deriva de `valorPizzaFamiliaReferencia × metaPizzasFamilia`
 * (as duas referências de pizza, se informadas). Sem nenhuma das duas fontes
 * válidas, retorna 0 — as referências de pizza nunca são obrigatórias.
 */
export function calcularMetaPontos(
  config: Pick<ConfigFidelidadePontos, "metaPontos" | "valorPizzaFamiliaReferencia" | "metaPizzasFamilia">
): number {
  const metaExplicita = Number(config.metaPontos);
  if (Number.isFinite(metaExplicita) && metaExplicita > 0) return Math.round(metaExplicita);

  const valor = Number(config.valorPizzaFamiliaReferencia);
  const qtd = Number(config.metaPizzasFamilia);
  if (!Number.isFinite(valor) || valor <= 0 || !Number.isFinite(qtd) || qtd <= 0) return 0;
  return Math.round(valor * qtd);
}

/**
 * Regra central do novo modelo: R$1 gasto = 1 ponto. Arredonda sempre para
 * baixo (nunca credita ponto fracionado por centavos) e nunca retorna valor
 * negativo.
 */
export function calcularPontosPorValor(valorReais: number): number {
  if (!Number.isFinite(valorReais) || valorReais <= 0) return 0;
  return Math.floor(valorReais);
}

/**
 * Pontos elegíveis de um pedido: total menos taxa de entrega (a taxa nunca
 * gera pontos). Não decide se o pedido está entregue/cancelado — quem chama
 * decide em que momento aplicar (previsto vs. confirmado); esta função só
 * calcula o valor.
 */
export function calcularPontosElegiveisPedido(params: { total: number; taxaEntrega?: number }): number {
  const total = Number(params.total) || 0;
  const taxa = Number(params.taxaEntrega) || 0;
  return calcularPontosPorValor(total - taxa);
}

/**
 * Saldo confirmado a partir do extrato completo. "previsto" e "cancelado"
 * nunca afetam o saldo (são só registro/transparência — o crédito nunca
 * chegou a entrar); "confirmado" soma; "resgatado" e "estornado" subtraem
 * (um estorno reverte um crédito já confirmado, sem apagar o movimento
 * original — ele continua no extrato, só um novo lançamento negativo é
 * somado); "ajuste" soma o valor informado (pode ser negativo). Função pura
 * — não lê nem escreve Redis, não muta a lista recebida — para permitir
 * testar saldo residual e comportamento de cada tipo sem infraestrutura.
 */
export function calcularSaldoDoExtrato(movimentos: MovimentoPontos[]): number {
  if (!Array.isArray(movimentos)) return 0;
  return movimentos.reduce((saldo, mov) => {
    switch (mov.tipo) {
      case "confirmado":
        return saldo + mov.pontos;
      case "resgatado":
      case "estornado":
        return saldo - mov.pontos;
      case "ajuste":
        return saldo + mov.pontos;
      case "previsto":
      case "cancelado":
      default:
        return saldo;
    }
  }, 0);
}

export async function obterConfigFidelidadePontos(): Promise<ConfigFidelidadePontos> {
  const salva = await redis.get<ConfigFidelidadePontos>(CHAVE_CONFIG_PONTOS);
  return salva ?? CONFIG_FIDELIDADE_PONTOS_PADRAO;
}

export async function salvarConfigFidelidadePontos(config: ConfigFidelidadePontos): Promise<void> {
  await redis.set(CHAVE_CONFIG_PONTOS, config);
}

export async function obterExtratoPontos(clienteId: string): Promise<MovimentoPontos[]> {
  return (await obterEstadoPontos(clienteId)).extrato;
}

export async function obterSaldoPontos(clienteId: string): Promise<SaldoPontos> {
  const { extrato } = await obterEstadoPontos(clienteId);
  return { disponivel: calcularSaldoDoExtrato(extrato) };
}

/**
 * Estado de uma recompensa desbloqueada pelo modelo de pontos:
 * - disponivel: meta atingida, cliente ainda não foi notificado.
 * - notificada: evento de notificação já registrado (ver `notificacaoStatus`
 *   no próprio registro) — continua "disponível" para resgate, só marca que
 *   o aviso já foi (ou vai ser, quando a etapa de envio existir) disparado.
 * - resgatada: resgate concluído dentro do app (fora do escopo desta etapa
 *   — implementação futura). A partir daqui um novo ciclo pode gerar outra
 *   notificação se o saldo voltar a cruzar a meta.
 * - expirada: fora do escopo desta etapa, reservado para regra de validade.
 */
export type StatusRecompensaPontos = "disponivel" | "notificada" | "resgatada" | "expirada";

export type RecompensaPontosDesbloqueada = {
  recompensaId: string;
  clienteId: string;
  /** Pedido cujo crédito fez o saldo cruzar a meta. */
  pedidoId?: string;
  pontosNaDesbloqueio: number;
  metaNaDesbloqueio: number;
  status: StatusRecompensaPontos;
  /** Estado da notificação — "pendente" até uma etapa futura efetivamente enviar a mensagem (ver `notificacaoRecompensaHabilitada`). */
  notificacaoStatus: "pendente" | "enviada";
  createdAt: string;
};

export async function obterRecompensasPontos(clienteId: string): Promise<RecompensaPontosDesbloqueada[]> {
  return (await obterEstadoPontos(clienteId)).recompensas;
}

/**
 * Lê a flag de ambiente que habilita o ENVIO real da notificação de
 * recompensa desbloqueada. Nenhuma função deste arquivo envia mensagem —
 * esta etapa só registra o evento auditável e o estado "pendente"; o envio
 * de verdade (integração com o WhatsApp) é implementação futura, a ser
 * ligada somente depois que o fluxo de resgate dentro do app existir e
 * estiver validado. Até lá, esta flag existe só para a etapa futura checar
 * antes de disparar — o valor default (ausente/qualquer coisa != "true") é
 * sempre "desligado".
 */
export function notificacaoRecompensaHabilitada(): boolean {
  return process.env.FIDELIDADE_NOTIFICACAO_RECOMPENSA_ATIVA === "true";
}

/**
 * Calcula a lista de recompensas resultante depois de um movimento —
 * função PURA (não lê nem escreve Redis), para poder ser combinada com o
 * novo extrato e persistida junto, na mesma escrita atômica. Detecta a
 * passagem de saldoAnterior < meta para saldoAtual >= meta; nunca cria duas
 * recompensas abertas para o mesmo cliente ao mesmo tempo — enquanto
 * existir uma com status "disponivel" ou "notificada" na lista recebida,
 * devolve a lista sem alteração. Só depois de um resgate (fora do escopo
 * desta etapa) é que um novo cruzamento pode gerar outra.
 */
function aplicarDeteccaoRecompensa(
  clienteId: string,
  recompensasAtuais: RecompensaPontosDesbloqueada[],
  meta: number,
  params: { saldoAnterior: number; saldoAtual: number; pedidoId?: string }
): RecompensaPontosDesbloqueada[] {
  if (meta <= 0) return recompensasAtuais;
  if (params.saldoAnterior >= meta) return recompensasAtuais; // ja tinha cruzado antes (ciclo ja aberto ou nao resolvido)
  if (params.saldoAtual < meta) return recompensasAtuais; // ainda nao cruzou

  const jaTemCicloAberto = recompensasAtuais.some((r) => r.status === "disponivel" || r.status === "notificada");
  if (jaTemCicloAberto) return recompensasAtuais; // nunca duplica enquanto a recompensa anterior nao for resgatada

  const recompensa: RecompensaPontosDesbloqueada = {
    recompensaId: novoId("rcp"),
    clienteId,
    pedidoId: params.pedidoId,
    pontosNaDesbloqueio: params.saldoAtual,
    metaNaDesbloqueio: meta,
    status: "disponivel",
    notificacaoStatus: "pendente",
    createdAt: new Date().toISOString(),
  };
  return [...recompensasAtuais, recompensa];
}

/**
 * Registra um movimento de pontos de forma idempotente, atômica e segura
 * contra concorrência. Toda a operação roda dentro de um lock exclusivo por
 * cliente (`comBloqueioCliente`):
 *
 * 1. checa se o evento já foi processado (contra o próprio extrato);
 * 2. calcula saldo antes/depois e monta o novo movimento;
 * 3. calcula a lista de recompensas resultante (função pura, em memória);
 * 4. grava extrato E recompensas juntos, numa ÚNICA chamada `redis.set`
 *    sobre uma única chave (`EstadoPontosCliente`).
 *
 * O passo 4 ser uma escrita só é o que garante atomicidade entre movimento
 * e recompensa: não existe um estado intermediário onde o movimento foi
 * gravado mas a recompensa não (ou vice-versa) — ou os dois são persistidos
 * juntos, ou nenhuma escrita acontece. Se a escrita falhar, nada muda: como
 * a idempotência é checada contra o extrato real (não uma flag marcada
 * antes), uma tentativa que falhou no meio do caminho não deixa rastro —
 * o reprocessamento seguinte recalcula tudo do zero (movimento + saldo +
 * recompensa) com segurança.
 *
 * `eventoId` explícito (opcional) permite diferenciar múltiplos eventos do
 * mesmo tipo no mesmo pedido; sem ele, cai no padrão `${tipo}:${pedidoId}`.
 * Retorna `null` quando o evento já tinha sido registrado antes; o
 * movimento criado caso contrário.
 */
export async function registrarMovimentoPontosIdempotente(
  clienteId: string,
  evento: { eventoId?: string; pedidoId: string; tipo: TipoMovimentoPontos; pontos: number; motivo: string; valorElegivel?: number }
): Promise<MovimentoPontos | null> {
  const eventoId = evento.eventoId ?? construirEventoIdPontos(evento.pedidoId, evento.tipo);

  return comBloqueioCliente(clienteId, async () => {
    const estado = await obterEstadoPontos(clienteId);
    if (estado.extrato.some((m) => m.eventoId === eventoId)) return null; // ja processado

    const saldoAnterior = calcularSaldoDoExtrato(estado.extrato);
    const registroSemSaldo: MovimentoPontos = {
      movimentoId: novoId("pt"),
      clienteId,
      pedidoId: evento.pedidoId,
      tipo: evento.tipo,
      pontos: evento.pontos,
      motivo: evento.motivo,
      createdAt: new Date().toISOString(),
      eventoId,
      ...(evento.valorElegivel !== undefined ? { valorElegivel: evento.valorElegivel } : {}),
    };
    const novoExtrato = [...estado.extrato, registroSemSaldo];
    // saldoApos é um snapshot de auditoria — sempre recalculável a partir do
    // extrato completo (calcularSaldoDoExtrato), nunca a fonte de verdade.
    const saldoApos = calcularSaldoDoExtrato(novoExtrato);
    const registro: MovimentoPontos = { ...registroSemSaldo, saldoApos };
    novoExtrato[novoExtrato.length - 1] = registro;

    // Detecta cruzamento de meta genericamente (qualquer tipo que tenha
    // aumentado o saldo — hoje só "confirmado"/"ajuste" positivo fazem
    // isso). Só uma computação em memória — a escrita real é uma só, abaixo,
    // junto com o extrato.
    let novasRecompensas = estado.recompensas;
    if (saldoApos > saldoAnterior) {
      const config = await obterConfigFidelidadePontos();
      const meta = calcularMetaPontos(config);
      novasRecompensas = aplicarDeteccaoRecompensa(clienteId, estado.recompensas, meta, {
        saldoAnterior,
        saldoAtual: saldoApos,
        pedidoId: evento.pedidoId,
      });
    }

    await redis.set(chaveEstadoPontos(clienteId), { extrato: novoExtrato, recompensas: novasRecompensas });

    return registro;
  });
}

/**
 * Deriva o clienteId canônico a partir de um telefone, no mesmo formato
 * usado pelo login do cliente (`cli_{telefone sanitizado}`). Retorna
 * undefined para telefone ausente/curto demais para ser válido — nunca cria
 * um clienteId a partir de lixo, o que evitaria criar saldo órfão.
 *
 * O telefone do WhatsApp é a identidade canônica da fidelidade por pontos:
 * o mesmo telefone SEMPRE deriva o mesmo clienteId, então uma compra pelo
 * WhatsApp e uma compra pelo app com o mesmo número alimentam o mesmo
 * saldo — nunca dois saldos para o mesmo telefone, com ou sem o cliente
 * ainda ter ativado o perfil no app.
 */
export function derivarClienteIdPorTelefone(telefone?: string): string | undefined {
  if (!telefone) return undefined;
  const sanitizado = sanitizeTelefoneCliente(telefone);
  if (sanitizado.length < 10) return undefined;
  return clienteIdDoTelefone(sanitizado);
}

export type PedidoParaCreditoPontos = {
  id: string;
  status: string;
  telefone?: string;
  clienteId?: string;
  total?: number;
  taxaEntrega?: number;
};

/**
 * Ponto único de integração entre pedidos reais e a fidelidade por pontos.
 * Chamar sempre que um pedido for persistido com `status === "entregue"` —
 * em QUALQUER um dos caminhos que escrevem na chave "pedidos" do Redis
 * (`/api/orders`, confirmação de entrega pelo WhatsApp, painel do
 * entregador). A idempotência é por pedidoId (`eventoId` padrão
 * `confirmado:{pedidoId}`): reprocessar ou resalvar o mesmo pedido entregue
 * nunca credita duas vezes, então não é necessário comparar o status
 * anterior com o novo antes de chamar esta função — chamar sempre que o
 * status observado for "entregue" é seguro.
 *
 * Identidade: o telefone é a fonte canônica (ver `derivarClienteIdPorTelefone`)
 * — pedido sem telefone válido (>= 10 dígitos) NUNCA gera pontos, mesmo que
 * tenha um `clienteId` preenchido (evita dois saldos divergentes para o
 * mesmo número). Se `pedido.clienteId` vier preenchido e divergir do
 * derivado do telefone, o telefone vence e a divergência fica registrada em
 * log — nunca cria um segundo saldo.
 *
 * Regras aplicadas: só usa o valor dos produtos (total menos taxa de
 * entrega — taxa nunca gera pontos); fidelidade precisa estar ativa na
 * configuração; pontos <= 0 (valor zerado/negativo) não gera movimento.
 *
 * Nunca lança exceção que impeça o chamador de responder — mesma convenção
 * do crédito antigo (`creditarFidelidadePedido`): quem chama deve envolver
 * em try/catch, para que uma falha aqui nunca impeça o pedido de ser salvo
 * como entregue nem a resposta HTTP de ser enviada.
 */
export async function creditarPontosPedidoEntregue(pedido: PedidoParaCreditoPontos): Promise<void> {
  if (pedido.status !== "entregue" || !pedido.id) return;

  const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
  if (!clienteId) return; // sem telefone valido: nunca gera pontos, nunca cria saldo orfao

  if (pedido.clienteId && pedido.clienteId !== clienteId) {
    console.warn(
      `[ChefeBot] Fidelidade: clienteId do pedido ${pedido.id} (${pedido.clienteId}) diverge do telefone (${clienteId}) — usando o telefone como identidade canonica`
    );
  }

  const config = await obterConfigFidelidadePontos();
  if (!config.ativo) return;

  const valorElegivel = Math.max((Number(pedido.total) || 0) - (Number(pedido.taxaEntrega) || 0), 0);
  const pontos = calcularPontosElegiveisPedido({ total: pedido.total ?? 0, taxaEntrega: pedido.taxaEntrega });
  if (pontos <= 0) return;

  await registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: construirEventoIdPontos(pedido.id, "confirmado"),
    pedidoId: pedido.id,
    tipo: "confirmado",
    pontos,
    valorElegivel,
    motivo: `Credito por pedido ${pedido.id} entregue`,
  });
}

/**
 * Leitura de compatibilidade com o modelo antigo (pizzas), exposta para a
 * fase de decisão de migração (ver auditoria técnica aprovada). Não converte
 * pizzas em pontos automaticamente — as unidades não são equivalentes (uma
 * pizza não tem o mesmo valor em R$ sempre). Só expõe o dado antigo,
 * sem apagar nem reescrever nada.
 */
export async function obterSaldoAntigoPizzas(clienteId: string): Promise<number> {
  const progresso = await obterProgressoFidelidade(clienteId);
  return progresso.progresso;
}
