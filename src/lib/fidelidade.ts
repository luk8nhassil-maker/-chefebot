import { redis } from "./redis";
import { buscarClientePorId, sanitizeTelefoneCliente, clienteIdDoTelefone, type Cliente } from "./clientes";

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
  reservas: ReservaResgatePontos[];
};

function chaveEstadoPontos(clienteId: string): string {
  return `fidelidade:pontos:estado:${clienteId}`;
}

function chaveExtratoPontosLegado(clienteId: string): string {
  return `fidelidade:pontos:extrato:${clienteId}`;
}

export function chaveLockPontos(clienteId: string): string {
  return `fidelidade:pontos:lock:${clienteId}`;
}

function normalizarEstadoPontos(estado: EstadoPontosCliente | null | undefined): EstadoPontosCliente {
  return {
    extrato: Array.isArray(estado?.extrato) ? estado.extrato : [],
    recompensas: Array.isArray(estado?.recompensas) ? estado.recompensas : [],
    reservas: Array.isArray(estado?.reservas) ? estado.reservas : [],
  };
}

function chaveDedupMovimentoPontos(movimento: MovimentoPontos): string {
  if (movimento.eventoId) return `evento:${movimento.eventoId}`;
  if (movimento.movimentoId) return `movimento:${movimento.movimentoId}`;
  if (movimento.pedidoId) return `pedido:${movimento.tipo}:${movimento.pedidoId}`;
  return `sem-chave:${movimento.tipo}:${movimento.createdAt}:${movimento.pontos}`;
}

function unirExtratosPontos(principal: MovimentoPontos[], legado: MovimentoPontos[]): MovimentoPontos[] {
  const unidos: MovimentoPontos[] = [];
  const vistos = new Set<string>();

  for (const movimento of [...principal, ...legado]) {
    const chave = chaveDedupMovimentoPontos(movimento);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unidos.push(movimento);
  }

  return unidos;
}

async function obterEstadoPontos(clienteId: string): Promise<EstadoPontosCliente> {
  const [estadoAtual, extratoLegado] = await Promise.all([
    redis.get<EstadoPontosCliente>(chaveEstadoPontos(clienteId)),
    redis.get<MovimentoPontos[]>(chaveExtratoPontosLegado(clienteId)),
  ]);

  const estado = normalizarEstadoPontos(estadoAtual);
  const legado = Array.isArray(extratoLegado) ? extratoLegado : [];

  // Compatibilidade com o PR #172: ele persistiu movimentos em
  // fidelidade:pontos:extrato:{clienteId}. Enquanto a chave combinada nova
  // ainda nao existir, ou enquanto a chave legada continuar presente, as
  // leituras enxergam os dois formatos. A primeira escrita nova grava o
  // extrato unido dentro de EstadoPontosCliente, sem apagar a chave legada.
  return {
    extrato: unirExtratosPontos(estado.extrato, legado),
    recompensas: estado.recompensas,
    reservas: estado.reservas,
  };
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

// Grava o EstadoPontosCliente só se o lock ainda pertencer a quem está
// gravando — checagem e escrita na MESMA operação atômica (Lua), sem janela
// entre "verificar dono" e "gravar". Isso é o que falta ao compare-and-delete
// sozinho: aquele protege a LIBERAÇÃO do lock, mas sem isto um processo cujo
// TTL expirou ainda poderia escrever o estado depois que outro processo já
// assumiu o mesmo cliente (a escrita em si não checava dono nenhum).
const PERSISTIR_ESTADO_SE_DONO_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("SET", KEYS[2], ARGV[2])
  return 1
else
  return 0
end
`;

/**
 * Grava `EstadoPontosCliente` (extrato + recompensas) SÓ SE a chave de lock
 * do cliente ainda contiver exatamente este `token` — verificação e escrita
 * atômicas via Lua, na mesma operação. Retorna `false` sem escrever nada
 * quando o token não é mais o dono (TTL expirou e outro processo já assumiu
 * o lock): nesse caso o chamador (`registrarMovimentoPontosIdempotente`)
 * lança erro, nunca reporta sucesso — o pedido pode ser reprocessado depois
 * com segurança, porque nada foi escrito (nem o estado, nem qualquer marca
 * de "processado").
 */
export async function persistirEstadoPontosSeDono(
  clienteId: string,
  token: string,
  estado: EstadoPontosCliente
): Promise<boolean> {
  const resultado = await redis.eval(
    PERSISTIR_ESTADO_SE_DONO_SCRIPT,
    [chaveLockPontos(clienteId), chaveEstadoPontos(clienteId)],
    [token, JSON.stringify(estado)]
  );
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
async function comBloqueioCliente<T>(clienteId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const chave = chaveLockPontos(clienteId);
  for (let tentativa = 0; tentativa < LOCK_MAX_TENTATIVAS; tentativa++) {
    const token = gerarTokenLock();
    const obtido = await redis.set(chave, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
    if (obtido) {
      try {
        return await fn(token);
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
 * Estado de uma reserva de resgate (Etapa 5):
 * - reservado: criada, aguardando o checkout confirmar (ou expirar).
 * - confirmado: pedido criado com sucesso usando esta reserva; o movimento
 *   "resgatado" já foi registrado no extrato.
 * - cancelado: descartada antes de confirmar (checkout abandonado) ou
 *   revertida depois de confirmada (pedido cancelado — ver
 *   `reverterResgateConfirmado`).
 * - expirado: passou da validade sem ser confirmada nem cancelada
 *   explicitamente — tratado como cancelada na prática (nunca mais pode ser
 *   confirmada), a diferenciação existe só para auditoria.
 */
export type StatusReservaResgatePontos = "reservado" | "confirmado" | "cancelado" | "expirado";

export type ReservaResgatePontos = {
  resgateId: string;
  clienteId: string;
  recompensaId: string;
  /** Pontos que serão debitados do saldo confirmado quando a reserva for confirmada — sempre a meta vigente no momento da reserva. */
  pontosReservados: number;
  /** Valor máximo de desconto em R$ (valor-base da Pizza Família configurado), calculado na hora da reserva — nunca confia em valor vindo do cliente. */
  valorDescontoMaximo: number;
  status: StatusReservaResgatePontos;
  createdAt: string;
  expiraEm: string;
  /** Preenchido só depois de confirmada. */
  pedidoId?: string;
};

export async function obterReservasResgatePontos(clienteId: string): Promise<ReservaResgatePontos[]> {
  return (await obterEstadoPontos(clienteId)).reservas;
}

const RESERVA_RESGATE_VALIDADE_MINUTOS = 15;

function novaExpiracaoReservaResgate(): string {
  return new Date(Date.now() + RESERVA_RESGATE_VALIDADE_MINUTOS * 60_000).toISOString();
}

function reservaResgateExpirada(reserva: ReservaResgatePontos, agora: Date = new Date()): boolean {
  return new Date(reserva.expiraEm).getTime() < agora.getTime();
}

/**
 * Reserva o resgate de uma recompensa disponível — SEMPRE revalida saldo,
 * meta e configuração atuais no momento da reserva (nunca confia só no
 * `status` salvo da recompensa nem no snapshot de desbloqueio
 * `pontosNaDesbloqueio`). Atômica por cliente, dentro do mesmo lock/escrita
 * condicionada usados pelo crédito — nenhuma escrita se a recompensa não
 * existir, não estiver mais disponível, ou o saldo atual não bater mais a
 * meta. Reserva ativa (não expirada) para a mesma recompensa é devolvida em
 * vez de duplicada. Não desconta pontos aqui — só o resgate CONFIRMADO
 * (`confirmarResgatePontos`) debita o saldo; reserva sozinha nunca move o
 * extrato, então cancelar/deixar expirar uma reserva não confirmada não
 * exige nenhuma restauração.
 */
export async function reservarResgatePontos(clienteId: string, recompensaId: string): Promise<ReservaResgatePontos> {
  return comBloqueioCliente(clienteId, async (token) => {
    const estado = await obterEstadoPontos(clienteId);

    const recompensa = estado.recompensas.find((r) => r.recompensaId === recompensaId);
    if (!recompensa) throw new Error("Recompensa nao encontrada");
    if (recompensa.status !== "disponivel" && recompensa.status !== "notificada") {
      throw new Error("Recompensa nao esta mais disponivel para resgate");
    }

    const config = await obterConfigFidelidadePontos();
    if (!config.ativo) throw new Error("Fidelidade nao esta ativa");
    const meta = calcularMetaPontos(config);
    const saldoAtual = calcularSaldoDoExtrato(estado.extrato);
    if (meta <= 0 || saldoAtual < meta) {
      throw new Error("Saldo atual nao atende mais a meta da recompensa");
    }

    const reservaAtiva = estado.reservas.find(
      (r) => r.recompensaId === recompensaId && r.status === "reservado" && !reservaResgateExpirada(r)
    );
    if (reservaAtiva) return reservaAtiva;

    const valorDescontoMaximo = Number(config.valorPizzaFamiliaReferencia) > 0 ? Number(config.valorPizzaFamiliaReferencia) : 0;

    const reserva: ReservaResgatePontos = {
      resgateId: novoId("rsg"),
      clienteId,
      recompensaId,
      pontosReservados: meta,
      valorDescontoMaximo,
      status: "reservado",
      createdAt: new Date().toISOString(),
      expiraEm: novaExpiracaoReservaResgate(),
    };

    // limpa reservas antigas expiradas da mesma recompensa (nao acumula lixo)
    const reservasFiltradas = estado.reservas.filter(
      (r) => !(r.recompensaId === recompensaId && r.status === "reservado" && reservaResgateExpirada(r))
    );
    const novasReservas = [...reservasFiltradas, reserva];

    const persistiu = await persistirEstadoPontosSeDono(clienteId, token, {
      extrato: estado.extrato,
      recompensas: estado.recompensas,
      reservas: novasReservas,
    });
    if (!persistiu) throw new Error("Fidelidade por pontos: lock expirou antes de reservar — tente novamente");

    return reserva;
  });
}

/**
 * Confirma uma reserva de resgate — SEMPRE junto com a criação real do
 * pedido que a usa. Debita `pontosReservados` do saldo (movimento
 * "resgatado"), marca a recompensa como "resgatada" e a reserva como
 * "confirmado" — tudo na mesma escrita atômica condicionada ao lock.
 * Idempotente por `eventoId` (`resgatado:{pedidoId}:{resgateId}`):
 * reprocessar a confirmação do mesmo pedido/reserva nunca debita duas
 * vezes. Lança erro se a reserva não existir, já não for mais "reservado"
 * (exceto se já confirmada para o MESMO pedido — nesse caso devolve o
 * movimento existente), ou tiver expirado.
 */
export async function confirmarResgatePontos(
  clienteId: string,
  resgateId: string,
  pedidoId: string
): Promise<MovimentoPontos | null> {
  const eventoId = `resgatado:${pedidoId}:${resgateId}`;

  return comBloqueioCliente(clienteId, async (token) => {
    const estado = await obterEstadoPontos(clienteId);
    const jaProcessado = estado.extrato.find((m) => m.eventoId === eventoId);
    if (jaProcessado) return jaProcessado; // reprocessamento idempotente

    const reserva = estado.reservas.find((r) => r.resgateId === resgateId);
    if (!reserva) throw new Error("Reserva de resgate nao encontrada");
    if (reserva.status !== "reservado") throw new Error(`Reserva nao esta mais disponivel para confirmar (status atual: ${reserva.status})`);
    if (reservaResgateExpirada(reserva)) throw new Error("Reserva de resgate expirada");

    const registroSemSaldo: MovimentoPontos = {
      movimentoId: novoId("pt"),
      clienteId,
      pedidoId,
      tipo: "resgatado",
      pontos: reserva.pontosReservados,
      motivo: `Resgate da recompensa ${reserva.recompensaId} no pedido ${pedidoId}`,
      createdAt: new Date().toISOString(),
      eventoId,
    };
    const novoExtrato = [...estado.extrato, registroSemSaldo];
    const saldoApos = calcularSaldoDoExtrato(novoExtrato);
    const registro: MovimentoPontos = { ...registroSemSaldo, saldoApos };
    novoExtrato[novoExtrato.length - 1] = registro;

    const config = await obterConfigFidelidadePontos();
    const meta = calcularMetaPontos(config);
    let novasRecompensas = estado.recompensas.map((r) =>
      r.recompensaId === reserva.recompensaId ? { ...r, status: "resgatada" as StatusRecompensaPontos } : r
    );
    novasRecompensas = aplicarQuedaAbaixoDaMeta(novasRecompensas, meta, saldoApos);

    const novasReservas = estado.reservas.map((r) =>
      r.resgateId === resgateId ? { ...r, status: "confirmado" as StatusReservaResgatePontos, pedidoId } : r
    );

    const persistiu = await persistirEstadoPontosSeDono(clienteId, token, {
      extrato: novoExtrato,
      recompensas: novasRecompensas,
      reservas: novasReservas,
    });
    if (!persistiu) throw new Error("Fidelidade por pontos: lock expirou antes de confirmar o resgate — tente novamente");

    return registro;
  });
}

/**
 * Cancela uma reserva ainda não confirmada — idempotente (cancelar de novo,
 * ou uma reserva que já não existe mais/já expirou, nunca lança erro, só
 * retorna `false`). Como a reserva sozinha nunca debitou pontos, cancelar
 * não precisa devolver nada ao saldo — a recompensa continua "disponivel"
 * (ela nunca deixou de estar) para uma nova tentativa de resgate.
 */
export async function cancelarReservaResgatePontos(clienteId: string, resgateId: string): Promise<boolean> {
  return comBloqueioCliente(clienteId, async (token) => {
    const estado = await obterEstadoPontos(clienteId);
    const reserva = estado.reservas.find((r) => r.resgateId === resgateId);
    if (!reserva || reserva.status !== "reservado") return false;

    const novasReservas = estado.reservas.map((r) =>
      r.resgateId === resgateId ? { ...r, status: "cancelado" as StatusReservaResgatePontos } : r
    );
    return persistirEstadoPontosSeDono(clienteId, token, {
      extrato: estado.extrato,
      recompensas: estado.recompensas,
      reservas: novasReservas,
    });
  });
}

/**
 * Reverte um resgate JÁ CONFIRMADO — usado quando o pedido que o usou é
 * cancelado depois do fato (ex.: pagamento não confirmado, pedido cancelado
 * pelo cliente/painel). Devolve os pontos gastos (movimento "ajuste"
 * positivo, nunca reescreve o "resgatado" original — histórico preservado),
 * e a recompensa volta a ficar "disponivel" para um novo resgate.
 * Idempotente por `eventoId` (`reversao:{resgateId}`): reverter duas vezes
 * nunca devolve pontos duas vezes. Sem efeito (retorna `null`) se a reserva
 * não existir ou não estiver "confirmado".
 */
export async function reverterResgateConfirmado(
  clienteId: string,
  resgateId: string,
  motivo: string
): Promise<MovimentoPontos | null> {
  const eventoId = `reversao-resgate:${resgateId}`;

  return comBloqueioCliente(clienteId, async (token) => {
    const estado = await obterEstadoPontos(clienteId);
    if (estado.extrato.some((m) => m.eventoId === eventoId)) return null; // ja revertido

    const reserva = estado.reservas.find((r) => r.resgateId === resgateId);
    if (!reserva || reserva.status !== "confirmado") return null;

    const registroSemSaldo: MovimentoPontos = {
      movimentoId: novoId("pt"),
      clienteId,
      pedidoId: reserva.pedidoId,
      tipo: "ajuste",
      pontos: reserva.pontosReservados,
      motivo,
      createdAt: new Date().toISOString(),
      eventoId,
    };
    const novoExtrato = [...estado.extrato, registroSemSaldo];
    const saldoApos = calcularSaldoDoExtrato(novoExtrato);
    const registro: MovimentoPontos = { ...registroSemSaldo, saldoApos };
    novoExtrato[novoExtrato.length - 1] = registro;

    const novasRecompensas = estado.recompensas.map((r) =>
      r.recompensaId === reserva.recompensaId && r.status === "resgatada" ? { ...r, status: "disponivel" as StatusRecompensaPontos } : r
    );
    const novasReservas = estado.reservas.map((r) =>
      r.resgateId === resgateId ? { ...r, status: "cancelado" as StatusReservaResgatePontos } : r
    );

    const persistiu = await persistirEstadoPontosSeDono(clienteId, token, {
      extrato: novoExtrato,
      recompensas: novasRecompensas,
      reservas: novasReservas,
    });
    if (!persistiu) throw new Error("Fidelidade por pontos: lock expirou antes de reverter o resgate — tente novamente");

    return registro;
  });
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
 * Revalida recompensas abertas ("disponivel"/"notificada") contra o saldo
 * ATUAL — chamada depois de QUALQUER movimento (estorno, resgate, ajuste
 * negativo, ou mesmo um novo crédito). Se o saldo já não atende mais à meta,
 * a recompensa vira "expirada": nunca é apagada do histórico, só muda de
 * status. Função PURA (não lê/escreve Redis) — o resultado é combinado com
 * o novo extrato e persistido na mesma escrita atômica.
 *
 * Idempotente por natureza: uma vez "expirada", o `some(...)` de recompensa
 * aberta não encontra mais nada para essa recompensa, então reprocessar o
 * mesmo ou outro evento que mantenha o saldo abaixo da meta não muda nada
 * de novo (sem-op seguro, sem necessidade de chave de dedupe própria).
 *
 * Importante: isto mantém o status em sincronia com o saldo no momento de
 * cada movimento, mas NÃO substitui uma revalidação em tempo de resgate —
 * qualquer fluxo futuro de resgate deve sempre recalcular saldo/meta atuais
 * na hora, nunca confiar só neste status salvo ou no snapshot de desbloqueio.
 */
function aplicarQuedaAbaixoDaMeta(
  recompensasAtuais: RecompensaPontosDesbloqueada[],
  meta: number,
  saldoAtual: number
): RecompensaPontosDesbloqueada[] {
  if (meta <= 0) return recompensasAtuais;
  if (saldoAtual >= meta) return recompensasAtuais; // ainda atende a meta, nada muda

  let mudou = false;
  const atualizadas = recompensasAtuais.map((r) => {
    if (r.status === "disponivel" || r.status === "notificada") {
      mudou = true;
      return { ...r, status: "expirada" as StatusRecompensaPontos };
    }
    return r;
  });
  return mudou ? atualizadas : recompensasAtuais;
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

  return comBloqueioCliente(clienteId, async (token) => {
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

    // Recompensas: cruzamento pra cima (desbloqueio) e queda abaixo da meta
    // (expiração) são sempre revalidados a partir do saldo real — nunca só
    // incrementais. Tudo em memória; a escrita real é uma só, abaixo, junto
    // com o extrato.
    const config = await obterConfigFidelidadePontos();
    const meta = calcularMetaPontos(config);
    let novasRecompensas = estado.recompensas;
    if (saldoApos > saldoAnterior) {
      novasRecompensas = aplicarDeteccaoRecompensa(clienteId, novasRecompensas, meta, {
        saldoAnterior,
        saldoAtual: saldoApos,
        pedidoId: evento.pedidoId,
      });
    }
    novasRecompensas = aplicarQuedaAbaixoDaMeta(novasRecompensas, meta, saldoApos);

    const persistiu = await persistirEstadoPontosSeDono(clienteId, token, { extrato: novoExtrato, recompensas: novasRecompensas, reservas: estado.reservas });
    if (!persistiu) {
      // Perdemos a propriedade do lock (TTL expirou e outro processo ja
      // assumiu este cliente) — nada foi escrito. Nunca reportar sucesso
      // nem seguir adiante: quem chama trata como falha best-effort (ver
      // creditarPontosPedidoEntregue) e o pedido pode ser reprocessado
      // depois com seguranca, porque nao existe nenhum estado parcial.
      throw new Error(`Fidelidade por pontos: lock de ${clienteId} expirou antes da escrita — reprocessar depois`);
    }

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
  const sanitizado = normalizarTelefonePontos(telefone);
  if (sanitizado.length < 10) return undefined;
  return clienteIdDoTelefone(sanitizado);
}

function normalizarTelefonePontos(telefone: string): string {
  const sanitizado = sanitizeTelefoneCliente(telefone);
  if ((sanitizado.length === 12 || sanitizado.length === 13) && sanitizado.startsWith("55")) {
    return sanitizado.slice(2);
  }
  return sanitizado;
}

function variantesTelefonePontos(telefone?: string): string[] {
  if (!telefone) return [];
  const sanitizado = sanitizeTelefoneCliente(telefone);
  const normalizado = normalizarTelefonePontos(telefone);
  const variantes = new Set<string>([normalizado, sanitizado]);
  if (normalizado.length >= 10 && !normalizado.startsWith("55")) variantes.add(`55${normalizado}`);
  return [...variantes].filter((v) => v.length >= 10);
}

/**
 * Mascara um identificador (clienteId ou telefone) para uso em log —
 * mostra só os últimos 4 dígitos. Nunca logar clienteId/telefone completos:
 * `clienteId` embute o telefone (`cli_{telefone}`), então vazar o valor
 * inteiro em log equivale a vazar o telefone do cliente.
 */
function mascararIdentidadePontos(valor?: string): string {
  const digitos = (valor ?? "").replace(/\D/g, "");
  return digitos.length >= 4 ? `…${digitos.slice(-4)}` : "…";
}

export type PedidoParaCreditoPontos = {
  id: string;
  status: string;
  telefone?: string;
  clienteId?: string;
  total?: number;
  taxaEntrega?: number;
  criadoEm?: string;
  createdAt?: string;
  pixConfirmado?: boolean;
  pix?: { status?: string } | null;
};

export type OrigemConfirmacaoPontos = "pix_manual" | "pix_automatico" | "pix_webhook" | "confirmacao_operacional";

function timestampCriacaoPedidoMs(pedido: PedidoParaCreditoPontos): number | null {
  for (const candidato of [pedido.criadoEm, pedido.createdAt]) {
    if (!candidato) continue;
    const ms = new Date(candidato).getTime();
    if (Number.isFinite(ms)) return ms;
  }

  const idComoTimestamp = Number(pedido.id);
  if (Number.isFinite(idComoTimestamp) && idComoTimestamp > 0) return idComoTimestamp;
  return null;
}

function pedidoCriadoDepoisDaAtivacao(pedido: PedidoParaCreditoPontos, cliente: Cliente): boolean {
  if (!cliente.pontosAtivos || !cliente.pontosAtivadoEm) return false;
  const ativadoMs = new Date(cliente.pontosAtivadoEm).getTime();
  const pedidoMs = timestampCriacaoPedidoMs(pedido);
  if (!Number.isFinite(ativadoMs)) return false;
  if (pedidoMs === null) return true;
  return pedidoMs >= ativadoMs;
}

async function resolverClienteCanonicoPontos(pedido: PedidoParaCreditoPontos): Promise<{ clienteId: string; cliente: Cliente } | null> {
  const clienteId = derivarClienteIdPorTelefone(pedido.telefone) ?? "";
  if (!clienteId) return null;

  if (pedido.clienteId && pedido.clienteId !== clienteId) {
    console.warn(
      `[ChefeBot] Fidelidade: pedido ${pedido.id} tem clienteId (${mascararIdentidadePontos(pedido.clienteId)}) divergente do telefone (${mascararIdentidadePontos(clienteId)}) - usando o telefone como identidade canonica`
    );
  }

  let cliente: Cliente | null = null;
  for (const variante of variantesTelefonePontos(pedido.telefone)) {
    cliente = await buscarClientePorId(clienteIdDoTelefone(variante));
    if (cliente) break;
  }
  if (!cliente) return null;
  return { clienteId, cliente };
}

export async function confirmarPontosPedido(
  pedido: PedidoParaCreditoPontos,
  origem: OrigemConfirmacaoPontos
): Promise<MovimentoPontos | null> {
  if (!pedido.id || pedido.status === "cancelado") return null;

  const config = await obterConfigFidelidadePontos();
  if (!config.ativo) return null;

  const resolvido = await resolverClienteCanonicoPontos(pedido);
  if (!resolvido) return null;
  const { clienteId, cliente } = resolvido;

  if (!pedidoCriadoDepoisDaAtivacao(pedido, cliente)) return null;

  const valorElegivel = Math.max((Number(pedido.total) || 0) - (Number(pedido.taxaEntrega) || 0), 0);
  const pontos = calcularPontosElegiveisPedido({ total: pedido.total ?? 0, taxaEntrega: pedido.taxaEntrega });
  if (pontos <= 0) return null;

  return registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: construirEventoIdPontos(pedido.id, "confirmado"),
    pedidoId: pedido.id,
    tipo: "confirmado",
    pontos,
    valorElegivel,
    motivo: `Credito por pedido ${pedido.id} confirmado (${origem})`,
  });
}

export async function estornarPontosPedidoConfirmado(pedido: PedidoParaCreditoPontos): Promise<MovimentoPontos | null> {
  if (!pedido.id) return null;

  const clienteId = derivarClienteIdPorTelefone(pedido.telefone) ?? "";
  if (!clienteId) return null;

  const extratoAtual = await obterExtratoPontos(clienteId);
  const confirmado = extratoAtual.find((m) => m.pedidoId === pedido.id && m.tipo === "confirmado");
  if (!confirmado || confirmado.pontos <= 0) return null;

  return registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: construirEventoIdPontos(pedido.id, "estornado"),
    pedidoId: pedido.id,
    tipo: "estornado",
    pontos: confirmado.pontos,
    valorElegivel: confirmado.valorElegivel,
    motivo: `Pedido ${pedido.id} cancelado apos credito confirmado`,
  });
}

function pedidoJaPassouConfirmacaoOperacional(status?: string): boolean {
  return status === "em_preparo" || status === "saiu_entrega" || status === "entregue";
}

export async function reconciliarPontosClientePedidos(
  cliente: Cliente,
  pedidos: PedidoParaCreditoPontos[],
  opcoes: { limite?: number; dias?: number } = {}
): Promise<{ verificados: number; creditados: number }> {
  const clienteId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  if (!cliente.pontosAtivos || !cliente.pontosAtivadoEm || !clienteId) return { verificados: 0, creditados: 0 };

  const limite = Math.max(1, Math.min(opcoes.limite ?? 50, 100));
  const dias = Math.max(1, Math.min(opcoes.dias ?? 90, 365));
  const desdeMs = Date.now() - dias * 24 * 60 * 60 * 1000;
  const telefoneCanonico = normalizarTelefonePontos(cliente.telefone);

  const candidatos = pedidos
    .filter((pedido) => {
      if (!pedido?.id || pedido.status === "cancelado") return false;
      if (derivarClienteIdPorTelefone(pedido.telefone) !== clienteId) return false;
      if (normalizarTelefonePontos(pedido.telefone ?? "") !== telefoneCanonico) return false;
      const criadoMs = timestampCriacaoPedidoMs(pedido);
      if (criadoMs === null || criadoMs < desdeMs) return false;
      return pedido.pixConfirmado === true || pedido.pix?.status === "confirmado" || pedidoJaPassouConfirmacaoOperacional(pedido.status);
    })
    .sort((a, b) => (timestampCriacaoPedidoMs(b) ?? 0) - (timestampCriacaoPedidoMs(a) ?? 0))
    .slice(0, limite);

  let creditados = 0;
  for (const pedido of candidatos) {
    const origem: OrigemConfirmacaoPontos =
      pedido.pixConfirmado === true || pedido.pix?.status === "confirmado" ? "pix_automatico" : "confirmacao_operacional";
    const movimento = await confirmarPontosPedido(pedido, origem);
    if (movimento) creditados++;
  }

  return { verificados: candidatos.length, creditados };
}

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
async function creditarPontosPedidoEntregueComConfig(
  pedido: PedidoParaCreditoPontos,
  config: ConfigFidelidadePontos
): Promise<void> {
  if (pedido.status !== "entregue" || !pedido.id) return;
  if (!config.ativo) return;
  await confirmarPontosPedido(pedido, "confirmacao_operacional");
  return;

  const clienteId = derivarClienteIdPorTelefone(pedido.telefone) ?? "";
  if (!clienteId) return; // sem telefone valido: nunca gera pontos, nunca cria saldo orfao

  if (pedido.clienteId && pedido.clienteId !== clienteId) {
    // Aviso seguro: nunca logar o clienteId (que embute o telefone) nem o
    // telefone em texto pleno — só os últimos 4 dígitos, suficiente para
    // correlacionar em suporte sem expor o número completo em log.
    console.warn(
      `[ChefeBot] Fidelidade: pedido ${pedido.id} tem clienteId (${mascararIdentidadePontos(pedido.clienteId)}) divergente do telefone (${mascararIdentidadePontos(clienteId)}) — usando o telefone como identidade canonica`
    );
  }

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

export async function creditarPontosPedidoEntregue(pedido: PedidoParaCreditoPontos): Promise<void> {
  const config = await obterConfigFidelidadePontos();
  await creditarPontosPedidoEntregueComConfig(pedido, config);
}

export type PedidoParaCreditoFidelidadeEfetiva = PedidoParaCreditoPontos & {
  /** Só usado pelo modelo antigo (pizzas) quando o programa por pontos está desativado. */
  pizzasCount?: number;
};

/**
 * Ponto único de decisão entre os dois modelos de fidelidade ao marcar um
 * pedido como entregue (Nível 6.6.1 — corrige crédito duplo entre modelos).
 * Lê `config:fidelidade:pontos` UMA única vez e decide, de forma
 * centralizada, qual modelo credita:
 * - `ativo === true`  -> só o modelo por pontos credita (o antigo é ignorado
 *   nesta chamada, mesmo que também esteja ativo).
 * - `ativo === false` -> só o modelo antigo credita, respeitando sua própria
 *   config (`creditarFidelidadePedido` já checa `config:fidelidade.ativo`
 *   internamente — se os dois estiverem desativados, nenhum credita).
 *
 * Nunca lê a config duas vezes nem deixa o chamador decidir isso sozinho
 * (evita a leitura dupla/potencialmente inconsistente que existia antes,
 * com `/api/orders` chamando os dois créditos incondicionalmente). Não
 * apaga, não migra e não credita retroativamente nada dos dois modelos —
 * só decide, a partir de agora, qual dos dois pode gerar NOVO crédito.
 */
export async function creditarFidelidadeEfetiva(pedido: PedidoParaCreditoFidelidadeEfetiva): Promise<void> {
  const configPontos = await obterConfigFidelidadePontos();

  if (configPontos.ativo) {
    await creditarPontosPedidoEntregueComConfig(pedido, configPontos);
    return;
  }

  await creditarFidelidadePedido({
    pedidoId: pedido.id,
    clienteId: pedido.clienteId,
    pizzas: pedido.pizzasCount ?? 0,
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

// ============================================================================
// LEITURA — Etapa 3 (API de saldo/progresso/extrato da Área do Cliente)
// Funções puras (não leem/escrevem Redis) para permitir testar cálculo de
// saldo/progresso sem infraestrutura, seguindo o mesmo padrão de
// `calcularSaldoDoExtrato` acima.
// ============================================================================

/**
 * Soma dos pontos "previstos" ainda informativos: só conta o "previsto" de um
 * pedido que AINDA não teve seu evento resolvido (nenhum "confirmado" ou
 * "cancelado" registrado para o mesmo pedidoId no extrato). Um pedido cujo
 * "previsto" já virou "confirmado" ou "cancelado" não deve contar aqui de
 * novo — o valor já está refletido no saldo confirmado (ou foi descartado).
 * Nunca soma ao saldo confirmado — é só a estimativa "isto ainda pode virar
 * saldo".
 */
export function calcularPontosPrevistos(movimentos: MovimentoPontos[]): number {
  if (!Array.isArray(movimentos)) return 0;
  const resolvidos = new Set(
    movimentos
      .filter((m) => (m.tipo === "confirmado" || m.tipo === "cancelado") && m.pedidoId)
      .map((m) => m.pedidoId)
  );
  return movimentos
    .filter((m) => m.tipo === "previsto" && m.pedidoId && !resolvidos.has(m.pedidoId))
    .reduce((soma, m) => soma + m.pontos, 0);
}

export type ProgressoPontos = {
  pontosFaltantes: number;
  /** 0–100, sempre limitado ao intervalo (nunca ultrapassa 100 nem fica negativo). */
  progressoPercentual: number;
  metaAtingida: boolean;
};

/**
 * Progresso do saldo confirmado em relação à meta. Sem meta válida (<= 0),
 * retorna um progresso neutro (0%, não atingida) — meta é responsabilidade de
 * configuração, esta função não decide um valor padrão.
 */
export function calcularProgressoPontos(saldo: number, meta: number): ProgressoPontos {
  const saldoSeguro = Number.isFinite(saldo) && saldo > 0 ? saldo : 0;
  const metaSegura = Number.isFinite(meta) && meta > 0 ? meta : 0;
  if (metaSegura <= 0) {
    return { pontosFaltantes: 0, progressoPercentual: 0, metaAtingida: false };
  }
  const pontosFaltantes = Math.max(metaSegura - saldoSeguro, 0);
  const progressoPercentual = Math.min(100, Math.max(0, Math.floor((saldoSeguro / metaSegura) * 100)));
  return { pontosFaltantes, progressoPercentual, metaAtingida: saldoSeguro >= metaSegura };
}

/**
 * Extrato ordenado do mais recente para o mais antigo. Não muta a lista
 * recebida.
 */
export function ordenarExtratoPontosDesc(movimentos: MovimentoPontos[]): MovimentoPontos[] {
  if (!Array.isArray(movimentos)) return [];
  return [...movimentos].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
