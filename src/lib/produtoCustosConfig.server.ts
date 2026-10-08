import "server-only";

import { redis } from "./redis";
import { avaliarCoberturaCustos, calcularCustoProduto, contarVendasPorProduto, type CoberturaCustos, type IngredienteCusto, type ReceitaProduto } from "./produtoCustos";

const CHAVE = "config:produto-custos:v1";
const LIMITE_COBERTURA_PERCENT = 90;

export type ConfigCustosProdutos = {
  ingredientes: IngredienteCusto[];
  receitas: ReceitaProduto[];
  atualizadoEm: string;
};

export type ResumoCustosProdutos = {
  config: ConfigCustosProdutos;
  produtos: ReturnType<typeof calcularCustoProduto>[];
  cobertura: CoberturaCustos;
  vendasAnalisadas: number;
};

const VAZIO: ConfigCustosProdutos = { ingredientes: [], receitas: [], atualizadoEm: "" };

function textoSeguro(valor: unknown, limite: number): string {
  return typeof valor === "string" ? valor.trim().slice(0, limite) : "";
}

function numeroPositivo(valor: unknown): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function numeroNaoNegativo(valor: unknown): number | null {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

export function validarIngrediente(valor: unknown): IngredienteCusto | null {
  if (!valor || typeof valor !== "object") return null;
  const item = valor as Record<string, unknown>;
  const unidadeCompra = item.unidadeCompra;
  if (unidadeCompra !== "g" && unidadeCompra !== "kg" && unidadeCompra !== "ml" && unidadeCompra !== "l" && unidadeCompra !== "un") return null;
  const quantidadeCompra = numeroPositivo(item.quantidadeCompra);
  const precoCompraCents = numeroNaoNegativo(item.precoCompraCents);
  const aproveitamentoPercent = numeroPositivo(item.aproveitamentoPercent ?? 100);
  const id = textoSeguro(item.id, 80);
  const nome = textoSeguro(item.nome, 120);
  if (!id || !nome || quantidadeCompra === null || precoCompraCents === null || aproveitamentoPercent === null || aproveitamentoPercent > 100) return null;
  return {
    id,
    nome,
    quantidadeCompra,
    unidadeCompra,
    precoCompraCents: Math.round(precoCompraCents),
    aproveitamentoPercent,
    atualizadoEm: textoSeguro(item.atualizadoEm, 40) || new Date().toISOString(),
  };
}

export function validarReceita(valor: unknown): ReceitaProduto | null {
  if (!valor || typeof valor !== "object") return null;
  const item = valor as Record<string, unknown>;
  const id = textoSeguro(item.produtoId, 120);
  const nomeProduto = textoSeguro(item.nomeProduto, 160);
  const precoVendaCents = numeroNaoNegativo(item.precoVendaCents);
  const embalagemCustoCents = numeroNaoNegativo(item.embalagemCustoCents ?? 0);
  const taxaVendaPercent = numeroNaoNegativo(item.taxaVendaPercent ?? 0);
  const componentesBrutos = Array.isArray(item.componentes) ? item.componentes : null;
  if (!id || !nomeProduto || precoVendaCents === null || embalagemCustoCents === null || taxaVendaPercent === null || taxaVendaPercent > 100 || !componentesBrutos || componentesBrutos.length > 80) return null;
  const componentes = componentesBrutos.map((bruto) => {
    if (!bruto || typeof bruto !== "object") return null;
    const componente = bruto as Record<string, unknown>;
    const unidade = componente.unidade;
    if (unidade !== "g" && unidade !== "ml" && unidade !== "un") return null;
    const quantidade = numeroPositivo(componente.quantidade);
    const ingredienteId = textoSeguro(componente.ingredienteId, 80);
    return ingredienteId && quantidade !== null ? { ingredienteId, quantidade, unidade } : null;
  });
  if (componentes.some((item) => item === null)) return null;
  return {
    produtoId: id,
    nomeProduto,
    precoVendaCents: Math.round(precoVendaCents),
    componentes: componentes as ReceitaProduto["componentes"],
    embalagemCustoCents,
    taxaVendaPercent,
    ativo: item.ativo !== false,
  };
}

export async function obterConfigCustosProdutos(): Promise<ConfigCustosProdutos> {
  const salvo = await redis.get<Partial<ConfigCustosProdutos>>(CHAVE);
  if (!salvo || typeof salvo !== "object") return VAZIO;
  return {
    ingredientes: Array.isArray(salvo.ingredientes) ? salvo.ingredientes.map(validarIngrediente).filter((item): item is IngredienteCusto => item !== null) : [],
    receitas: Array.isArray(salvo.receitas) ? salvo.receitas.map(validarReceita).filter((item): item is ReceitaProduto => item !== null) : [],
    atualizadoEm: typeof salvo.atualizadoEm === "string" ? salvo.atualizadoEm : "",
  };
}

export async function salvarConfigCustosProdutos(config: ConfigCustosProdutos): Promise<void> {
  await redis.set(CHAVE, { ...config, atualizadoEm: new Date().toISOString() });
}

export function resumirConfigCustosProdutos(config: ConfigCustosProdutos, vendasPorProduto: Record<string, number> = {}): ResumoCustosProdutos {
  const mapa = Object.fromEntries(config.ingredientes.map((item) => [item.id, item]));
  const produtos = config.receitas.filter((item) => item.ativo).map((receita) => calcularCustoProduto(receita, mapa));
  const vendasAnalisadas = Object.values(vendasPorProduto).reduce((soma, quantidade) => soma + Math.max(0, quantidade), 0);
  return { config, produtos, cobertura: avaliarCoberturaCustos(produtos, vendasPorProduto, LIMITE_COBERTURA_PERCENT), vendasAnalisadas };
}

/** Faz uma única leitura da lista operacional somente quando há receitas. */
export async function resumirConfigCustosProdutosComHistorico(config: ConfigCustosProdutos): Promise<ResumoCustosProdutos> {
  if (config.receitas.length === 0) return resumirConfigCustosProdutos(config);
  try {
    const pedidos = await redis.get<Array<{ status?: string; snapshotOficial?: unknown }>>("pedidos");
    return resumirConfigCustosProdutos(config, contarVendasPorProduto(Array.isArray(pedidos) ? pedidos : []));
  } catch {
    // Falta de leitura nunca derruba o painel nem libera margem por engano.
    return resumirConfigCustosProdutos(config);
  }
}

export const limiteCoberturaCustosPercent = LIMITE_COBERTURA_PERCENT;
