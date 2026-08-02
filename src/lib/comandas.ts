import { randomUUID } from "crypto";
import { redis } from "./redis";
import { getMENUDinamico } from "./menu.server";
import { officialUnitPrice, type ItemApp, type MenuPedidoApp } from "./pedidoAppItens";

// Comanda do Salão — mesa aberta que acumula itens antes de virar um pedido
// de verdade. NÃO É um motor de pedido paralelo: preço e catálogo aqui vêm
// SEMPRE de officialUnitPrice/getMENUDinamico, a mesma fonte usada por
// /api/pedido-app — e o pedido final criado ao "enviar" a comanda passa
// pela MESMA rota de criação de pedido de sempre (ver
// src/app/api/salao/comandas/[id]/enviar/route.ts). Esta estrutura só
// existe para o período "aberta", antes do pedido de verdade existir.

export type StatusComanda = "aberta" | "enviada" | "fechada";

export type Comanda = {
  id: string;
  numero: number;
  mesa: string;
  complemento?: string;
  itens: ItemApp[];
  observacao?: string;
  status: StatusComanda;
  abertaEm: string;
  enviadaEm?: string;
  fechadaEm?: string;
  pedidoId?: string;
  pedidoNumero?: number;
};

const CHAVE_COMANDAS = "salao:comandas";

export async function listarComandas(): Promise<Comanda[]> {
  return (await redis.get<Comanda[]>(CHAVE_COMANDAS)) || [];
}

async function salvarComandas(lista: Comanda[]): Promise<void> {
  await redis.set(CHAVE_COMANDAS, lista);
}

export async function buscarComanda(id: string): Promise<Comanda | null> {
  const lista = await listarComandas();
  return lista.find((c) => c.id === id) || null;
}

async function proximoNumeroComanda(): Promise<number> {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const chave = `contador_comandas:${hoje}`;
  const numero = await redis.incr(chave);
  if (numero === 1) await redis.expire(chave, 60 * 60 * 36);
  return numero;
}

export async function abrirComanda(mesa: string, complemento?: string): Promise<Comanda> {
  const lista = await listarComandas();
  const numero = await proximoNumeroComanda();
  const comanda: Comanda = {
    id: `comanda_${randomUUID()}`,
    numero,
    mesa: mesa.trim(),
    complemento: complemento?.trim() || undefined,
    itens: [],
    status: "aberta",
    abertaEm: new Date().toISOString(),
  };
  await salvarComandas([...lista, comanda]);
  return comanda;
}

export type ResultadoValidacaoItens =
  | { ok: true; itens: ItemApp[]; total: number }
  | { ok: false; error: string };

/**
 * Valida e reprecifica os itens da comanda contra o cardápio oficial —
 * nunca confia no preço vindo do painel do Salão. Itens promocionais não
 * são suportados aqui (mesmo escopo do pedido manual administrativo).
 */
export async function validarItensComanda(itens: unknown): Promise<ResultadoValidacaoItens> {
  if (!Array.isArray(itens) || itens.length === 0) {
    return { ok: false, error: "Informe pelo menos um item" };
  }
  const menu = (await getMENUDinamico()) as MenuPedidoApp;
  const validados: ItemApp[] = [];
  let total = 0;
  for (const bruto of itens) {
    const item = bruto as Partial<ItemApp>;
    if (item.kind === "promo") {
      return { ok: false, error: "Item promocional não é suportado no Salão" };
    }
    if (item.kind !== "pizza" && item.kind !== "simple") {
      return { ok: false, error: "Item inválido" };
    }
    const preco = officialUnitPrice(item as ItemApp, menu);
    if (preco === null) {
      return { ok: false, error: `Item fora do cardápio: ${item.name || "desconhecido"}` };
    }
    const qty = typeof item.qty === "number" && Number.isFinite(item.qty) ? Math.floor(item.qty) : 0;
    if (qty <= 0) {
      return { ok: false, error: "Quantidade inválida" };
    }
    const validado: ItemApp = { kind: item.kind, name: item.name || "", detail: item.detail || "", price: preco, qty };
    validados.push(validado);
    total += preco * qty;
  }
  return { ok: true, itens: validados, total };
}

export type AtualizarComandaResultado = Comanda | "nao_encontrada" | "nao_esta_aberta";

export async function atualizarItensComanda(
  id: string,
  itens: ItemApp[],
  campos: { observacao?: string; complemento?: string } = {}
): Promise<AtualizarComandaResultado> {
  const lista = await listarComandas();
  const idx = lista.findIndex((c) => c.id === id);
  if (idx < 0) return "nao_encontrada";
  if (lista[idx].status !== "aberta") return "nao_esta_aberta";
  lista[idx] = {
    ...lista[idx],
    itens,
    ...(campos.observacao !== undefined ? { observacao: campos.observacao.trim() || undefined } : {}),
    ...(campos.complemento !== undefined ? { complemento: campos.complemento.trim() || undefined } : {}),
  };
  await salvarComandas(lista);
  return lista[idx];
}

export type MarcarEnviadaResultado = Comanda | "nao_encontrada" | "nao_esta_aberta";

export async function marcarComandaEnviada(
  id: string,
  pedidoId: string,
  pedidoNumero: number | undefined
): Promise<MarcarEnviadaResultado> {
  const lista = await listarComandas();
  const idx = lista.findIndex((c) => c.id === id);
  if (idx < 0) return "nao_encontrada";
  if (lista[idx].status !== "aberta") return "nao_esta_aberta";
  lista[idx] = {
    ...lista[idx],
    status: "enviada",
    enviadaEm: new Date().toISOString(),
    pedidoId,
    ...(pedidoNumero !== undefined ? { pedidoNumero } : {}),
  };
  await salvarComandas(lista);
  return lista[idx];
}

export type FecharComandaResultado = Comanda | "nao_encontrada" | "ainda_aberta" | "ja_fechada";

export async function fecharComanda(id: string): Promise<FecharComandaResultado> {
  const lista = await listarComandas();
  const idx = lista.findIndex((c) => c.id === id);
  if (idx < 0) return "nao_encontrada";
  if (lista[idx].status === "aberta") return "ainda_aberta";
  if (lista[idx].status === "fechada") return "ja_fechada";
  lista[idx] = { ...lista[idx], status: "fechada", fechadaEm: new Date().toISOString() };
  await salvarComandas(lista);
  return lista[idx];
}
