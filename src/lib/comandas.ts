import { randomUUID } from "crypto";
import { redis } from "./redis";
import { obterEsgotadosEfetivos } from "./estoque";
import { getMENUDinamico } from "./menu.server";
import { officialUnitPrice, type ItemApp, type MenuPedidoApp } from "./pedidoAppItens";
import {
  temSelecaoEstruturada,
  resolverItemComSelecaoEstruturada,
  temSelecaoSimplesEstruturada,
  resolverItemComSelecaoSimplesEstruturada,
  temSelecaoDupla,
} from "./pedidoAppSelecaoEstruturada";
import { buildPizzaCatalog, type PizzaCatalog } from "./catalog/pizzas";
import { buildSimpleCatalog, type SimpleCatalog } from "./catalog/simpleProducts";

// Comanda do Salão — mesa aberta que acumula itens antes de virar um pedido
// de verdade. NÃO É um motor de pedido paralelo: preço e catálogo aqui vêm
// SEMPRE de officialUnitPrice/getMENUDinamico, a mesma fonte usada por
// /api/pedido-app — e o pedido final criado ao "enviar" a comanda passa
// pela MESMA rota de criação de pedido de sempre (ver
// src/app/api/salao/comandas/[id]/enviar/route.ts). Esta estrutura só
// existe para o período "aberta", antes do pedido de verdade existir.

export type StatusComanda = "aberta" | "enviada" | "fechada";

// Forma de pagamento gravada no pedido oficial de QUALQUER envio do Salão
// (Rodada 1 e Rodada 2+) — nunca "de verdade" ainda: o Salão só manda para a
// cozinha; o caixa é quem recebe o pagamento de fato, em uma etapa futura
// (Pedir conta / fechamento). Não é reconhecida como Pix nem dinheiro por
// nenhuma checagem de /api/pedido-app (temPixNoPagamento/
// temDinheiroNoPagamento), então nunca dispara cobrança Pix nem exige troco,
// e nunca marca o pedido como pago.
export const PAGAMENTO_COMANDA_EM_ABERTO = "Comanda em aberto";

// "enviando" existe só entre a reivindicação do envio (reivindicarEnvioRodada)
// e a confirmação (confirmarEnvioRodada) ou falha (falharEnvioRodada) —
// nunca é gravada por edição normal. "falha_envio" preserva os itens e
// permite tentar de novo (reivindicarEnvioRodada aceita reclamar a partir
// dela), mas não pode mais ser editada por PATCH (mesma trilha seguida por
// uma rodada "enviando": o Salão pode estar recriando o pedido a qualquer
// momento).
export type StatusRodada = "rascunho" | "enviando" | "enviada" | "falha_envio";

// Rodada — um envio (ou tentativa de envio) de itens à cozinha dentro de uma
// mesma comanda. A Rodada 1 é sempre o pedido original (o que a comanda já
// suportava antes desta etapa); a partir da Rodada 2, itens novos podem ser
// adicionados sem tocar o que já foi enviado. Nesta etapa só existe
// "rascunho" → os itens ainda não viraram pedido de verdade — e "enviada",
// usada só para representar a Rodada 1 normalizada de comandas antigas
// (nenhum código nesta etapa cria uma rodada 2+ já "enviada" diretamente —
// toda Rodada 2+ passa por "enviando" antes).
export type Rodada = {
  id: string;
  numero: number;
  status: StatusRodada;
  itens: ItemApp[];
  observacao?: string;
  subtotal: number;
  criadaEm: string;
  atualizadaEm: string;
  enviadaEm?: string;
  responsavel?: string;
  clientRequestId?: string;
  pedidoId?: string;
  pedidoNumero?: number;
  /** Erro da última tentativa de envio, quando a rodada está em
   *  "falha_envio" — só para exibição; nunca decide comportamento. */
  erroUltimaTentativa?: string;
};

export type Comanda = {
  id: string;
  numero: number;
  /** Nome do cliente informado ao abrir o atendimento. Ausente em comandas
   *  gravadas antes desta etapa — nesse caso a UI cai para "Mesa X"/"Cliente"
   *  como identificação, nunca falha por causa do campo faltando. */
  cliente?: string;
  /** Opcional — "Sem mesa" é um atendimento válido (balcão, viagem). */
  mesa?: string;
  complemento?: string;
  /** Itens da Rodada 1 — mantido por compatibilidade (comandas antigas e o
   *  fluxo de envio existente leem/escrevem aqui). A fonte de verdade para
   *  qualquer leitura que precise de todas as rodadas é sempre `rodadas`
   *  (via `comRodadasNormalizadas`), nunca este campo isolado. */
  itens: ItemApp[];
  observacao?: string;
  status: StatusComanda;
  abertaEm: string;
  enviadaEm?: string;
  fechadaEm?: string;
  pedidoId?: string;
  pedidoNumero?: number;
  /** Ausente em comandas gravadas antes desta etapa — normalizado sob
   *  demanda por `comRodadasNormalizadas`, nunca lido diretamente. */
  rodadas?: Rodada[];
};

const CHAVE_COMANDAS = "salao:comandas";
const CHAVE_MUTEX_COMANDAS = "salao:comandas:mutex";
const MUTEX_TTL_SEGUNDOS = 5;
const MUTEX_RETRY_MAX = 20;
const MUTEX_RETRY_DELAY_MS = 50;

export async function listarComandas(): Promise<Comanda[]> {
  return (await redis.get<Comanda[]>(CHAVE_COMANDAS)) || [];
}

async function salvarComandas(lista: Comanda[]): Promise<void> {
  await redis.set(CHAVE_COMANDAS, lista);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mutex curto para toda escrita em `salao:comandas`: a lista inteira é lida,
 * alterada e regravada de uma vez (read-modify-write), então qualquer duas
 * escritas concorrentes sem proteção podem se sobrescrever (perder a abertura
 * de uma mesa, uma rodada nova, um fechamento). Mesmo padrão de
 * SET NX + TTL + retry já usado em `adquirirMutexEdicao`
 * (src/lib/pedidoEdicao.ts), aplicado à lista de comandas.
 */
async function comMutexComandas<T>(fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  let adquirido = false;
  for (let tentativa = 0; tentativa < MUTEX_RETRY_MAX; tentativa++) {
    const ok = await redis.set(CHAVE_MUTEX_COMANDAS, token, { nx: true, ex: MUTEX_TTL_SEGUNDOS });
    if (ok) {
      adquirido = true;
      break;
    }
    await sleep(MUTEX_RETRY_DELAY_MS);
  }
  if (!adquirido) {
    throw new Error("mutex_comandas_indisponivel");
  }
  try {
    return await fn();
  } finally {
    try {
      const atual = await redis.get<string>(CHAVE_MUTEX_COMANDAS);
      if (atual === token) await redis.del(CHAVE_MUTEX_COMANDAS);
    } catch {
      // Liberação é best-effort — o TTL curto garante que o mutex não fica preso.
    }
  }
}

export async function buscarComanda(id: string): Promise<Comanda | null> {
  const lista = await listarComandas();
  return lista.find((c) => c.id === id) || null;
}

function calcularSubtotal(itens: ItemApp[]): number {
  return itens.reduce((soma, item) => soma + item.price * item.qty, 0);
}

/**
 * Devolve a comanda com `rodadas` sempre preenchido — nunca muta o
 * argumento. Comandas que já têm `rodadas` (gravadas nesta etapa em
 * diante) voltam como estão. Comandas antigas (só `itens`/`pedidoId`, sem
 * `rodadas`) são normalizadas em memória como uma Rodada 1 única:
 * "rascunho" se a comanda ainda está "aberta", "enviada" se já foi enviada
 * ou fechada — sem apagar nenhum campo antigo (`itens`, `pedidoId`,
 * `pedidoNumero`, `enviadaEm` continuam intactos na comanda). A gravação
 * de `rodadas` só acontece na próxima escrita real (criar/atualizar
 * rodada), nunca aqui — leitura nunca escreve.
 */
export function comRodadasNormalizadas(comanda: Comanda): Comanda {
  if (comanda.rodadas && comanda.rodadas.length > 0) return comanda;
  const rodada1: Rodada = {
    id: `rodada_${comanda.id}_1`,
    numero: 1,
    status: comanda.status === "aberta" ? "rascunho" : "enviada",
    itens: comanda.itens,
    ...(comanda.observacao ? { observacao: comanda.observacao } : {}),
    subtotal: calcularSubtotal(comanda.itens),
    criadaEm: comanda.abertaEm,
    atualizadaEm: comanda.enviadaEm || comanda.abertaEm,
    ...(comanda.status !== "aberta" ? { enviadaEm: comanda.enviadaEm || comanda.abertaEm } : {}),
    ...(comanda.pedidoId ? { pedidoId: comanda.pedidoId } : {}),
    ...(comanda.pedidoNumero !== undefined ? { pedidoNumero: comanda.pedidoNumero } : {}),
  };
  return { ...comanda, rodadas: [rodada1] };
}

/** Soma o subtotal de todas as rodadas (rascunho + enviadas) — o total
 *  parcial real da comanda, sempre a partir da visão normalizada. */
export function totalParcialComanda(comanda: Comanda): number {
  return comRodadasNormalizadas(comanda).rodadas!.reduce((soma, r) => soma + r.subtotal, 0);
}

/** Identificação do cliente gravada no pedido oficial (campo `cliente` de
 *  /api/pedido-app) — nome informado no atendimento; cai para "Mesa X" em
 *  comandas antigas sem o campo, e para "Cliente" no caso (raro) de nenhum
 *  dos dois existir. Nunca decide preço/estoque — só identificação. */
export function identificacaoClienteComanda(comanda: Comanda): string {
  if (comanda.cliente) return comanda.cliente;
  if (comanda.mesa) return `Mesa ${comanda.mesa}`;
  return "Cliente";
}

async function proximoNumeroComanda(): Promise<number> {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const chave = `contador_comandas:${hoje}`;
  const numero = await redis.incr(chave);
  if (numero === 1) await redis.expire(chave, 60 * 60 * 36);
  return numero;
}

export type AbrirComandaResultado = Comanda | "mesa_ocupada";

export type AbrirComandaOpcoes = {
  /** Opcional para manter os testes/chamadores existentes funcionando sem
   *  mudança — a exigência de preencher o nome é decidida na rota
   *  (POST /api/salao/comandas), nunca aqui. */
  cliente?: string;
  mesa?: string;
  complemento?: string;
};

/**
 * Abre uma comanda nova — para uma mesa, ou "Sem mesa" quando `mesa` vem
 * vazio/ausente (atendimento de balcão). Quando a mesa é informada e já tem
 * uma comanda "aberta" ou "enviada" (ainda não fechada), recusa em vez de
 * abrir uma segunda comanda concorrente para a mesma mesa — comandas "sem
 * mesa" nunca colidem entre si. A checagem e a escrita acontecem sob o
 * mesmo mutex (`comMutexComandas`), então duas aberturas simultâneas da
 * mesma mesa nunca resultam em duas comandas.
 */
export async function abrirComanda(opcoes: AbrirComandaOpcoes): Promise<AbrirComandaResultado> {
  const mesaTrim = opcoes.mesa?.trim() || undefined;
  const clienteTrim = opcoes.cliente?.trim() || undefined;
  return comMutexComandas(async () => {
    const lista = await listarComandas();
    if (mesaTrim) {
      const jaOcupada = lista.some((c) => c.mesa === mesaTrim && c.status !== "fechada");
      if (jaOcupada) return "mesa_ocupada";
    }

    const numero = await proximoNumeroComanda();
    const comanda: Comanda = {
      id: `comanda_${randomUUID()}`,
      numero,
      ...(clienteTrim ? { cliente: clienteTrim } : {}),
      ...(mesaTrim ? { mesa: mesaTrim } : {}),
      complemento: opcoes.complemento?.trim() || undefined,
      itens: [],
      status: "aberta",
      abertaEm: new Date().toISOString(),
    };
    await salvarComandas([...lista, comanda]);
    return comanda;
  });
}

export type ResultadoValidacaoItens =
  | { ok: true; itens: ItemApp[]; total: number }
  | { ok: false; error: string };

/** Preserva SÓ os 3 campos oficiais da seleção estruturada já validada —
 *  nunca uma propriedade extra adulterada que possa ter chegado junto no
 *  mesmo objeto do cliente (mesmo padrão de `sanitizarSelecao` em
 *  src/lib/pedidoSnapshot.ts, mas local a este módulo). Só é chamada depois
 *  que `resolverItemComSelecaoEstruturada` já confirmou que sizeId/flavorIds/
 *  borderId correspondem a entradas reais do catálogo. */
function sanitizarPizzaSelecaoValidada(
  selecao: { sizeId: string; flavorIds: string[]; borderId?: string }
): { sizeId: string; flavorIds: string[]; borderId?: string } {
  return {
    sizeId: selecao.sizeId,
    flavorIds: [...selecao.flavorIds],
    ...(selecao.borderId !== undefined ? { borderId: selecao.borderId } : {}),
  };
}

/** Mesma ideia de `sanitizarPizzaSelecaoValidada`, para a seleção de produto
 *  simples (Fase 6) — só é chamada depois que
 *  `resolverItemComSelecaoSimplesEstruturada` já confirmou que
 *  productId/sizeId/flavorId/milk correspondem a entradas reais e
 *  disponíveis do catálogo. */
function sanitizarSimpleSelecaoValidada(
  selecao: { productId: string; sizeId?: string; flavorId?: string; milk?: "com" | "sem" }
): { productId: string; sizeId?: string; flavorId?: string; milk?: "com" | "sem" } {
  return {
    productId: selecao.productId,
    ...(selecao.sizeId !== undefined ? { sizeId: selecao.sizeId } : {}),
    ...(selecao.flavorId !== undefined ? { flavorId: selecao.flavorId } : {}),
    ...(selecao.milk !== undefined ? { milk: selecao.milk } : {}),
  };
}

/**
 * Valida e reprecifica os itens da comanda contra o cardápio oficial —
 * nunca confia no preço vindo do painel do Salão. Itens promocionais não
 * são suportados aqui (mesmo escopo do pedido manual administrativo).
 *
 * Seleção estruturada de pizza (Fase 5, mesmo catálogo/motor nativo da
 * Fase 2) e de produto simples (Fase 6 — Calzone, Mini-Pizza, Macarronada,
 * sucos): a PRESENÇA (não a truthiness) de `item.pizzaSelection`/
 * `item.simpleSelection` decide — igual a POST /api/pedido-app. Um item que
 * declarou a intenção de usar o formato novo e falhou a validação é
 * DEFINITIVO: nunca cai para o caminho legado (officialUnitPrice) com o
 * name/detail que possa ter mandado junto. Item sem essa propriedade
 * continua 100% pelo caminho legado de sempre — comanda/rodada antiga, ou
 * carrinho misto legado + estruturado, funcionam sem nenhuma mudança.
 */
export async function validarItensComanda(
  itens: unknown,
  opcoes: { permitirVazio?: boolean } = {}
): Promise<ResultadoValidacaoItens> {
  if (!Array.isArray(itens)) {
    return { ok: false, error: "Informe pelo menos um item" };
  }
  if (itens.length === 0) {
    // Uma rodada em rascunho pode ficar momentaneamente sem itens (removeu
    // o último produto antes de adicionar outro) — o pedido de verdade
    // (Rodada 1) continua exigindo pelo menos um item para ser enviado.
    if (opcoes.permitirVazio) return { ok: true, itens: [], total: 0 };
    return { ok: false, error: "Informe pelo menos um item" };
  }
  const menu = await getMENUDinamico();

  // Os catálogos oficiais (pizza — Fase 2 — e demais produtos configuráveis
  // — Fase 6) só são montados quando algum item realmente precisa deles —
  // mesmo padrão de custo sob demanda já usado em POST /api/pedido-app.
  // `esgotados` é lido FRESCO do Redis uma única vez (compartilhado pelos
  // dois catálogos) a cada chamada desta função (nunca cacheado entre
  // requisições), então um sabor/borda/produto que esgota entre salvar a
  // rodada e reenviá-la (reprecificação em profundidade da rota de envio da
  // Rodada 1 e da Rodada 2+) é pego aqui.
  let esgotadosCache: string[] | null = null;
  async function esgotadosFrescos(): Promise<string[]> {
    if (!esgotadosCache) esgotadosCache = await obterEsgotadosEfetivos(menu);
    return esgotadosCache;
  }
  let pizzaCatalogCache: PizzaCatalog | null = null;
  async function catalogoPizzaOficial(): Promise<PizzaCatalog> {
    if (!pizzaCatalogCache) pizzaCatalogCache = buildPizzaCatalog(menu, await esgotadosFrescos());
    return pizzaCatalogCache;
  }
  let simpleCatalogCache: SimpleCatalog | null = null;
  async function catalogoSimplesOficial(): Promise<SimpleCatalog> {
    if (!simpleCatalogCache) simpleCatalogCache = buildSimpleCatalog(menu, await esgotadosFrescos());
    return simpleCatalogCache;
  }

  const validados: ItemApp[] = [];
  let total = 0;
  for (const bruto of itens) {
    if (bruto === null || typeof bruto !== "object") {
      return { ok: false, error: "Item inválido" };
    }
    const item = bruto as Partial<ItemApp>;

    if (item.kind === "promo") {
      return { ok: false, error: "Item promocional não é suportado no Salão" };
    }

    // Fail-closed (hardening pós-auditoria, 5ª rodada): pizzaSelection E
    // simpleSelection juntas no mesmo item nunca são resolvidas por
    // precedência silenciosa — o item inteiro é rejeitado ANTES de
    // qualquer resolver ser escolhido.
    if (temSelecaoDupla(bruto)) {
      return { ok: false, error: "Seleção estruturada ambígua: item não pode ter pizzaSelection e simpleSelection ao mesmo tempo" };
    }

    if (temSelecaoEstruturada(bruto)) {
      const catalogo = await catalogoPizzaOficial();
      const resolvido = resolverItemComSelecaoEstruturada(item as ItemApp, catalogo);
      if (!resolvido.ok) {
        return { ok: false, error: resolvido.error };
      }
      // Ponto de resolução já provou que sizeId/flavorIds/borderId batem
      // com o catálogo — seguro preservar só esses 3 campos no item validado.
      const pizzaSelection = sanitizarPizzaSelecaoValidada((item as ItemApp).pizzaSelection!);
      validados.push({ ...resolvido.item, pizzaSelection });
      total += resolvido.item.price * resolvido.item.qty;
      continue;
    }

    if (temSelecaoSimplesEstruturada(bruto)) {
      const catalogo = await catalogoSimplesOficial();
      const resolvido = resolverItemComSelecaoSimplesEstruturada(item as ItemApp, menu, catalogo);
      if (!resolvido.ok) {
        return { ok: false, error: resolvido.error };
      }
      // Ponto de resolução já provou que productId/sizeId/flavorId/milk
      // batem com o catálogo (e estão disponíveis) — seguro preservar só
      // esses 4 campos no item validado, para que a Rodada/comanda continue
      // carregando o ID estável até o envio para /api/pedido-app.
      const simpleSelection = sanitizarSimpleSelecaoValidada((item as ItemApp).simpleSelection!);
      validados.push({ ...resolvido.item, simpleSelection });
      total += resolvido.item.price * resolvido.item.qty;
      continue;
    }

    if (item.kind !== "pizza" && item.kind !== "simple") {
      return { ok: false, error: "Item inválido" };
    }
    const preco = officialUnitPrice(item as ItemApp, menu as MenuPedidoApp);
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
  return comMutexComandas(async () => {
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
  });
}

export type CriarRodadaResultado =
  | { ok: true; rodada: Rodada; comanda: Comanda; criada: boolean }
  | { ok: false; motivo: "nao_encontrada" | "comanda_fechada" };

/**
 * Cria a próxima rodada em rascunho da comanda — idempotente por
 * `clientRequestId` e por estado: nunca duas rodadas em rascunho ao mesmo
 * tempo. Tudo (checar duplicidade, calcular o próximo número, gravar) sob o
 * mesmo mutex de `salao:comandas`, então duas abas/cliques concorrentes
 * nunca criam duas "Rodada 2" — a segunda chamada sempre enxerga o
 * resultado da primeira e devolve `criada: false` com a mesma rodada.
 * Só cria a estrutura em memória (nenhum pedido oficial, nenhuma
 * impressão) — isso continua para uma etapa futura.
 */
export async function criarRodadaEmRascunho(
  comandaId: string,
  clientRequestId?: string
): Promise<CriarRodadaResultado> {
  return comMutexComandas(async () => {
    const lista = await listarComandas();
    const idx = lista.findIndex((c) => c.id === comandaId);
    if (idx < 0) return { ok: false, motivo: "nao_encontrada" };
    if (lista[idx].status === "fechada") return { ok: false, motivo: "comanda_fechada" };

    const comanda = comRodadasNormalizadas(lista[idx]);
    const rodadas = comanda.rodadas!;

    if (clientRequestId) {
      const existentePorRequestId = rodadas.find((r) => r.clientRequestId === clientRequestId);
      if (existentePorRequestId) {
        lista[idx] = comanda;
        await salvarComandas(lista);
        return { ok: true, rodada: existentePorRequestId, comanda: lista[idx], criada: false };
      }
    }

    // Nunca duas rodadas "em edição/andamento" ao mesmo tempo — inclui
    // "enviando" e "falha_envio" (uma tentativa em curso ou que precisa de
    // retry), não só "rascunho".
    const emAndamento = rodadas.find((r) => r.status !== "enviada");
    if (emAndamento) {
      lista[idx] = comanda;
      await salvarComandas(lista);
      return { ok: true, rodada: emAndamento, comanda: lista[idx], criada: false };
    }

    const agora = new Date().toISOString();
    const proximoNumero = rodadas.reduce((max, r) => Math.max(max, r.numero), 0) + 1;
    const novaRodada: Rodada = {
      id: `rodada_${randomUUID()}`,
      numero: proximoNumero,
      status: "rascunho",
      itens: [],
      subtotal: 0,
      criadaEm: agora,
      atualizadaEm: agora,
      ...(clientRequestId ? { clientRequestId } : {}),
    };
    const atualizada: Comanda = { ...comanda, rodadas: [...rodadas, novaRodada] };
    lista[idx] = atualizada;
    await salvarComandas(lista);
    return { ok: true, rodada: novaRodada, comanda: atualizada, criada: true };
  });
}

export type AtualizarRodadaResultado =
  | { ok: true; rodada: Rodada; comanda: Comanda }
  | { ok: false; motivo: "nao_encontrada" | "comanda_fechada" | "rodada_nao_encontrada" | "rodada_nao_e_rascunho" };

/**
 * Atualiza itens/observação de uma rodada específica em rascunho — nunca
 * toca em outra rodada da mesma comanda (itens não vazam entre rodadas) e
 * nunca altera uma rodada já enviada (imutável nesta etapa). Mesmo padrão
 * de "carrinho completo" de `atualizarItensComanda`: o Salão sempre envia a
 * lista atual e completa de itens da rodada, nunca um diff.
 */
export async function atualizarItensRodada(
  comandaId: string,
  rodadaId: string,
  itens: ItemApp[],
  campos: { observacao?: string } = {}
): Promise<AtualizarRodadaResultado> {
  return comMutexComandas(async () => {
    const lista = await listarComandas();
    const idx = lista.findIndex((c) => c.id === comandaId);
    if (idx < 0) return { ok: false, motivo: "nao_encontrada" };
    if (lista[idx].status === "fechada") return { ok: false, motivo: "comanda_fechada" };

    const comanda = comRodadasNormalizadas(lista[idx]);
    const rodadaIdx = comanda.rodadas!.findIndex((r) => r.id === rodadaId);
    if (rodadaIdx < 0) return { ok: false, motivo: "rodada_nao_encontrada" };
    if (comanda.rodadas![rodadaIdx].status !== "rascunho") return { ok: false, motivo: "rodada_nao_e_rascunho" };

    const agora = new Date().toISOString();
    const novasRodadas = [...comanda.rodadas!];
    novasRodadas[rodadaIdx] = {
      ...novasRodadas[rodadaIdx],
      itens,
      subtotal: calcularSubtotal(itens),
      atualizadaEm: agora,
      ...(campos.observacao !== undefined ? { observacao: campos.observacao.trim() || undefined } : {}),
    };
    const atualizada: Comanda = { ...comanda, rodadas: novasRodadas };
    lista[idx] = atualizada;
    await salvarComandas(lista);
    return { ok: true, rodada: novasRodadas[rodadaIdx], comanda: atualizada };
  });
}

export type ReivindicarEnvioRodadaResultado =
  | { ok: true; retomada: true; rodada: Rodada; comanda: Comanda }
  | { ok: true; retomada: false; rodada: Rodada; comanda: Comanda }
  | {
      ok: false;
      motivo: "nao_encontrada" | "comanda_fechada" | "rodada_nao_encontrada" | "rodada_vazia" | "conflito";
      /** Só presente quando `motivo === "conflito"` — diferencia "já enviada
       *  por outra tentativa" de "envio em andamento agora", para a rota
       *  escolher a mensagem certa. */
      statusAtual?: StatusRodada;
    };

/**
 * Primeiro passo do envio de uma rodada (Beco 1): reivindica atomicamente o
 * direito de criar o pedido oficial desta rodada, sob o mesmo mutex de
 * `salao:comandas` — nunca dois pedidos para a mesma rodada. A criação do
 * pedido de verdade (chamada a /api/pedido-app) acontece DEPOIS, fora do
 * mutex (ver rota), então esta função só muda o status para "enviando" e
 * devolve; quem chamou é responsável por confirmar ou desfazer a
 * reivindicação (`confirmarEnvioRodada`/`falharEnvioRodada`).
 *
 * Idempotente por `clientRequestId`: se a MESMA tentativa já terminou
 * ("enviada" com o mesmo clientRequestId), devolve `retomada: true` com o
 * pedido já criado, sem reivindicar de novo. Qualquer outro conflito
 * (rodada já enviada por outro request, ou já "enviando"/"falha_envio" por
 * outra tentativa concorrente) devolve `motivo: "conflito"` — a rota decide
 * o código HTTP.
 */
export async function reivindicarEnvioRodada(
  comandaId: string,
  rodadaId: string,
  clientRequestId: string
): Promise<ReivindicarEnvioRodadaResultado> {
  return comMutexComandas(async () => {
    const lista = await listarComandas();
    const idx = lista.findIndex((c) => c.id === comandaId);
    if (idx < 0) return { ok: false, motivo: "nao_encontrada" };
    if (lista[idx].status === "fechada") return { ok: false, motivo: "comanda_fechada" };

    const comanda = comRodadasNormalizadas(lista[idx]);
    const rodadas = comanda.rodadas!;
    const rodadaIdx = rodadas.findIndex((r) => r.id === rodadaId);
    if (rodadaIdx < 0) return { ok: false, motivo: "rodada_nao_encontrada" };
    const rodada = rodadas[rodadaIdx];

    if (rodada.status === "enviada") {
      if (rodada.clientRequestId && rodada.clientRequestId === clientRequestId) {
        lista[idx] = comanda;
        await salvarComandas(lista);
        return { ok: true, retomada: true, rodada, comanda: lista[idx] };
      }
      return { ok: false, motivo: "conflito", statusAtual: "enviada" };
    }
    if (rodada.status === "enviando") {
      // Outra tentativa (mesma aba retry rápido ou outra aba) já está com a
      // reivindicação — nunca reivindicar duas vezes ao mesmo tempo.
      return { ok: false, motivo: "conflito", statusAtual: "enviando" };
    }
    // "rascunho" ou "falha_envio": pode reivindicar.
    if (rodada.itens.length === 0) return { ok: false, motivo: "rodada_vazia" };

    const agora = new Date().toISOString();
    const novasRodadas = [...rodadas];
    novasRodadas[rodadaIdx] = {
      ...rodada,
      status: "enviando",
      clientRequestId,
      atualizadaEm: agora,
      erroUltimaTentativa: undefined,
    };
    const atualizada: Comanda = { ...comanda, rodadas: novasRodadas };
    lista[idx] = atualizada;
    await salvarComandas(lista);
    return { ok: true, retomada: false, rodada: novasRodadas[rodadaIdx], comanda: atualizada };
  });
}

export type ConfirmarEnvioRodadaResultado = Comanda | "nao_encontrada" | "rodada_nao_encontrada";

/** Segundo passo: o pedido oficial da rodada foi criado com sucesso — grava
 *  pedidoId/pedidoNumero e marca a rodada como "enviada" (imutável daqui em
 *  diante). Nunca falha por a comanda estar fechada: o pedido já existe de
 *  verdade nesse ponto, e a marcação é só bookkeeping do Salão. */
export async function confirmarEnvioRodada(
  comandaId: string,
  rodadaId: string,
  pedidoId: string,
  pedidoNumero: number | undefined
): Promise<ConfirmarEnvioRodadaResultado> {
  return comMutexComandas(async () => {
    const lista = await listarComandas();
    const idx = lista.findIndex((c) => c.id === comandaId);
    if (idx < 0) return "nao_encontrada";
    const comanda = comRodadasNormalizadas(lista[idx]);
    const rodadaIdx = comanda.rodadas!.findIndex((r) => r.id === rodadaId);
    if (rodadaIdx < 0) return "rodada_nao_encontrada";

    const agora = new Date().toISOString();
    const novasRodadas = [...comanda.rodadas!];
    novasRodadas[rodadaIdx] = {
      ...novasRodadas[rodadaIdx],
      status: "enviada",
      enviadaEm: agora,
      atualizadaEm: agora,
      pedidoId,
      erroUltimaTentativa: undefined,
      ...(pedidoNumero !== undefined ? { pedidoNumero } : {}),
    };
    const atualizada: Comanda = { ...comanda, rodadas: novasRodadas };
    lista[idx] = atualizada;
    await salvarComandas(lista);
    return atualizada;
  });
}

/**
 * Terceiro passo (caminho de erro): desfaz a reivindicação — volta a rodada
 * para "falha_envio" preservando os itens e guardando o motivo, para que o
 * Salão possa tentar de novo sem perder nada (Beco 6). Só reverte se a
 * rodada ainda estiver "enviando" DESTA MESMA tentativa (mesmo
 * clientRequestId) — nunca pisa em cima de uma confirmação que já chegou
 * (corrida rara entre a resposta de /api/pedido-app e uma falha tardia) nem
 * em cima de uma reivindicação mais nova.
 */
export async function falharEnvioRodada(
  comandaId: string,
  rodadaId: string,
  clientRequestId: string,
  erro: string
): Promise<void> {
  await comMutexComandas(async () => {
    const lista = await listarComandas();
    const idx = lista.findIndex((c) => c.id === comandaId);
    if (idx < 0) return;
    const comanda = comRodadasNormalizadas(lista[idx]);
    const rodadaIdx = comanda.rodadas!.findIndex((r) => r.id === rodadaId);
    if (rodadaIdx < 0) return;
    const rodada = comanda.rodadas![rodadaIdx];
    if (rodada.status !== "enviando" || rodada.clientRequestId !== clientRequestId) return;

    const novasRodadas = [...comanda.rodadas!];
    novasRodadas[rodadaIdx] = {
      ...rodada,
      status: "falha_envio",
      erroUltimaTentativa: erro,
      atualizadaEm: new Date().toISOString(),
    };
    lista[idx] = { ...comanda, rodadas: novasRodadas };
    await salvarComandas(lista);
  });
}

export type MarcarEnviadaResultado = Comanda | "nao_encontrada" | "nao_esta_aberta";

export async function marcarComandaEnviada(
  id: string,
  pedidoId: string,
  pedidoNumero: number | undefined
): Promise<MarcarEnviadaResultado> {
  return comMutexComandas(async () => {
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
  });
}

export type FecharComandaResultado = Comanda | "nao_encontrada" | "ainda_aberta" | "ja_fechada";

export async function fecharComanda(id: string): Promise<FecharComandaResultado> {
  return comMutexComandas(async () => {
    const lista = await listarComandas();
    const idx = lista.findIndex((c) => c.id === id);
    if (idx < 0) return "nao_encontrada";
    if (lista[idx].status === "aberta") return "ainda_aberta";
    if (lista[idx].status === "fechada") return "ja_fechada";
    lista[idx] = { ...lista[idx], status: "fechada", fechadaEm: new Date().toISOString() };
    await salvarComandas(lista);
    return lista[idx];
  });
}
