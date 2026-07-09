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
