import { redis } from "./redis";

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
export type TipoMovimentoPontos =
  | "previsto"
  | "confirmado"
  | "cancelado"
  | "estornado"
  | "resgatado"
  | "ajuste"
  /** Restitui pontos de um resgate (`resgatado`) cujo pedido foi cancelado
   * antes de ser concluído — o cliente nunca chegou a receber a recompensa.
   * Aditivo: nunca reescreve o movimento `resgatado` original. */
  | "resgate_estornado";

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
};

export type SaldoPontos = {
  /** Pontos confirmados e ainda não resgatados/estornados. Nunca inclui "previstos". */
  disponivel: number;
};

/**
 * Recompensa resgatável configurada pelo admin — Etapa 5, aditivo dentro de
 * `ConfigFidelidadePontos`. Dois tipos suportados:
 * - `desconto_fixo`: valor fixo em centavos, limitado ao subtotal elegível
 *   (nunca desconta a taxa de entrega, nunca gera total negativo).
 * - `pizza_gratis`: aplica ao item de menor preço com `kind === "pizza"` no
 *   carrinho (identificação estrutural, nunca por texto), limitado a
 *   `valorMaximoCentavos` quando informado.
 */
export type TipoRecompensaPontos = "desconto_fixo" | "pizza_gratis";

export type RecompensaPontosConfig = {
  ativa: boolean;
  /** Custo em pontos para resgatar esta recompensa. */
  custoPontos: number;
  tipo: TipoRecompensaPontos;
  /** Texto apresentado ao cliente (ex.: "R$20 de desconto", "1 Pizza Família grátis"). */
  descricao: string;
  /** Obrigatório para `desconto_fixo`. */
  valorDescontoCentavos?: number;
  /** Opcional para `pizza_gratis` — teto de valor descontado. */
  valorMaximoCentavos?: number;
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
  /** Recompensa resgatável — opcional, aditiva (Etapa 5). Sem ela, o resgate fica indisponível. */
  recompensa?: RecompensaPontosConfig;
};

export const CONFIG_FIDELIDADE_PONTOS_PADRAO: ConfigFidelidadePontos = {
  ativo: false,
  metaPontos: 720,
  valorPizzaFamiliaReferencia: 60,
  metaPizzasFamilia: 12,
  descricaoRecompensa: "1 Pizza Família",
};

const CHAVE_CONFIG_PONTOS = "config:fidelidade:pontos";

function chaveExtratoPontos(clienteId: string): string {
  return `fidelidade:pontos:extrato:${clienteId}`;
}

function chaveEventoPontos(eventoId: string): string {
  return `fidelidade:pontos:evento:${eventoId}`;
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
      case "resgate_estornado":
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
  return (await redis.get<MovimentoPontos[]>(chaveExtratoPontos(clienteId))) ?? [];
}

export async function obterSaldoPontos(clienteId: string): Promise<SaldoPontos> {
  const extrato = await obterExtratoPontos(clienteId);
  return { disponivel: calcularSaldoDoExtrato(extrato) };
}

/**
 * Registra um movimento de pontos de forma idempotente. A prevenção de
 * duplicidade NÃO depende exclusivamente de (pedidoId, tipo): quem chama pode
 * informar um `eventoId` explícito (ex.: para diferenciar um estorno parcial
 * de outro, ou dois ajustes manuais no mesmo pedido) — só quando `eventoId`
 * não é informado é que cai no padrão derivado `${tipo}:${pedidoId}` (mesmo
 * comportamento simples de antes, preservado para o caso comum de 1 evento
 * por tipo por pedido). A mesma chave nunca é processada duas vezes (SET NX,
 * mesmo padrão já usado no crédito antigo). Não decide regra de negócio
 * (quando um "previsto" vira "confirmado", ou quando um "confirmado" precisa
 * de um "estornado", por exemplo) — isso é responsabilidade de quem chama,
 * na etapa que conectar ao fluxo real de pedidos. Retorna `null` quando o
 * evento já tinha sido registrado antes; o movimento criado caso contrário.
 */
export async function registrarMovimentoPontosIdempotente(
  clienteId: string,
  evento: { eventoId?: string; pedidoId: string; tipo: TipoMovimentoPontos; pontos: number; motivo: string }
): Promise<MovimentoPontos | null> {
  const eventoId = evento.eventoId ?? construirEventoIdPontos(evento.pedidoId, evento.tipo);
  const marcou = await redis.set(chaveEventoPontos(eventoId), true, { nx: true });
  if (!marcou) return null;

  const extrato = await obterExtratoPontos(clienteId);
  const registro: MovimentoPontos = {
    movimentoId: novoId("pt"),
    clienteId,
    pedidoId: evento.pedidoId,
    tipo: evento.tipo,
    pontos: evento.pontos,
    motivo: evento.motivo,
    createdAt: new Date().toISOString(),
    eventoId,
  };
  await redis.set(chaveExtratoPontos(clienteId), [...extrato, registro]);
  return registro;
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

// ============================================================================
// RESGATE — Etapa 5 (reserva + aplicação segura da recompensa no pedido)
// Fluxo: reserva (bloqueia pontos + trava concorrência por lock curto) →
// checkout recebe só o resgateId → aplicação recalcula tudo no servidor no
// momento da criação do pedido → cancelamento restitui uma única vez.
// ============================================================================

export type StatusResgate = "reservado" | "aplicado" | "cancelado" | "expirado" | "estornado";

export type Resgate = {
  resgateId: string;
  clienteId: string;
  status: StatusResgate;
  tipoRecompensa: TipoRecompensaPontos;
  pontosUtilizados: number;
  /** Só preenchido quando `status === 'aplicado'` — calculado no servidor na aplicação. */
  valorAplicadoCentavos: number;
  criadoEm: string;
  expiraEm: string;
  pedidoId?: string;
};

const RESERVA_TTL_MINUTOS = 15;
const LOCK_TTL_SEGUNDOS = 5;

function chaveResgate(resgateId: string): string {
  return `fidelidade:pontos:resgate:${resgateId}`;
}
function chaveResgatesCliente(clienteId: string): string {
  return `fidelidade:pontos:resgates:${clienteId}`;
}
function chaveLockResgate(clienteId: string): string {
  return `fidelidade:pontos:lock:${clienteId}`;
}

async function salvarResgate(resgate: Resgate): Promise<void> {
  await redis.set(chaveResgate(resgate.resgateId), resgate);
  const lista = (await redis.get<string[]>(chaveResgatesCliente(resgate.clienteId))) ?? [];
  if (!lista.includes(resgate.resgateId)) {
    await redis.set(chaveResgatesCliente(resgate.clienteId), [...lista, resgate.resgateId]);
  }
}

export async function obterResgatePorId(resgateId: string): Promise<Resgate | null> {
  return (await redis.get<Resgate>(chaveResgate(resgateId))) ?? null;
}

/**
 * Marca uma reserva como expirada quando detectada vencida fora do fluxo
 * normal de `aplicarResgateAoPedido` (ex.: numa prévia somente-leitura que
 * bloqueia o uso, mas ainda quer refletir o estado real no extrato de
 * resgates do cliente). Só age se o resgate ainda está `reservado` e
 * realmente venceu — nunca sobrescreve um resgate já aplicado/cancelado.
 */
export async function marcarResgateExpiradoSeVencido(resgateId: string): Promise<void> {
  const resgate = await obterResgatePorId(resgateId);
  if (!resgate || resgate.status !== "reservado") return;
  if (new Date(resgate.expiraEm).getTime() >= Date.now()) return;
  await salvarResgate({ ...resgate, status: "expirado" });
}

/** Lista os resgates do cliente, mais recente primeiro. */
export async function obterResgatesCliente(clienteId: string): Promise<Resgate[]> {
  const ids = (await redis.get<string[]>(chaveResgatesCliente(clienteId))) ?? [];
  const resgates = await Promise.all(ids.map((id) => obterResgatePorId(id)));
  return resgates
    .filter((r): r is Resgate => !!r)
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
}

/**
 * Cria uma reserva de resgate para o cliente, validando saldo e configuração
 * no servidor. Usa um lock curto por cliente (`SET NX` com expiração) para
 * evitar duas reservas simultâneas disputando o mesmo saldo — o lock é
 * sempre liberado ao final da operação (sucesso ou erro), nunca preso
 * indefinidamente (expira sozinho em `LOCK_TTL_SEGUNDOS` mesmo se o processo
 * cair antes do `finally`).
 */
export async function criarReservaResgate(clienteId: string): Promise<{ ok: true; resgate: Resgate } | { ok: false; error: string }> {
  const lockKey = chaveLockResgate(clienteId);
  const obtido = await redis.set(lockKey, true, { nx: true, ex: LOCK_TTL_SEGUNDOS });
  if (!obtido) return { ok: false, error: "Já existe uma solicitação de resgate em andamento" };

  try {
    const config = await obterConfigFidelidadePontos();
    const recompensa = config.recompensa;
    if (!recompensa || !recompensa.ativa) return { ok: false, error: "Recompensa indisponível" };
    if (!Number.isFinite(recompensa.custoPontos) || recompensa.custoPontos <= 0) {
      return { ok: false, error: "Recompensa mal configurada" };
    }

    const saldo = await obterSaldoPontos(clienteId);
    if (saldo.disponivel < recompensa.custoPontos) {
      return { ok: false, error: "Saldo de pontos insuficiente" };
    }

    const agora = new Date();
    const resgate: Resgate = {
      resgateId: novoId("res"),
      clienteId,
      status: "reservado",
      tipoRecompensa: recompensa.tipo,
      pontosUtilizados: recompensa.custoPontos,
      valorAplicadoCentavos: 0,
      criadoEm: agora.toISOString(),
      expiraEm: new Date(agora.getTime() + RESERVA_TTL_MINUTOS * 60000).toISOString(),
    };
    await salvarResgate(resgate);
    return { ok: true, resgate };
  } finally {
    await redis.del(lockKey);
  }
}

/**
 * Cancela uma reserva ainda não aplicada. Só o dono pode cancelar; reservas
 * já aplicadas a um pedido não podem ser canceladas manualmente.
 */
export async function cancelarReservaResgate(clienteId: string, resgateId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const resgate = await obterResgatePorId(resgateId);
  if (!resgate || resgate.clienteId !== clienteId) return { ok: false, error: "Resgate não encontrado" };
  if (resgate.status !== "reservado") return { ok: false, error: "Este resgate não pode mais ser cancelado" };
  await salvarResgate({ ...resgate, status: "cancelado" });
  return { ok: true };
}

export type ItemCarrinhoElegibilidade = { kind?: string; price: number; qty: number };

/**
 * Calcula o valor do desconto no servidor a partir do carrinho real e da
 * configuração atual — nunca aceita o valor vindo do cliente. Função pura,
 * não lê/escreve Redis.
 * - `desconto_fixo`: valor configurado, limitado ao subtotal elegível
 *   (nunca gera desconto maior que o próprio subtotal).
 * - `pizza_gratis`: identifica a pizza pela estrutura (`kind === "pizza"`),
 *   nunca por nome/texto. Com mais de uma pizza elegível, aplica à de menor
 *   preço (nunca dá mais benefício que o configurado). Sem pizza no
 *   carrinho, retorna erro — nunca inventa um valor.
 */
export function calcularDescontoRecompensa(params: {
  recompensa: RecompensaPontosConfig;
  itens: ItemCarrinhoElegibilidade[];
  /** Subtotal dos produtos, SEM taxa de entrega. */
  subtotalElegivel: number;
}): { valorDescontoCentavos: number; erro?: string } {
  const { recompensa, itens, subtotalElegivel } = params;
  const subtotalSeguro = Number.isFinite(subtotalElegivel) && subtotalElegivel > 0 ? subtotalElegivel : 0;
  const subtotalCentavos = Math.round(subtotalSeguro * 100);

  if (recompensa.tipo === "desconto_fixo") {
    const valor = Number(recompensa.valorDescontoCentavos) || 0;
    if (valor <= 0) return { valorDescontoCentavos: 0, erro: "Recompensa mal configurada" };
    const desconto = Math.min(valor, subtotalCentavos);
    if (desconto <= 0) return { valorDescontoCentavos: 0, erro: "Nada elegível para desconto" };
    return { valorDescontoCentavos: desconto };
  }

  if (recompensa.tipo === "pizza_gratis") {
    const pizzas = (Array.isArray(itens) ? itens : []).filter(
      (i) => i?.kind === "pizza" && Number.isFinite(i.price) && i.price > 0
    );
    if (pizzas.length === 0) return { valorDescontoCentavos: 0, erro: "Nenhuma pizza elegível no carrinho" };
    const maisBarata = pizzas.reduce((menor, atual) => (atual.price < menor.price ? atual : menor));
    let desconto = Math.round(maisBarata.price * 100);
    if (Number.isFinite(recompensa.valorMaximoCentavos) && (recompensa.valorMaximoCentavos as number) > 0) {
      desconto = Math.min(desconto, recompensa.valorMaximoCentavos as number);
    }
    desconto = Math.min(desconto, subtotalCentavos);
    if (desconto <= 0) return { valorDescontoCentavos: 0, erro: "Nada elegível para desconto" };
    return { valorDescontoCentavos: desconto };
  }

  return { valorDescontoCentavos: 0, erro: "Tipo de recompensa desconhecido" };
}

/**
 * Aplica um resgate reservado a um pedido em criação. Nunca confia em valor
 * de desconto, quantidade de pontos ou tipo de recompensa vindos do cliente —
 * recalcula tudo a partir do carrinho e da configuração atuais no servidor.
 * Idempotente por pedidoId: reprocessar a mesma criação de pedido nunca
 * debita pontos duas vezes.
 */
export async function aplicarResgateAoPedido(params: {
  resgateId: string;
  clienteId: string;
  pedidoId: string;
  itens: ItemCarrinhoElegibilidade[];
  subtotalElegivel: number;
}): Promise<{ ok: true; valorDescontoCentavos: number } | { ok: false; error: string }> {
  const { resgateId, clienteId, pedidoId, itens, subtotalElegivel } = params;
  const resgate = await obterResgatePorId(resgateId);
  if (!resgate || resgate.clienteId !== clienteId) return { ok: false, error: "Resgate inválido" };

  if (resgate.status === "aplicado" && resgate.pedidoId === pedidoId) {
    return { ok: true, valorDescontoCentavos: resgate.valorAplicadoCentavos };
  }
  if (resgate.status !== "reservado") return { ok: false, error: "Resgate não está disponível" };
  if (new Date(resgate.expiraEm).getTime() < Date.now()) {
    await salvarResgate({ ...resgate, status: "expirado" });
    return { ok: false, error: "Resgate expirado" };
  }

  const config = await obterConfigFidelidadePontos();
  const recompensa = config.recompensa;
  if (!recompensa || !recompensa.ativa || recompensa.tipo !== resgate.tipoRecompensa) {
    return { ok: false, error: "Recompensa indisponível" };
  }

  const saldo = await obterSaldoPontos(clienteId);
  if (saldo.disponivel < resgate.pontosUtilizados) {
    return { ok: false, error: "Saldo de pontos insuficiente" };
  }

  const { valorDescontoCentavos, erro } = calcularDescontoRecompensa({ recompensa, itens, subtotalElegivel });
  if (erro || valorDescontoCentavos <= 0) {
    return { ok: false, error: erro || "Recompensa não aplicável a este pedido" };
  }

  // Idempotente: reprocessar a mesma criação de pedido (mesmo pedidoId) nunca
  // registra o débito duas vezes — `registro === null` na segunda tentativa.
  await registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: construirEventoIdPontos(pedidoId, "resgatado"),
    pedidoId,
    tipo: "resgatado",
    pontos: resgate.pontosUtilizados,
    motivo: `Resgate de recompensa no pedido ${pedidoId}`,
  });

  await salvarResgate({ ...resgate, status: "aplicado", pedidoId, valorAplicadoCentavos: valorDescontoCentavos });
  return { ok: true, valorDescontoCentavos };
}

/**
 * Restitui os pontos de um resgate já aplicado quando o pedido correspondente
 * é cancelado antes de o cliente receber a recompensa. Idempotente por
 * pedidoId (eventoId próprio, tipo `resgate_estornado`) — nunca restitui duas
 * vezes nem apaga o movimento `resgatado` original.
 */
export async function restaurarPontosResgate(params: { clienteId: string; resgateId: string; pedidoId: string }): Promise<void> {
  const { clienteId, resgateId, pedidoId } = params;
  const resgate = await obterResgatePorId(resgateId);
  if (!resgate || resgate.clienteId !== clienteId) return;
  if (resgate.status !== "aplicado") return;

  const registro = await registrarMovimentoPontosIdempotente(clienteId, {
    eventoId: construirEventoIdPontos(pedidoId, "resgate_estornado"),
    pedidoId,
    tipo: "resgate_estornado",
    pontos: resgate.pontosUtilizados,
    motivo: `Pontos restituídos — pedido ${pedidoId} cancelado após resgate`,
  });
  if (registro) {
    await salvarResgate({ ...resgate, status: "estornado" });
  }
}
