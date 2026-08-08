// Fase 8 — disponibilidade central e estruturada (por ID estável do catálogo
// oficial), mantendo a lista legada "esgotados" (por nome) como superfície de
// compatibilidade para todo consumidor ainda não migrado.
//
// Duas fontes coexistem durante a transição:
//   - "esgotados" / "esgotadosMetadata" (Redis, por NOME) — legado, é o que
//     todo consumidor atual (bot do WhatsApp, montagem manual, comandas,
//     promoções, Jornada do Chef, pedido-app) ainda lê.
//   - "estoque:itens" (Redis, por ID ESTÁVEL do catálogo — @/lib/catalog/ids)
//     — novo, granular por produto/sabor/borda (mesmo ID que o catálogo
//     oficial já expõe desde a Fase 2/6).
//
// A leitura efetiva (`obterEsgotadosEfetivos`) é a UNIÃO das duas: um nome só
// pode ENTRAR na lista final por qualquer uma das fontes, nunca sair por uma
// fonte estar desatualizada. Isso é o que garante "fallback legado nunca
// reativa item indisponível" — mesmo se a migração (Fase 11) ainda não rodou,
// ou se uma escrita futura only tocar uma das duas fontes por bug, o item
// mais restritivo sempre vence.
//
// A escrita (`definirDisponibilidade`) grava sempre nas duas fontes, então em
// regime permanente (após a Fase 11) elas convergem — a união é rede de
// segurança para a transição e para nomes que não resolvem mais a nenhum ID
// do catálogo atual (produto removido/renomeado).
import { redis } from "./redis";
import { norm } from "./pedidoAppItens";
import { buildCatalog } from "./catalog/adapter";
import type { Menu } from "./menu";

export const CHAVE_ESGOTADOS = "esgotados";
export const CHAVE_ESGOTADOS_METADATA = "esgotadosMetadata";
export const CHAVE_ESTOQUE_ITENS = "estoque:itens";

export type EsgMetadata = Record<string, { desde: string; ultimaRevisao?: string }>;

export interface EstoqueItemState {
  /** ID estável do catálogo oficial (flavor-*, product-*, border-*). */
  id: string;
  /** Nome vigente no momento da última escrita — só para exibição/migração;
   *  a leitura efetiva sempre tenta resolver o nome ATUAL via catálogo primeiro. */
  nome: string;
  esgotado: boolean;
  desde?: string;
  ultimaRevisao?: string;
}

export type EstoqueItens = Record<string, EstoqueItemState>;

function hoje(): string {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export async function obterEsgotadosLegado(): Promise<string[]> {
  return (await redis.get<string[]>(CHAVE_ESGOTADOS)) || [];
}

export async function obterEsgotadosMetadataLegado(): Promise<EsgMetadata> {
  return (await redis.get<EsgMetadata>(CHAVE_ESGOTADOS_METADATA)) || {};
}

export async function obterEstoqueItens(): Promise<EstoqueItens> {
  return (await redis.get<EstoqueItens>(CHAVE_ESTOQUE_ITENS)) || {};
}

/**
 * Resolve o(s) ID(s) estável(is) do catálogo oficial para um nome de
 * produto/sabor/borda, dado o Menu atual — mesma derivação de
 * @/lib/catalog/adapter (slugify do nome atual), nunca uma segunda forma de
 * gerar ID. Normalmente 1 resultado; pode ser mais de um se o mesmo nome
 * existir em mais de uma seção (ex.: sabor de pizza e nome de lanche
 * coincidentes) e 0 se o nome não existe mais no cardápio atual.
 */
export function resolverIdsPorNome(menu: Menu, nome: string): string[] {
  const catalog = buildCatalog(menu);
  const alvo = norm(nome);
  const ids: string[] = [];
  for (const flavor of [...catalog.saltyFlavors, ...catalog.sweetFlavors]) {
    if (norm(flavor.name) === alvo) ids.push(flavor.id);
  }
  for (const produto of [...catalog.lanches, ...catalog.bebidas, ...catalog.sucos]) {
    if (norm(produto.name) === alvo) ids.push(produto.id);
  }
  for (const border of catalog.borders) {
    if (norm(border.label) === alvo) ids.push(border.id);
  }
  return ids;
}

function nomeAtualParaId(menu: Menu): Map<string, string> {
  const catalog = buildCatalog(menu);
  const mapa = new Map<string, string>();
  for (const flavor of [...catalog.saltyFlavors, ...catalog.sweetFlavors]) mapa.set(flavor.id, flavor.name);
  for (const produto of [...catalog.lanches, ...catalog.bebidas, ...catalog.sucos]) mapa.set(produto.id, produto.name);
  for (const border of catalog.borders) mapa.set(border.id, border.label);
  return mapa;
}

/**
 * Disponibilidade efetiva = união dos nomes esgotados na lista legada com os
 * nomes dos itens marcados esgotados na estrutura por ID. Retorno tem a MESMA
 * forma que a lista legada (string[] de nomes) — todo consumidor atual
 * continua funcionando trocando só a chamada de leitura, sem nenhuma outra
 * mudança. Passar `menu` é opcional e só melhora a precisão (resolve o nome
 * ATUAL de cada ID, cobrindo o caso raro de um produto renomeado depois do
 * estado gravado); sem `menu`, usa o nome gravado no momento da escrita.
 */
export async function obterEsgotadosEfetivos(menu?: Menu): Promise<string[]> {
  const [legado, estoque] = await Promise.all([obterEsgotadosLegado(), obterEstoqueItens()]);
  const itensEsgotados = Object.entries(estoque).filter(([, item]) => item.esgotado);
  if (itensEsgotados.length === 0) return legado;

  const idParaNomeAtual = menu ? nomeAtualParaId(menu) : null;
  const nomesDoEstoque = itensEsgotados.map(([id, item]) => idParaNomeAtual?.get(id) ?? item.nome);
  return Array.from(new Set([...legado, ...nomesDoEstoque]));
}

export async function obterEsgotadosMetadataEfetiva(): Promise<EsgMetadata> {
  const [legado, estoque] = await Promise.all([obterEsgotadosMetadataLegado(), obterEstoqueItens()]);
  const metadata: EsgMetadata = { ...legado };
  for (const item of Object.values(estoque)) {
    if (!item.esgotado) continue;
    if (!metadata[item.nome]) {
      metadata[item.nome] = { desde: item.desde ?? hoje(), ultimaRevisao: item.ultimaRevisao };
    }
  }
  return metadata;
}

/**
 * Ponto único de escrita de disponibilidade (usado por PATCH /api/cardapio).
 * Grava nas DUAS fontes — legada por nome (compatibilidade com todo
 * consumidor ainda não migrado) e nova por ID (granular, fonte estruturada) —
 * para que qualquer leitor veja o novo estado imediatamente, migrado ou não.
 * `menu` é o cardápio atual, usado só para resolver o(s) ID(s) do nome
 * recebido — nunca para decidir o nome em si (isso continua vindo do admin).
 */
export async function definirDisponibilidade(params: {
  menu: Menu;
  nome: string;
  esgotado: boolean;
}): Promise<{ esgotados: string[]; esgotadosMetadata: EsgMetadata }> {
  const { menu, nome, esgotado } = params;
  const [metadata, lista] = await Promise.all([obterEsgotadosMetadataLegado(), obterEsgotadosLegado()]);

  let novaLista: string[];
  if (esgotado) {
    novaLista = lista.includes(nome) ? lista : [...lista, nome];
    if (!metadata[nome]) metadata[nome] = { desde: hoje(), ultimaRevisao: hoje() };
  } else {
    novaLista = lista.filter((n) => n !== nome);
    delete metadata[nome];
  }
  await redis.set(CHAVE_ESGOTADOS, novaLista);
  await redis.set(CHAVE_ESGOTADOS_METADATA, metadata);

  const ids = resolverIdsPorNome(menu, nome);
  if (ids.length > 0) {
    const estoque = await obterEstoqueItens();
    const agora = hoje();
    for (const id of ids) {
      if (esgotado) {
        const existente = estoque[id];
        estoque[id] = { id, nome, esgotado: true, desde: existente?.desde ?? agora, ultimaRevisao: agora };
      } else {
        delete estoque[id];
      }
    }
    await redis.set(CHAVE_ESTOQUE_ITENS, estoque);
  }

  return { esgotados: novaLista, esgotadosMetadata: metadata };
}

/** Marca "revisado hoje" nas duas fontes — não muda disponibilidade, só a data de revisão. */
export async function marcarRevisaoHoje(nome: string): Promise<EsgMetadata> {
  const metadata = await obterEsgotadosMetadataLegado();
  if (metadata[nome]) {
    metadata[nome] = { ...metadata[nome], ultimaRevisao: hoje() };
    await redis.set(CHAVE_ESGOTADOS_METADATA, metadata);
  }

  const estoque = await obterEstoqueItens();
  let mudou = false;
  for (const item of Object.values(estoque)) {
    if (item.nome === nome && item.esgotado) {
      item.ultimaRevisao = hoje();
      mudou = true;
    }
  }
  if (mudou) await redis.set(CHAVE_ESTOQUE_ITENS, estoque);

  return metadata;
}

// ---------------------------------------------------------------------------
// Migração — Fase 11: popula "estoque:itens" a partir da lista legada
// "esgotados", sem apagar/alterar a lista legada em si (ela continua sendo
// escrita normalmente por definirDisponibilidade, e continua fazendo parte da
// união em obterEsgotadosEfetivos). Idempotente: recalcula do zero a partir
// da MESMA fonte legada a cada execução, nunca acumula duplicado. Faz backup
// antes de qualquer escrita real e reporta nomes que não resolveram para
// nenhum ID do catálogo atual (produto removido/renomeado) — esses
// permanecem cobertos pela lista legada, então nenhuma disponibilidade é
// perdida mesmo quando a resolução por ID falha.
// ---------------------------------------------------------------------------

export interface RelatorioMigracaoEstoque {
  totalNomesLegado: number;
  resolvidos: { nome: string; ids: string[] }[];
  naoResolvidos: string[];
  itensEstoqueAntes: number;
  itensEstoqueDepois: number;
  chaveBackup?: string;
  dryRun: boolean;
}

export async function migrarEsgotadosParaEstoque(params: {
  menu: Menu;
  dryRun: boolean;
}): Promise<RelatorioMigracaoEstoque> {
  const { menu, dryRun } = params;
  const [lista, metadata, estoqueAtual] = await Promise.all([
    obterEsgotadosLegado(),
    obterEsgotadosMetadataLegado(),
    obterEstoqueItens(),
  ]);

  const resolvidos: { nome: string; ids: string[] }[] = [];
  const naoResolvidos: string[] = [];
  const novoEstoque: EstoqueItens = { ...estoqueAtual };

  for (const nome of lista) {
    const ids = resolverIdsPorNome(menu, nome);
    if (ids.length === 0) {
      naoResolvidos.push(nome);
      continue;
    }
    resolvidos.push({ nome, ids });
    const meta = metadata[nome];
    for (const id of ids) {
      novoEstoque[id] = {
        id,
        nome,
        esgotado: true,
        desde: meta?.desde ?? novoEstoque[id]?.desde ?? hoje(),
        ultimaRevisao: meta?.ultimaRevisao ?? novoEstoque[id]?.ultimaRevisao,
      };
    }
  }

  const relatorio: RelatorioMigracaoEstoque = {
    totalNomesLegado: lista.length,
    resolvidos,
    naoResolvidos,
    itensEstoqueAntes: Object.keys(estoqueAtual).length,
    itensEstoqueDepois: Object.keys(novoEstoque).length,
    dryRun,
  };

  if (dryRun) return relatorio;

  const chaveBackup = `estoque:migracao:backup:${Date.now()}`;
  // 30 dias — mesmo prazo de retenção usado no plano de migração Redis->Postgres
  // (docs/architecture/DATABASE_MIGRATION_PLAN.md) antes de considerar dado antigo descartável.
  await redis.set(
    chaveBackup,
    { esgotados: lista, esgotadosMetadata: metadata, estoqueItensAntes: estoqueAtual },
    { ex: 60 * 60 * 24 * 30 },
  );
  await redis.set(CHAVE_ESTOQUE_ITENS, novoEstoque);

  return { ...relatorio, chaveBackup };
}

export interface ResultadoReversaoEstoque {
  ok: boolean;
  motivo?: string;
}

/** Restaura o estado gravado por `migrarEsgotadosParaEstoque` a partir da chave de backup. */
export async function reverterMigracaoEstoque(chaveBackup: string): Promise<ResultadoReversaoEstoque> {
  if (!chaveBackup.startsWith("estoque:migracao:backup:")) {
    return { ok: false, motivo: "Chave de backup inválida" };
  }
  const backup = await redis.get<{ esgotados: string[]; esgotadosMetadata: EsgMetadata; estoqueItensAntes: EstoqueItens }>(
    chaveBackup,
  );
  if (!backup) return { ok: false, motivo: "Backup não encontrado (expirado ou chave inválida)" };

  await redis.set(CHAVE_ESGOTADOS, backup.esgotados);
  await redis.set(CHAVE_ESGOTADOS_METADATA, backup.esgotadosMetadata);
  await redis.set(CHAVE_ESTOQUE_ITENS, backup.estoqueItensAntes);
  return { ok: true };
}
