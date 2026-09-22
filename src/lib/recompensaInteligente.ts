import { redis } from "./redis";
import { getMENUDinamico } from "./menu.server";
import { norm, type ItemApp } from "./pedidoAppItens";
import { clienteIdDoTelefone, sanitizeTelefoneCliente } from "./clientes";

const PEDIDOS_KEY = "pedidos";
export const RECOMPENSA_ALGORITMO_VERSAO = "pizza-familia-sabor-v1";

type PedidoHistorico = {
  clienteId?: string;
  telefone?: string;
  status?: string;
  itens?: unknown[];
  itensDetalhados?: ItemApp[];
};

export type RecomendacaoPresente = {
  descricao: string;
  produtoBase: string;
  sabor?: string;
  pedidosConsiderados: number;
  ocorrencias: number;
  confianca: number;
  algoritmoVersao: string;
};

function quantidadeDoTexto(valor: string): number {
  const quantidade = Number(valor.trim().match(/^(\d+)\s*x\s+/i)?.[1] ?? 1);
  return Number.isInteger(quantidade) && quantidade > 0 && quantidade <= 50 ? quantidade : 1;
}

function encontrarSabores(texto: string, sabores: string[]): string[] {
  const valor = norm(texto);
  return [...sabores]
    .sort((a, b) => norm(b).length - norm(a).length)
    .filter((sabor) => valor.includes(norm(sabor)));
}

function apenasTrechoDeSabores(texto: string): string {
  return texto.split(/\s*(?:·\s*|\bcom\s+)?borda\b/i)[0]?.trim() ?? texto;
}

function saboresDoPedido(pedido: PedidoHistorico, saboresOficiais: string[]): string[] {
  const encontrados = new Map<string, number>();
  const detalhados = Array.isArray(pedido.itensDetalhados) ? pedido.itensDetalhados : [];

  for (const item of detalhados) {
    if (item?.kind !== "pizza") continue;
    const texto = apenasTrechoDeSabores(`${item.name} ${item.detail ?? ""}`);
    for (const sabor of encontrarSabores(texto, saboresOficiais)) {
      encontrados.set(sabor, (encontrados.get(sabor) ?? 0) + Math.max(1, Number(item.qty) || 1));
    }
  }

  if (encontrados.size > 0) {
    return [...encontrados.entries()].flatMap(([sabor, quantidade]) => Array.from({ length: quantidade }, () => sabor));
  }

  for (const bruto of Array.isArray(pedido.itens) ? pedido.itens : []) {
    if (typeof bruto !== "string" || !/pizza\s+[pmgf]\b/i.test(bruto)) continue;
    for (const sabor of encontrarSabores(apenasTrechoDeSabores(bruto), saboresOficiais)) {
      encontrados.set(sabor, (encontrados.get(sabor) ?? 0) + quantidadeDoTexto(bruto));
    }
  }
  return [...encontrados.entries()].flatMap(([sabor, quantidade]) => Array.from({ length: quantidade }, () => sabor));
}

function clienteDoPedido(pedido: PedidoHistorico): string | undefined {
  if (pedido.telefone) {
    const telefone = sanitizeTelefoneCliente(pedido.telefone);
    if (telefone.length >= 10) return clienteIdDoTelefone(telefone);
  }
  return typeof pedido.clienteId === "string" ? pedido.clienteId : undefined;
}

export function recomendarSaborMaisComprado(
  clienteId: string,
  pedidos: PedidoHistorico[],
  saboresOficiais: string[],
  descricaoFallback: string,
): RecomendacaoPresente {
  const contagem = new Map<string, number>();
  let pedidosConsiderados = 0;

  for (const pedido of pedidos) {
    if (pedido.status !== "entregue" || clienteDoPedido(pedido) !== clienteId) continue;
    const sabores = new Set(saboresDoPedido(pedido, saboresOficiais));
    if (sabores.size === 0) continue;
    pedidosConsiderados += 1;
    for (const sabor of sabores) contagem.set(sabor, (contagem.get(sabor) ?? 0) + 1);
  }

  const ordenados = [...contagem.entries()].sort(
    ([saborA, totalA], [saborB, totalB]) => totalB - totalA || norm(saborA).localeCompare(norm(saborB), "pt-BR"),
  );
  const [sabor, ocorrencias] = ordenados[0] ?? [];
  if (!sabor || pedidosConsiderados < 2) {
    return {
      descricao: descricaoFallback,
      produtoBase: descricaoFallback,
      pedidosConsiderados,
      ocorrencias: 0,
      confianca: 0,
      algoritmoVersao: RECOMPENSA_ALGORITMO_VERSAO,
    };
  }

  return {
    descricao: `${descricaoFallback} — sabor mais comprado: ${sabor}`,
    produtoBase: descricaoFallback,
    sabor,
    pedidosConsiderados,
    ocorrencias,
    confianca: Math.min(1, ocorrencias / pedidosConsiderados),
    algoritmoVersao: RECOMPENSA_ALGORITMO_VERSAO,
  };
}

export async function obterRecomendacaoPresente(clienteId: string, descricaoFallback: string): Promise<RecomendacaoPresente> {
  try {
    const [pedidos, menu] = await Promise.all([
      redis.get<PedidoHistorico[]>(PEDIDOS_KEY),
      getMENUDinamico(),
    ]);
    return recomendarSaborMaisComprado(
      clienteId,
      Array.isArray(pedidos) ? pedidos : [],
      [...menu.saltyFlavors, ...menu.sweetFlavors],
      descricaoFallback,
    );
  } catch {
    return {
      descricao: descricaoFallback,
      produtoBase: descricaoFallback,
      pedidosConsiderados: 0,
      ocorrencias: 0,
      confianca: 0,
      algoritmoVersao: RECOMPENSA_ALGORITMO_VERSAO,
    };
  }
}
