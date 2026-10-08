/**
 * Regras puras para custo de produto. Este módulo não lê Redis e não conhece
 * telas: pode ser usado pelo robô, pela API e por testes sem gerar leituras
 * extras. Valores de compra ficam em centavos; quantidades usam a unidade
 * indicada no cadastro.
 */

export type UnidadeCompra = "g" | "kg" | "ml" | "l" | "un";
export type UnidadeReceita = "g" | "ml" | "un";

export type IngredienteCusto = {
  id: string;
  nome: string;
  quantidadeCompra: number;
  unidadeCompra: UnidadeCompra;
  precoCompraCents: number;
  aproveitamentoPercent: number;
  atualizadoEm: string;
};

export type ComponenteReceita = {
  ingredienteId: string;
  quantidade: number;
  unidade: UnidadeReceita;
};

export type ReceitaProduto = {
  produtoId: string;
  nomeProduto: string;
  precoVendaCents: number;
  componentes: ComponenteReceita[];
  embalagemCustoCents: number;
  taxaVendaPercent: number;
  ativo: boolean;
};

export type CustoProduto = {
  produtoId: string;
  nomeProduto: string;
  precoVendaCents: number;
  ingredientesCents: number | null;
  embalagemCustoCents: number | null;
  taxasCents: number | null;
  custoDiretoCents: number | null;
  sobraCents: number | null;
  completo: boolean;
  faltantes: string[];
};

export type CoberturaCustos = {
  modo: "sem_margem" | "margem_parcial" | "margem_ativa";
  produtosCompletos: number;
  produtosTotal: number;
  vendasCobertasPercent: number;
  produtosIncompletos: string[];
  motivo: string;
};

const UNIDADES_BASE: Record<UnidadeCompra, { unidade: UnidadeReceita; fator: number }> = {
  g: { unidade: "g", fator: 1 },
  kg: { unidade: "g", fator: 1000 },
  ml: { unidade: "ml", fator: 1 },
  l: { unidade: "ml", fator: 1000 },
  un: { unidade: "un", fator: 1 },
};

function numeroValido(valor: number): boolean {
  return Number.isFinite(valor) && valor > 0;
}

function arredondar(valor: number): number {
  return Math.max(0, Math.round(valor));
}

/** Custo por grama, ml ou unidade aproveitável. */
export function custoPorUnidadeBase(ingrediente: IngredienteCusto): number | null {
  const conversao = UNIDADES_BASE[ingrediente.unidadeCompra];
  if (!conversao || !numeroValido(ingrediente.quantidadeCompra) || !Number.isFinite(ingrediente.precoCompraCents) || ingrediente.precoCompraCents < 0) return null;
  const aproveitamento = Number.isFinite(ingrediente.aproveitamentoPercent) ? ingrediente.aproveitamentoPercent : 0;
  if (aproveitamento <= 0 || aproveitamento > 100) return null;
  const quantidadeAproveitavel = ingrediente.quantidadeCompra * conversao.fator * (aproveitamento / 100);
  return quantidadeAproveitavel > 0 ? ingrediente.precoCompraCents / quantidadeAproveitavel : null;
}

export function calcularCustoProduto(
  receita: ReceitaProduto,
  ingredientes: Map<string, IngredienteCusto> | Record<string, IngredienteCusto>,
): CustoProduto {
  let ingredientesCents = 0;
  const faltantes: string[] = [];
  const localizar = (id: string) => ingredientes instanceof Map ? ingredientes.get(id) : ingredientes[id];

  for (const componente of receita.componentes) {
    const ingrediente = localizar(componente.ingredienteId);
    const custo = ingrediente ? custoPorUnidadeBase(ingrediente) : null;
    const unidadeBase = ingrediente ? UNIDADES_BASE[ingrediente.unidadeCompra]?.unidade : null;
    if (custo === null || unidadeBase !== componente.unidade || !numeroValido(componente.quantidade)) {
      if (!faltantes.includes(componente.ingredienteId)) faltantes.push(componente.ingredienteId);
      continue;
    }
    ingredientesCents += custo * componente.quantidade;
  }

  const completo = faltantes.length === 0 && receita.componentes.length > 0 && Number.isFinite(receita.embalagemCustoCents) && receita.embalagemCustoCents >= 0;
  if (!completo) {
    return {
      produtoId: receita.produtoId,
      nomeProduto: receita.nomeProduto,
      precoVendaCents: receita.precoVendaCents,
      ingredientesCents: null,
      embalagemCustoCents: null,
      taxasCents: null,
      custoDiretoCents: null,
      sobraCents: null,
      completo: false,
      faltantes,
    };
  }

  const embalagemCustoCents = arredondar(receita.embalagemCustoCents);
  const taxaPercent = Number.isFinite(receita.taxaVendaPercent) && receita.taxaVendaPercent >= 0 ? receita.taxaVendaPercent : 0;
  const taxasCents = arredondar(receita.precoVendaCents * (taxaPercent / 100));
  const custoDiretoCents = arredondar(ingredientesCents) + embalagemCustoCents + taxasCents;
  return {
    produtoId: receita.produtoId,
    nomeProduto: receita.nomeProduto,
    precoVendaCents: receita.precoVendaCents,
    ingredientesCents: arredondar(ingredientesCents),
    embalagemCustoCents,
    taxasCents,
    custoDiretoCents,
    sobraCents: receita.precoVendaCents - custoDiretoCents,
    completo: true,
    faltantes,
  };
}

/**
 * A campanha só pode usar margem em produtos completos. O modo geral é
 * liberado quando os produtos completos cobrem pelo menos 90% das vendas;
 * sem vendas informadas, fica parcial para não inventar cobertura.
 */
export function avaliarCoberturaCustos(
  custos: CustoProduto[],
  vendasPorProduto: Record<string, number> = {},
  coberturaMinimaPercent = 90,
): CoberturaCustos {
  const ativos = custos;
  const completos = ativos.filter((item) => item.completo);
  const incompletos = ativos.filter((item) => !item.completo).map((item) => item.nomeProduto);
  const totalVendas = ativos.reduce((soma, item) => soma + Math.max(0, vendasPorProduto[item.produtoId] ?? 0), 0);
  const vendasComCusto = completos.reduce((soma, item) => soma + Math.max(0, vendasPorProduto[item.produtoId] ?? 0), 0);
  const vendasCobertasPercent = totalVendas > 0 ? Math.min(100, Math.round((vendasComCusto / totalVendas) * 100)) : 0;
  const margemAtiva = ativos.length > 0 && completos.length === ativos.length && totalVendas > 0 && vendasCobertasPercent >= coberturaMinimaPercent;
  const modo = completos.length === 0 ? "sem_margem" : margemAtiva ? "margem_ativa" : "margem_parcial";
  return {
    modo,
    produtosCompletos: completos.length,
    produtosTotal: ativos.length,
    vendasCobertasPercent,
    produtosIncompletos: incompletos,
    motivo: modo === "margem_ativa"
      ? "Os produtos elegíveis têm custo conhecido."
      : modo === "margem_parcial"
        ? "Alguns produtos ainda não têm custo completo; eles ficam fora de promoções com margem."
        : "Nenhum produto elegível tem custo completo; o robô mede vendas sem prometer lucro.",
  };
}

export function calcularSobraComCupom(custo: CustoProduto, descontoCents: number): number | null {
  if (!custo.completo || custo.custoDiretoCents === null) return null;
  return custo.precoVendaCents - Math.max(0, descontoCents) - custo.custoDiretoCents;
}

/** Conta somente itens entregues que têm ID estável do catálogo. */
export function contarVendasPorProduto(
  pedidos: Array<{ status?: string; snapshotOficial?: unknown }>,
): Record<string, number> {
  const vendas: Record<string, number> = {};
  for (const pedido of pedidos) {
    if (pedido.status !== "entregue" || !pedido.snapshotOficial || typeof pedido.snapshotOficial !== "object") continue;
    const itens = (pedido.snapshotOficial as { itens?: unknown }).itens;
    if (!Array.isArray(itens)) continue;
    for (const bruto of itens) {
      if (!bruto || typeof bruto !== "object") continue;
      const item = bruto as { quantidade?: unknown; selecao?: unknown };
      if (!item.selecao || typeof item.selecao !== "object") continue;
      const produtoId = (item.selecao as { productId?: unknown }).productId;
      const quantidade = Number(item.quantidade);
      if (typeof produtoId !== "string" || !produtoId.trim() || !Number.isFinite(quantidade) || quantidade <= 0) continue;
      vendas[produtoId] = (vendas[produtoId] ?? 0) + quantidade;
    }
  }
  return vendas;
}
