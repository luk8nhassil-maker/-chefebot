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
 *   estimativa "este pedido renderá X pontos").
 * - confirmado: pedido chegou a "entregue" — pontos passam a valer no saldo.
 * - cancelado: pedido previsto que não virou confirmado (pedido cancelado);
 *   fica registrado no extrato para transparência, nunca some silenciosamente.
 * - resgatado: débito de pontos por resgate de recompensa.
 * - ajuste: correção manual (positiva ou negativa), fora do fluxo automático.
 */
export type TipoMovimentoPontos = "previsto" | "confirmado" | "cancelado" | "resgatado" | "ajuste";

export type MovimentoPontos = {
  movimentoId: string;
  clienteId: string;
  pedidoId?: string;
  tipo: TipoMovimentoPontos;
  pontos: number;
  motivo: string;
  createdAt: string;
};

export type SaldoPontos = {
  /** Pontos confirmados e ainda não resgatados. Nunca inclui "previstos". */
  disponivel: number;
};

export type ConfigFidelidadePontos = {
  ativo: boolean;
  /** Valor de referência da Pizza Família usado para calcular a meta (ex.: 60). */
  valorPizzaFamiliaReferencia: number;
  /** Quantas Pizzas Família a meta equivale (ex.: 12). */
  metaPizzasFamilia: number;
  descricaoRecompensa: string;
  validadeDias?: number;
};

export const CONFIG_FIDELIDADE_PONTOS_PADRAO: ConfigFidelidadePontos = {
  ativo: false,
  valorPizzaFamiliaReferencia: 60,
  metaPizzasFamilia: 12,
  descricaoRecompensa: "1 Pizza Família",
};

const CHAVE_CONFIG_PONTOS = "config:fidelidade:pontos";

function chaveExtratoPontos(clienteId: string): string {
  return `fidelidade:pontos:extrato:${clienteId}`;
}

function chaveEventoPontos(pedidoId: string, tipo: TipoMovimentoPontos): string {
  return `fidelidade:pontos:evento:${tipo}:${pedidoId}`;
}

/** Meta em pontos = valor de referência × quantidade de Pizzas Família. Entrada inválida (<=0) retorna 0. */
export function calcularMetaPontos(
  config: Pick<ConfigFidelidadePontos, "valorPizzaFamiliaReferencia" | "metaPizzasFamilia">
): number {
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
 * nunca afetam o saldo (são só registro/transparência); "confirmado" soma;
 * "resgatado" subtrai; "ajuste" soma o valor informado (pode ser negativo).
 * Função pura — não lê nem escreve Redis — para permitir testar saldo
 * residual e comportamento de cada tipo sem infraestrutura.
 */
export function calcularSaldoDoExtrato(movimentos: MovimentoPontos[]): number {
  if (!Array.isArray(movimentos)) return 0;
  return movimentos.reduce((saldo, mov) => {
    switch (mov.tipo) {
      case "confirmado":
        return saldo + mov.pontos;
      case "resgatado":
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
 * Registra um movimento de pontos de forma idempotente por (pedidoId, tipo):
 * a mesma combinação nunca é processada duas vezes (SET NX, mesmo padrão já
 * usado no crédito antigo por pedidoId). Não decide regra de negócio (quando
 * um "previsto" vira "confirmado", por exemplo) — isso é responsabilidade de
 * quem chama, na etapa que conectar ao fluxo real de pedidos. Retorna `null`
 * quando o evento já tinha sido registrado antes; o movimento criado caso
 * contrário.
 */
export async function registrarMovimentoPontosIdempotente(
  clienteId: string,
  evento: { pedidoId: string; tipo: TipoMovimentoPontos; pontos: number; motivo: string }
): Promise<MovimentoPontos | null> {
  const marcou = await redis.set(chaveEventoPontos(evento.pedidoId, evento.tipo), true, { nx: true });
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
