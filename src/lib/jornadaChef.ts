// Jornada do Chef — segunda camada de fidelidade (recorrência/relacionamento),
// separada do programa de pontos existente (que continua intacto e recompensa
// volume). Namespaces Redis exclusivos (jornada:*), nunca reaproveitando
// `cliente:<telefone>` (colisão corrigida no PR #237) nem `fidelidade:*`.
//
// Ver docs/JORNADA_DO_CHEF_V1.md para as regras de negócio completas.

import { randomBytes, createHmac } from "crypto";
import { redis } from "./redis";
import { derivarClienteIdPorTelefone } from "./fidelidade";
import { enviarTextoWhatsApp } from "./whatsappMensagem";
import { norm } from "./pedidoAppItens";
import type { ItemApp } from "./pedidoAppItens";
import { getMENUDinamico } from "./menu";
import { catalogoDoMenu } from "./promocoes";

// ============================================================================
// Constantes e namespaces
// ============================================================================

/** Único tenant hoje (uma pizzaria), mas todo o domínio já é organizado por
 * tenant para permitir multi-loja futuramente sem reestruturar chaves. */
export const TENANT_PADRAO = "default";

const VERSAO_REGRA_ATUAL = 1;

function chaveConfig(tenantId: string): string {
  return `jornada:config:${tenantId}`;
}
function chaveProgresso(tenantId: string, clienteId: string): string {
  return `jornada:progresso:${tenantId}:${clienteId}`;
}
export function chavePedidoJornada(tenantId: string, pedidoId: string): string {
  return `jornada:pedido:${tenantId}:${pedidoId}`;
}
function chaveRecompensa(tenantId: string, recompensaId: string): string {
  return `jornada:recompensa:${tenantId}:${recompensaId}`;
}
function chaveRecompensasCliente(tenantId: string, clienteId: string): string {
  return `jornada:recompensas-cliente:${tenantId}:${clienteId}`;
}
function chaveFaseEventos(tenantId: string, clienteId: string): string {
  return `jornada:fase:${tenantId}:${clienteId}`;
}
function chaveLock(tenantId: string, clienteId: string): string {
  return `jornada:lock:${tenantId}:${clienteId}`;
}
function chaveCodigoResgate(tenantId: string, codigo: string): string {
  return `jornada:codigo:${tenantId}:${codigo}`;
}
function chavePendencias(tenantId: string): string {
  return `jornada:pendencias:${tenantId}`;
}
function chaveEventosAnalytics(tenantId: string): string {
  return `jornada:analytics:${tenantId}`;
}
function chaveMensagemEnviada(tenantId: string, pedidoId: string, tipo: string): string {
  return `jornada:msg:${tenantId}:${pedidoId}:${tipo}`;
}

// ============================================================================
// Tipos
// ============================================================================

export type TipoRecompensaJornada = "bebida_sobremesa" | "pizza" | "presente_especial";

/** Categorias de item individual do cardápio real (pizza fica de fora daqui
 * — pizza é sempre tamanho + sabores, nunca um productId genérico). */
export type CategoriaItemJornada = "bebida" | "suco" | "lanche" | "macarronada";

/** Item do cardápio real referenciado por uma recompensa — sempre com o
 * `produtoId` estável de `catalogoDoMenu` (@/lib/promocoes), nunca por nome
 * livre. `produtoNome` é um snapshot (nome no momento da configuração),
 * usado só para exibição — a identidade é sempre `produtoId`. */
export type ItemCatalogoJornada = {
  produtoId: string;
  produtoNome: string;
  categoria: CategoriaItemJornada;
};

/** Especificação de uma pizza-presente: tamanho e sabores permitidos, ambos
 * do cardápio real — nunca um productId genérico (pizza depende de tamanho
 * e sabor, que o produtoId de bebida/lanche não capturaria). Borda e
 * adicionais NÃO estão incluídos no presente (rule 14). */
export type PizzaRecompensa = {
  tamanho: string;
  sabores: string[];
};

/** Item de uma composição de "presente especial" — sempre uma referência
 * estruturada ao catálogo real, nunca texto livre. */
export type ItemComposicaoRecompensa = {
  item: ItemCatalogoJornada;
  quantidade: number;
};

export type RecompensaConfigCiclo = {
  /** Identidade estável desta entrada na sequência — usada para editar,
   * reordenar (a ORDEM no array já é a ordem determinística de ciclos) e
   * remover sem depender de índice. */
  id: string;
  tipo: TipoRecompensaJornada;
  ativo: boolean;
  /** Resumo de exibição, sempre derivado (nunca fonte de verdade) — ver
   * `resumoRecompensaConfig`. */
  produtoNome: string;
  /** Preenchido quando tipo === "bebida_sobremesa". */
  item?: ItemCatalogoJornada;
  /** Preenchido quando tipo === "pizza". */
  pizza?: PizzaRecompensa;
  /** Preenchido quando tipo === "presente_especial" — composição estruturada,
   * nunca uma string livre. */
  composicao?: ItemComposicaoRecompensa[];
};

/** Catálogo real usado para validar e construir a sequência de presentes —
 * carregado do cardápio dinâmico oficial (@/lib/menu), nunca duplicado ou
 * hardcodado no frontend. */
export type CatalogoJornada = {
  sizes: { code: string; label?: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  itensIndividuais: { produtoId: string; produtoNome: string; categoria: CategoriaItemJornada; esgotado: boolean }[];
};

export type ErroValidacaoRecompensa = { indice: number; id?: string; mensagens: string[] };

/**
 * Modo de rollout da Jornada do Chef (substitui o antigo `ativo: boolean`):
 * - "off": ninguém participa — comportamento equivalente ao antigo `ativo: false`.
 * - "canary": só os clientes em `canaryClientes` participam — permite o
 *   primeiro teste real em Production sem expor a feature a todo mundo.
 * - "on": todo cliente elegível participa — equivalente ao antigo `ativo: true`.
 */
export type ModoRolloutJornada = "off" | "canary" | "on";

/**
 * Entrada da lista canário — NUNCA guarda telefone nem `clienteId` (que no
 * formato `cli_<dígitos>` já embute o telefone completo). `ref` é um
 * HMAC-SHA256 do `clienteId` com um segredo server-side (nunca reversível
 * sem o segredo); `idPublico` é um prefixo curto de `ref`, seguro para
 * expor em API/URL (identifica a entrada sem devolver o HMAC completo);
 * `labelMascarado` é só os últimos 4 dígitos, para exibição no painel.
 */
export type ClienteCanario = {
  ref: string;
  idPublico: string;
  labelMascarado: string;
};

export type ConfigJornadaChef = {
  modoRollout: ModoRolloutJornada;
  metaPizzas: number;
  limitePizzasPorPedido: number;
  validadeRecompensaDias: number;
  mensagensWhatsappAtivas: boolean;
  versaoRegra: number;
  sequenciaRecompensas: RecompensaConfigCiclo[];
  canaryClientes: ClienteCanario[];
  textos: { tituloTrilha: string; subtituloTrilha: string };
  atualizadoEm: string;
};

// Limites de segurança: a V1 nunca deve permitir configuração que quebre a
// blindagem econômica aprovada, mesmo com acesso admin.
const META_MINIMA_SEGURA = 4;
const META_MAXIMA_SEGURA = 60;
const LIMITE_MAXIMO_SEGURO = 4;

export const CONFIG_JORNADA_PADRAO: ConfigJornadaChef = {
  modoRollout: "off",
  metaPizzas: 12,
  limitePizzasPorPedido: 4,
  validadeRecompensaDias: 30,
  mensagensWhatsappAtivas: false,
  versaoRegra: VERSAO_REGRA_ATUAL,
  sequenciaRecompensas: [],
  canaryClientes: [],
  textos: {
    tituloTrilha: "Jornada do Chef",
    subtituloTrilha: "Complete 12 pizzas e desbloqueie seu presente!",
  },
  atualizadoEm: new Date(0).toISOString(),
};

export type EstadoJornadaCliente = {
  clienteId: string;
  cicloAtual: number;
  pizzasNoCiclo: number;
  totalJornadasConcluidas: number;
  versaoRegra: number;
  criadoEm: string;
  atualizadoEm: string;
};

export type FaseEventoJornada = {
  clienteId: string;
  ciclo: number;
  marco: number;
  faseConcluida: number;
  pedidoId: string;
  criadoEm: string;
};

export type StatusRecompensaJornada =
  | "fechada"
  | "disponivel"
  | "reservada"
  | "resgatada"
  | "expirada"
  | "suspensa"
  | "cancelada";

export type RecompensaJornada = {
  recompensaId: string;
  tenantId: string;
  clienteId: string;
  ciclo: number;
  status: StatusRecompensaJornada;
  tipo: TipoRecompensaJornada | null;
  produtoId: string | null;
  produtoNome: string | null;
  /** Snapshot estruturado da composição no momento em que a caixa foi
   * criada — imune a mudanças posteriores no cardápio/config (rule 4). */
  item?: ItemCatalogoJornada;
  pizza?: PizzaRecompensa;
  composicao?: ItemComposicaoRecompensa[];
  versaoConfig: number;
  codigoPublico: string;
  pedidoOrigemId: string;
  criadaEm: string;
  atualizadaEm: string;
  abertaEm?: string;
  validaAte?: string;
  reservaPedidoId?: string;
  reservadaEm?: string;
  resgatadaEm?: string;
  expiradaEm?: string;
  suspensaEm?: string;
  canceladaEm?: string;
  motivoSuspensao?: string;
  historicoSubstituicao?: { produtoIdAnterior: string; produtoIdNovo: string; produtoNomeNovo: string; motivo: string; em: string }[];
};

export type RegistroProcessamentoPedidoJornada = {
  pedidoId: string;
  tenantId: string;
  clienteId: string;
  canal?: string;
  tipoAtendimento?: string;
  statusQueGerouCredito: string;
  pizzasElegiveisTotal: number;
  pizzasNaTrilha: number;
  progressoAntes: { ciclo: number; pizzasNoCiclo: number };
  progressoDepois: { ciclo: number; pizzasNoCiclo: number };
  fasesCruzadas: number[];
  recompensasCriadasIds: string[];
  processadoEm: string;
  revertidoEm?: string;
  pendenciaRevisaoEm?: string;
};

export type PendenciaRevisaoJornada = {
  pendenciaId: string;
  tenantId: string;
  clienteId: string;
  pedidoId?: string;
  recompensaId?: string;
  tipo: "reversao_apos_abertura" | "reversao_progresso_avancado" | "produtos_nao_configurados" | "substituicao_manual" | "outro";
  motivo: string;
  criadaEm: string;
  resolvidaEm?: string;
  resolvidaPor?: string;
  notaResolucao?: string;
};

/** Item já normalizado para fins de contagem da trilha — canal-agnóstico. */
export type ItemElegibilidadeJornada = {
  categoria: "pizza" | "outro";
  quantidade: number;
  gratuito?: boolean;
};

/** Forma mínima de pedido aceita por `contarPizzasElegiveisPedido` e
 * `processarConclusaoPedidoJornada` — apenas os campos realmente lidos, para
 * não acoplar este módulo ao tipo completo `PedidoRedis`. */
export type PedidoParaJornada = {
  id: string;
  telefone?: string;
  clienteId?: string;
  origem?: string;
  tipoEntrega?: string;
  status?: string;
  itensDetalhados?: ItemApp[];
  itensJornada?: ItemElegibilidadeJornada[];
  recompensaJornadaId?: string;
};

// ============================================================================
// Config
// ============================================================================

export async function obterConfigJornadaChef(tenantId: string = TENANT_PADRAO): Promise<ConfigJornadaChef> {
  const salva = await redis.get<ConfigJornadaChef>(chaveConfig(tenantId));
  if (!salva) return CONFIG_JORNADA_PADRAO;
  return {
    ...CONFIG_JORNADA_PADRAO,
    ...salva,
    textos: { ...CONFIG_JORNADA_PADRAO.textos, ...salva.textos },
  };
}

/**
 * Carrega o catálogo real do cardápio dinâmico oficial (@/lib/menu +
 * @/lib/promocoes) para validar/exibir a sequência de presentes — nunca
 * duplicado ou hardcodado no frontend. Pizza entra separada (tamanho +
 * sabores), nunca como um productId genérico de `catalogoDoMenu`.
 */
export async function obterCatalogoJornada(): Promise<CatalogoJornada> {
  const menu = await getMENUDinamico();
  const esgotados = ((await redis.get<string[]>("esgotados")) ?? []).map((nome) => norm(nome));
  const catalogoCompleto = catalogoDoMenu(menu as never);
  const itensIndividuais = catalogoCompleto
    .filter((p) => p.category !== "pizza")
    .map((p) => ({
      produtoId: p.productId,
      produtoNome: p.productName,
      categoria: p.category as CategoriaItemJornada,
      esgotado: esgotados.includes(norm(p.productName)),
    }));
  return {
    sizes: menu.sizes,
    saltyFlavors: menu.saltyFlavors,
    sweetFlavors: menu.sweetFlavors,
    itensIndividuais,
  };
}

/** Resumo de exibição, sempre derivado da estrutura — nunca editável
 * livremente (rule 4/6: o nome visível nunca é a identidade do produto). */
export function resumoRecompensaConfig(r: Pick<RecompensaConfigCiclo, "tipo" | "item" | "pizza" | "composicao">): string {
  if (r.tipo === "bebida_sobremesa") return r.item?.produtoNome ?? "(produto não selecionado)";
  if (r.tipo === "pizza") {
    if (!r.pizza) return "(pizza não configurada)";
    return `Pizza ${r.pizza.tamanho} — ${r.pizza.sabores.join(" / ") || "(sem sabor)"}`;
  }
  if (r.tipo === "presente_especial") {
    if (!r.composicao || r.composicao.length === 0) return "(composição vazia)";
    return r.composicao.map((c) => (c.quantidade > 1 ? `${c.quantidade}x ${c.item.produtoNome}` : c.item.produtoNome)).join(" + ");
  }
  return "(tipo desconhecido)";
}

/** Regras de segurança para a sequência de presentes poder ser salva (rule
 * 7) — retorna a lista de erros por entrada; vazia = tudo válido. Nunca
 * confia em produtoId/tamanho/sabor vindo do admin sem checar o catálogo
 * real (esgotado/removido conta como inválido). */
export function validarSequenciaRecompensas(sequencia: RecompensaConfigCiclo[], catalogo: CatalogoJornada): ErroValidacaoRecompensa[] {
  const idsDisponiveis = new Set(catalogo.itensIndividuais.filter((i) => !i.esgotado).map((i) => i.produtoId));
  const saboresValidos = new Set([...catalogo.saltyFlavors, ...catalogo.sweetFlavors].map((s) => norm(s)));
  const tamanhosValidos = new Set(catalogo.sizes.map((s) => s.code));
  const erros: ErroValidacaoRecompensa[] = [];

  sequencia.forEach((r, indice) => {
    const mensagens: string[] = [];
    if (r.tipo === "bebida_sobremesa") {
      if (!r.item || !idsDisponiveis.has(r.item.produtoId)) mensagens.push("Produto inexistente, removido ou indisponível no cardápio.");
    } else if (r.tipo === "pizza") {
      if (!r.pizza || !tamanhosValidos.has(r.pizza.tamanho)) mensagens.push("Tamanho de pizza inválido.");
      if (!r.pizza || !Array.isArray(r.pizza.sabores) || r.pizza.sabores.length === 0 || r.pizza.sabores.some((s) => !saboresValidos.has(norm(s)))) {
        mensagens.push("Sabor de pizza inválido ou não selecionado.");
      }
    } else if (r.tipo === "presente_especial") {
      if (!Array.isArray(r.composicao) || r.composicao.length === 0) {
        mensagens.push("Presente especial precisa de ao menos um item na composição.");
      } else {
        for (const c of r.composicao) {
          if (!c?.item || !idsDisponiveis.has(c.item.produtoId) || !Number.isInteger(c.quantidade) || c.quantidade < 1) {
            mensagens.push(`Item de composição inválido: ${c?.item?.produtoNome ?? "desconhecido"}.`);
          }
        }
      }
    } else {
      mensagens.push("Tipo de recompensa desconhecido.");
    }
    if (mensagens.length > 0) erros.push({ indice, id: r.id, mensagens });
  });

  return erros;
}

function normalizarSequencia(bruta: unknown[]): RecompensaConfigCiclo[] {
  const tiposValidos: TipoRecompensaJornada[] = ["bebida_sobremesa", "pizza", "presente_especial"];
  return bruta
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const tipo = tiposValidos.includes(r.tipo as TipoRecompensaJornada) ? (r.tipo as TipoRecompensaJornada) : "bebida_sobremesa";
      const item =
        r.item && typeof r.item === "object"
          ? {
              produtoId: String((r.item as Record<string, unknown>).produtoId ?? "").trim(),
              produtoNome: String((r.item as Record<string, unknown>).produtoNome ?? "").trim(),
              categoria: (r.item as Record<string, unknown>).categoria as CategoriaItemJornada,
            }
          : undefined;
      const pizza =
        r.pizza && typeof r.pizza === "object"
          ? {
              tamanho: String((r.pizza as Record<string, unknown>).tamanho ?? "").trim(),
              sabores: Array.isArray((r.pizza as Record<string, unknown>).sabores)
                ? ((r.pizza as Record<string, unknown>).sabores as unknown[]).map((s) => String(s).trim()).filter(Boolean)
                : [],
            }
          : undefined;
      const composicao = Array.isArray(r.composicao)
        ? (r.composicao as unknown[])
            .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
            .map((c) => ({
              item: {
                produtoId: String((c.item as Record<string, unknown> | undefined)?.produtoId ?? "").trim(),
                produtoNome: String((c.item as Record<string, unknown> | undefined)?.produtoNome ?? "").trim(),
                categoria: (c.item as Record<string, unknown> | undefined)?.categoria as CategoriaItemJornada,
              },
              quantidade: Math.max(1, Math.trunc(Number(c.quantidade)) || 1),
            }))
        : undefined;

      const base: RecompensaConfigCiclo = {
        id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : `rec_cfg_${Date.now()}_${randomBytes(4).toString("hex")}`,
        tipo,
        ativo: r.ativo !== false,
        produtoNome: "",
        ...(item ? { item } : {}),
        ...(pizza ? { pizza } : {}),
        ...(composicao ? { composicao } : {}),
      };
      return { ...base, produtoNome: resumoRecompensaConfig(base) };
    });
}

export type ResultadoSalvarConfigJornada = { ok: true; config: ConfigJornadaChef } | { ok: false; erro: string; detalhes?: ErroValidacaoRecompensa[] };

/**
 * Valida e persiste a config, sempre reforçando os limites econômicos
 * aprovados (rule 18/5) e a integridade da sequência de presentes (rule 7)
 * — nenhum valor perigoso ou produto inválido passa, mesmo vindo de um admin
 * autenticado. A ativação da feature (rule 8) exige uma sequência não-vazia
 * com ao menos uma recompensa ativa; nunca ativa parcialmente.
 */
export async function salvarConfigJornadaChef(
  input: Partial<ConfigJornadaChef>,
  tenantId: string = TENANT_PADRAO
): Promise<ResultadoSalvarConfigJornada> {
  const atual = await obterConfigJornadaChef(tenantId);
  const metaPizzas = clamp(Math.trunc(Number(input.metaPizzas ?? atual.metaPizzas)) || atual.metaPizzas, META_MINIMA_SEGURA, META_MAXIMA_SEGURA);
  const limitePizzasPorPedido = clamp(
    Math.trunc(Number(input.limitePizzasPorPedido ?? atual.limitePizzasPorPedido)) || atual.limitePizzasPorPedido,
    1,
    Math.min(LIMITE_MAXIMO_SEGURO, metaPizzas)
  );
  const validadeRecompensaDias = clamp(Math.trunc(Number(input.validadeRecompensaDias ?? atual.validadeRecompensaDias)) || atual.validadeRecompensaDias, 1, 365);

  const sequenciaFornecida = Array.isArray(input.sequenciaRecompensas);
  const sequenciaRecompensas = sequenciaFornecida ? normalizarSequencia(input.sequenciaRecompensas as unknown[]) : atual.sequenciaRecompensas;

  if (sequenciaFornecida) {
    const catalogo = await obterCatalogoJornada();
    const erros = validarSequenciaRecompensas(sequenciaRecompensas, catalogo);
    if (erros.length > 0) {
      return { ok: false, erro: "A sequência de presentes contém itens inválidos, removidos ou indisponíveis.", detalhes: erros };
    }
  }

  const MODOS_ROLLOUT_VALIDOS: ModoRolloutJornada[] = ["off", "canary", "on"];
  const modoRolloutSolicitado: ModoRolloutJornada = MODOS_ROLLOUT_VALIDOS.includes(input.modoRollout as ModoRolloutJornada)
    ? (input.modoRollout as ModoRolloutJornada)
    : atual.modoRollout;

  if (modoRolloutSolicitado !== "off") {
    const temRecompensaResgatavel = sequenciaRecompensas.length > 0 && sequenciaRecompensas.some((r) => r.ativo);
    if (!temRecompensaResgatavel) {
      return {
        ok: false,
        erro: "Não é possível ativar a Jornada do Chef (canário ou geral) sem ao menos uma recompensa configurada e ativa na sequência de presentes.",
      };
    }
  }

  const config: ConfigJornadaChef = {
    modoRollout: modoRolloutSolicitado,
    metaPizzas,
    limitePizzasPorPedido,
    validadeRecompensaDias,
    mensagensWhatsappAtivas: Boolean(input.mensagensWhatsappAtivas ?? atual.mensagensWhatsappAtivas),
    versaoRegra: VERSAO_REGRA_ATUAL,
    sequenciaRecompensas,
    canaryClientes: atual.canaryClientes,
    textos: {
      tituloTrilha: (input.textos?.tituloTrilha || atual.textos.tituloTrilha).toString().slice(0, 60),
      subtituloTrilha: (input.textos?.subtituloTrilha || atual.textos.subtituloTrilha).toString().slice(0, 160),
    },
    atualizadoEm: new Date().toISOString(),
  };
  await redis.set(chaveConfig(tenantId), config);
  return { ok: true, config };
}

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

// ============================================================================
// Rollout canário — função central, usada por todos os hooks/APIs/UI/WhatsApp
// (nunca duplicar esta checagem em cada rota).
// ============================================================================

/**
 * Segredo server-side para a referência opaca da lista canário — reaproveita
 * o mesmo `AUTH_SECRET` já usado para assinar sessões (staff e cliente) em
 * `@/lib/auth` e `@/lib/clienteAuth`. Ao contrário daqueles dois, aqui NUNCA
 * caímos para um segredo de desenvolvimento hardcoded: sem `AUTH_SECRET`
 * configurado, a checagem de rollout canário falha fechada (ninguém entra),
 * em vez de calcular uma referência previsível.
 */
function segredoCanario(): string | null {
  const segredo = process.env.AUTH_SECRET;
  return segredo && segredo.trim().length > 0 ? segredo : null;
}

/**
 * Referência opaca e determinística de um `clienteId` para a lista canário
 * — HMAC-SHA256 com `segredoCanario()`. Nunca reversível ao telefone sem o
 * segredo (ao contrário de guardar o `clienteId` puro, que no formato
 * `cli_<dígitos>` já contém o telefone completo). Retorna `null` (nunca uma
 * referência fraca) se o segredo não estiver disponível.
 */
function refCanario(clienteId: string): string | null {
  const segredo = segredoCanario();
  if (!segredo) return null;
  return createHmac("sha256", segredo).update(clienteId).digest("hex");
}

// Tamanho da referência opaca de analytics — 24 hex (96 bits) é suficiente
// para correlacionar eventos do mesmo cliente sem nunca expor o HMAC inteiro.
const TAMANHO_REF_ANALYTICS = 24;

/**
 * Referência opaca exclusiva de analytics — HMAC-SHA256 com o mesmo segredo
 * de `segredoCanario()`, mas com separação de domínio (mensagem prefixada
 * `"jornada-analytics:v1:"`) para NUNCA reutilizar a mesma referência da
 * lista canário (`refCanario`) nem permitir cruzar as duas por acidente.
 * Retorna `null` (nunca cai para o `clienteId` puro) se o segredo do
 * servidor não estiver disponível — o evento é gravado sem `clienteRef`.
 */
function refAnalytics(clienteId: string): string | null {
  const segredo = segredoCanario();
  if (!segredo) return null;
  return createHmac("sha256", segredo).update(`jornada-analytics:v1:${clienteId}`).digest("hex").slice(0, TAMANHO_REF_ANALYTICS);
}

/**
 * Única fonte de verdade sobre "este cliente participa da Jornada do Chef
 * agora": todo hook de crédito, toda rota (progresso, abrir, reservar,
 * resgate) e toda mensagem de WhatsApp devem checar por aqui — nunca
 * reimplementar `modoRollout === ...` em outro lugar.
 *
 * - "off": ninguém participa.
 * - "canary": só quem tem a mesma referência HMAC (`refCanario`) de uma
 *   entrada em `canaryClientes` — nunca compara telefone ou clienteId puro.
 *   Falha fechada (bloqueia) se a referência não puder ser calculada.
 * - "on": todo cliente elegível participa.
 */
export function jornadaAtivaParaCliente(config: ConfigJornadaChef, clienteId: string | null | undefined): boolean {
  if (config.modoRollout === "on") return true;
  if (config.modoRollout === "canary") {
    if (!clienteId) return false;
    const ref = refCanario(clienteId);
    if (!ref) return false; // sem segredo disponível: nunca entra em canary
    return config.canaryClientes.some((c) => c.ref === ref);
  }
  return false; // "off"
}

/** Mesmo padrão de mascaramento já usado no modelo de pontos
 * (`mascararIdentidadePontos` em fidelidade.ts) — só os últimos 4 dígitos,
 * nunca o identificador completo em log ou resposta de API. */
function mascararIdentificador(valor: string): string {
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 4 ? `…${digitos.slice(-4)}` : "…";
}

// Tamanho do prefixo público do HMAC — suficiente (48 bits) para nunca
// colidir entre os poucos clientes de teste de um canário, curto o bastante
// para nunca expor o HMAC-SHA256 completo (64 caracteres) em resposta de API.
const TAMANHO_ID_PUBLICO_CANARIO = 12;

/**
 * Adiciona um cliente à lista canário a partir do telefone. O telefone só
 * existe nesta chamada (parâmetro) e no `clienteId` derivado EM MEMÓRIA — a
 * partir daí só a referência HMAC (`ref`) e o rótulo mascarado são
 * persistidos; nenhum dos dois permite recuperar o telefone sem o segredo
 * do servidor. Nunca devolve `clienteId` nem a `ref` completa ao chamador.
 */
export async function adicionarClienteCanario(telefone: string, tenantId: string = TENANT_PADRAO): Promise<{ idPublico: string; labelMascarado: string }> {
  const clienteId = derivarClienteIdPorTelefone(telefone);
  if (!clienteId) throw new Error("Telefone inválido");
  const ref = refCanario(clienteId);
  if (!ref) throw new Error("Nao foi possivel gerar uma referencia segura (segredo do servidor indisponivel)");

  const idPublico = ref.slice(0, TAMANHO_ID_PUBLICO_CANARIO);
  const labelMascarado = mascararIdentificador(telefone);
  const config = await obterConfigJornadaChef(tenantId);
  const jaExiste = config.canaryClientes.some((c) => c.ref === ref);
  const canaryClientes = jaExiste ? config.canaryClientes : [...config.canaryClientes, { ref, idPublico, labelMascarado }];
  await redis.set(chaveConfig(tenantId), { ...config, canaryClientes, atualizadoEm: new Date().toISOString() });
  return { idPublico, labelMascarado };
}

/** Remove um cliente da lista canário pelo `idPublico` (nunca por telefone
 * ou clienteId) — passa a bloquear novos créditos/ações para ele
 * imediatamente, sem apagar progresso ou recompensas já existentes. */
export async function removerClienteCanario(idPublico: string, tenantId: string = TENANT_PADRAO): Promise<void> {
  const config = await obterConfigJornadaChef(tenantId);
  await redis.set(chaveConfig(tenantId), {
    ...config,
    canaryClientes: config.canaryClientes.filter((c) => c.idPublico !== idPublico),
    atualizadoEm: new Date().toISOString(),
  });
}

/** Lista os clientes canário para o painel — devolve só `idPublico` (para a
 * ação de remover) e `labelMascarado` (para exibição); nunca telefone,
 * clienteId ou a referência HMAC completa. */
export function listarClientesCanario(config: ConfigJornadaChef): { idPublico: string; labelMascarado: string }[] {
  return config.canaryClientes.map((c) => ({ idPublico: c.idPublico, labelMascarado: c.labelMascarado }));
}

// ============================================================================
// Contagem de pizzas elegíveis — pura, reutilizável por qualquer canal
// ============================================================================

function nomeIndicaMiniPizza(nome?: string): boolean {
  if (!nome) return false;
  return norm(nome).includes("mini");
}

/**
 * Normaliza itens estruturados do pedido do site/app (`ItemApp[]`) para o
 * formato canônico de elegibilidade. Só `kind === "pizza"` conta — mini-pizza
 * já é modelada como `kind: "simple"` no cardápio do site, então é excluída
 * naturalmente. Itens de promoção (`kind: "promo"`) NÃO contam nesta V1: o
 * bundle de uma promoção mistura item pago + item grátis em um único preço
 * combinado, sem decompor pizzas individualmente — mesma limitação que o
 * `contarPizzas()` do modelo de pontos já aceita hoje. Um item marcado com
 * `recompensaJornadaId` é o presente da própria Jornada do Chef sendo usado
 * no pedido — nunca conta para avançar a trilha de novo.
 */
export function itensJornadaDoPedidoApp(itens: ItemApp[] | undefined): ItemElegibilidadeJornada[] {
  if (!Array.isArray(itens)) return [];
  return itens
    .filter((item) => item?.kind === "pizza")
    .map((item) => ({
      categoria: nomeIndicaMiniPizza(item.name) ? ("outro" as const) : ("pizza" as const),
      quantidade: Math.max(0, Math.trunc(Number(item.qty) || 0)),
      gratuito: Boolean((item as ItemApp & { recompensaJornadaId?: string }).recompensaJornadaId),
    }));
}

/**
 * Normaliza o carrinho estruturado do bot de WhatsApp (`BotSession.cart`,
 * `CartItem[]` de `@/lib/bot`) para o formato canônico de elegibilidade. Não
 * importamos o tipo de `bot.ts` para não acoplar este módulo à lógica
 * conversacional — usamos apenas a forma estrutural mínima necessária.
 * Cada `CartItem` de pizza representa exatamente 1 unidade (quantidade é
 * expressa empilhando um item por pizza no carrinho do bot), e mini-pizza já
 * é categorizada como "lanche" pelo bot — só `category === "pizza"` conta.
 */
export function itensJornadaDoCarrinhoWhatsApp(cart: Array<{ category?: string; name?: string }> | undefined): ItemElegibilidadeJornada[] {
  if (!Array.isArray(cart)) return [];
  return cart
    .filter((item) => item?.category === "pizza")
    .map((item) => ({
      categoria: nomeIndicaMiniPizza(item.name) ? ("outro" as const) : ("pizza" as const),
      quantidade: 1,
    }));
}

/**
 * Função central e reutilizável de contagem — a única fonte de verdade sobre
 * "o que conta como pizza" para a Jornada do Chef. Não mora no bot, não faz
 * parsing de texto livre: sempre parte de dados estruturados já persistidos
 * no pedido. Pedidos antigos sem dado estruturado (`itensJornada` e
 * `itensDetalhados` ambos ausentes) usam fallback conservador: 0 — nunca
 * quebra, nunca inventa progresso.
 */
export function contarPizzasElegiveisPedido(pedido: PedidoParaJornada | null | undefined): number {
  if (!pedido || pedido.status === "cancelado") return 0;
  const itens: ItemElegibilidadeJornada[] =
    pedido.itensJornada !== undefined ? pedido.itensJornada : itensJornadaDoPedidoApp(pedido.itensDetalhados);
  return itens
    .filter((item) => item.categoria === "pizza" && !item.gratuito)
    .reduce((soma, item) => soma + Math.max(0, Math.trunc(item.quantidade)), 0);
}

// ============================================================================
// Lock genérico (SET NX + TTL + Lua compare-and-delete), namespace próprio da
// Jornada do Chef — mesmo padrão comprovado em `fidelidade.ts`
// (`comBloqueioCliente`), reimplementado aqui porque aquele helper é privado
// e amarrado ao namespace de pontos.
// ============================================================================

const LOCK_TTL_SEGUNDOS = 5;
const LOCK_MAX_TENTATIVAS = 50;
const LOCK_ESPERA_MS = 20;

const LOCK_UNLOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function gerarTokenLock(): string {
  return `${Date.now()}_${randomBytes(6).toString("hex")}`;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function comBloqueioJornada<T>(tenantId: string, clienteId: string, fn: () => Promise<T>): Promise<T> {
  const chave = chaveLock(tenantId, clienteId);
  for (let tentativa = 0; tentativa < LOCK_MAX_TENTATIVAS; tentativa++) {
    const token = gerarTokenLock();
    const obtido = await redis.set(chave, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
    if (obtido) {
      try {
        return await fn();
      } finally {
        await redis.eval(LOCK_UNLOCK_SCRIPT, [chave], [token]);
      }
    }
    await esperar(LOCK_ESPERA_MS);
  }
  throw new Error(`Nao foi possivel obter o bloqueio da Jornada do Chef para ${clienteId}`);
}

// ============================================================================
// Estado / progresso
// ============================================================================

function estadoInicial(clienteId: string): EstadoJornadaCliente {
  const agora = new Date().toISOString();
  return {
    clienteId,
    cicloAtual: 1,
    pizzasNoCiclo: 0,
    totalJornadasConcluidas: 0,
    versaoRegra: VERSAO_REGRA_ATUAL,
    criadoEm: agora,
    atualizadoEm: agora,
  };
}

export async function obterEstadoJornada(clienteId: string, tenantId: string = TENANT_PADRAO): Promise<EstadoJornadaCliente> {
  const salvo = await redis.get<EstadoJornadaCliente>(chaveProgresso(tenantId, clienteId));
  return salvo ?? estadoInicial(clienteId);
}

async function persistirEstado(tenantId: string, estado: EstadoJornadaCliente): Promise<void> {
  await redis.set(chaveProgresso(tenantId, estado.clienteId), { ...estado, atualizadoEm: new Date().toISOString() });
}

/** Fase visual (1 a 4), sempre derivada das pizzas do ciclo — nunca fonte de
 * verdade armazenada separadamente (rule 11). */
export function derivarFaseAtual(pizzasNoCiclo: number, metaPizzas: number = 12): number {
  const pizzasPorFase = metaPizzas / 4;
  return clamp(Math.floor(pizzasNoCiclo / pizzasPorFase) + 1, 1, 4);
}

export function calcularMensagemProgresso(pizzasNoCiclo: number, metaPizzas: number = 12): string {
  const faltam = metaPizzas - pizzasNoCiclo;
  if (faltam > 3) return `${pizzasNoCiclo} de ${metaPizzas} pizzas na sua Jornada do Chef.`;
  if (faltam === 3) return "Faltam só 3 pizzas para abrir seu presente 🎁";
  if (faltam === 2) return "Faltam só 2 pizzas para abrir seu presente 🎁";
  if (faltam === 1) return "Falta só 1 pizza para o seu presente 👀";
  return "Sua Jornada do Chef está completa! 🎁";
}

async function registrarEventoFase(tenantId: string, evento: FaseEventoJornada): Promise<void> {
  const chave = chaveFaseEventos(tenantId, evento.clienteId);
  const eventos = (await redis.get<FaseEventoJornada[]>(chave)) ?? [];
  await redis.set(chave, [...eventos, evento]);
}

export async function obterEventosFase(clienteId: string, tenantId: string = TENANT_PADRAO): Promise<FaseEventoJornada[]> {
  return (await redis.get<FaseEventoJornada[]>(chaveFaseEventos(tenantId, clienteId))) ?? [];
}

// ============================================================================
// Recompensa determinística
// ============================================================================

function gerarCodigoPublico(): string {
  // Token opaco para o painel da Kellyne/resgate manual — não deriva de
  // telefone/clienteId, não é reutilizável, é revogável. Aleatoriedade aqui é
  // só para imprevisibilidade do TOKEN de segurança, nunca para decidir QUAL
  // prêmio é concedido (isso é sempre determinístico, ver `escolherRecompensaDoCiclo`).
  return `JC-${randomBytes(5).toString("hex").toUpperCase()}`;
}

/** Escolha 100% determinística do prêmio de um ciclo concluído — zero RNG,
 * zero sorteio. Configurada pela Kellyne (`sequenciaRecompensas`), rotacionada
 * pelo número do ciclo concluído. Se não houver produtos configurados ainda,
 * retorna `null` — o resultado é uma caixa "fechada" pendente de configuração,
 * nunca um produto inventado. */
function escolherRecompensaDoCiclo(config: ConfigJornadaChef, cicloConcluido: number): RecompensaConfigCiclo | null {
  const ativos = config.sequenciaRecompensas.filter((r) => r.ativo);
  if (ativos.length === 0) return null;
  const indice = (cicloConcluido - 1) % ativos.length;
  return ativos[indice];
}

/** Deriva o `produtoId` estável desta recompensa concreta a partir da
 * estrutura escolhida — usado só para exibição/auditoria em `RecompensaJornada`,
 * nunca como fonte de verdade (a composição estruturada, salva junto, é a
 * fonte de verdade real). */
function derivarProdutoIdRecompensa(r: RecompensaConfigCiclo): string {
  if (r.tipo === "bebida_sobremesa") return r.item?.produtoId ?? "";
  if (r.tipo === "pizza") return r.pizza ? `pizza:${r.pizza.tamanho}:${r.pizza.sabores.join("+")}` : "";
  if (r.tipo === "presente_especial") return (r.composicao ?? []).map((c) => c.item.produtoId).join("+");
  return "";
}

async function criarRecompensa(
  tenantId: string,
  clienteId: string,
  ciclo: number,
  pedidoOrigemId: string,
  config: ConfigJornadaChef
): Promise<RecompensaJornada> {
  let escolhida = escolherRecompensaDoCiclo(config, ciclo);
  // Revalida contra o catálogo REAL e atual no momento da entrega da caixa
  // (não só no momento em que a Kellyne salvou a config) — um produto pode
  // ter ficado esgotado entre a configuração e a conclusão do ciclo. Nunca
  // entrega um produto que sumiu do cardápio (rule 7/12).
  if (escolhida) {
    const catalogoAtual = await obterCatalogoJornada();
    const erros = validarSequenciaRecompensas([escolhida], catalogoAtual);
    if (erros.length > 0) escolhida = null;
  }
  const agora = new Date().toISOString();
  const recompensaId = `rec_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const recompensa: RecompensaJornada = {
    recompensaId,
    tenantId,
    clienteId,
    ciclo,
    status: "fechada",
    tipo: escolhida?.tipo ?? null,
    produtoId: escolhida ? derivarProdutoIdRecompensa(escolhida) : null,
    produtoNome: escolhida?.produtoNome ?? null,
    ...(escolhida?.item ? { item: escolhida.item } : {}),
    ...(escolhida?.pizza ? { pizza: escolhida.pizza } : {}),
    ...(escolhida?.composicao ? { composicao: escolhida.composicao } : {}),
    versaoConfig: config.versaoRegra,
    codigoPublico: gerarCodigoPublico(),
    pedidoOrigemId,
    criadaEm: agora,
    atualizadaEm: agora,
  };
  await redis.set(chaveRecompensa(tenantId, recompensaId), recompensa);
  await redis.set(chaveCodigoResgate(tenantId, recompensa.codigoPublico), recompensaId);
  const indice = (await redis.get<string[]>(chaveRecompensasCliente(tenantId, clienteId))) ?? [];
  await redis.set(chaveRecompensasCliente(tenantId, clienteId), [...indice, recompensaId]);

  if (!escolhida) {
    await criarPendencia(tenantId, {
      clienteId,
      recompensaId,
      tipo: "produtos_nao_configurados",
      motivo: `Ciclo ${ciclo} concluído (pedido ${pedidoOrigemId}), mas nenhum produto elegível (ou disponível no cardápio agora) está configurado para a Jornada do Chef.`,
    });
  }
  return recompensa;
}

export async function obterRecompensa(recompensaId: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada | null> {
  return (await redis.get<RecompensaJornada>(chaveRecompensa(tenantId, recompensaId))) ?? null;
}

export async function obterRecompensasCliente(clienteId: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada[]> {
  const ids = (await redis.get<string[]>(chaveRecompensasCliente(tenantId, clienteId))) ?? [];
  const recompensas = await Promise.all(ids.map((id) => obterRecompensa(id, tenantId)));
  return recompensas.filter((r): r is RecompensaJornada => r !== null);
}

async function salvarRecompensa(tenantId: string, recompensa: RecompensaJornada): Promise<void> {
  await redis.set(chaveRecompensa(tenantId, recompensa.recompensaId), { ...recompensa, atualizadaEm: new Date().toISOString() });
}

function recompensaExpirada(recompensa: RecompensaJornada): boolean {
  if (!recompensa.validaAte) return false;
  return new Date(recompensa.validaAte).getTime() < Date.now();
}

/** Abre a caixa — idempotente: se já foi aberta, devolve o MESMO resultado
 * (refresh nunca muda o prêmio); protegida por lock por cliente contra
 * clique duplo/concorrência. */
export async function abrirRecompensa(clienteId: string, recompensaId: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada> {
  return comBloqueioJornada(tenantId, clienteId, async () => {
    const recompensa = await obterRecompensa(recompensaId, tenantId);
    if (!recompensa || recompensa.clienteId !== clienteId) throw new Error("Recompensa nao encontrada");
    if (recompensa.status === "disponivel" || recompensa.status === "reservada" || recompensa.status === "resgatada") {
      return recompensa; // já aberta antes — mesmo resultado
    }
    if (recompensa.status !== "fechada") throw new Error(`Recompensa nao pode ser aberta (status atual: ${recompensa.status})`);
    const config = await obterConfigJornadaChef(tenantId);
    const agora = new Date();
    const validaAte = new Date(agora.getTime() + config.validadeRecompensaDias * 24 * 60 * 60 * 1000);
    const atualizada: RecompensaJornada = {
      ...recompensa,
      status: "disponivel",
      abertaEm: agora.toISOString(),
      validaAte: validaAte.toISOString(),
    };
    await salvarRecompensa(tenantId, atualizada);
    await registrarEventoAnalytics(tenantId, "caixa_aberta", { clienteRef: refAnalytics(clienteId) ?? undefined, recompensaId });
    return atualizada;
  });
}

/** Cliente escolhe "Usar no próximo pedido" — reserva a recompensa (ainda sem
 * pedido vinculado; isso acontece só quando o pedido é de fato criado). */
export async function reservarRecompensaParaProximoPedido(clienteId: string, recompensaId: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada> {
  return comBloqueioJornada(tenantId, clienteId, async () => {
    const recompensa = await obterRecompensa(recompensaId, tenantId);
    if (!recompensa || recompensa.clienteId !== clienteId) throw new Error("Recompensa nao encontrada");
    if (recompensa.status === "reservada" && !recompensa.reservaPedidoId) return recompensa; // idempotente
    if (recompensa.status !== "disponivel") throw new Error(`Recompensa nao esta disponivel para reserva (status atual: ${recompensa.status})`);
    if (recompensaExpirada(recompensa)) {
      const expirada: RecompensaJornada = { ...recompensa, status: "expirada", expiradaEm: new Date().toISOString() };
      await salvarRecompensa(tenantId, expirada);
      throw new Error("Recompensa expirada");
    }
    const atualizada: RecompensaJornada = { ...recompensa, status: "reservada", reservadaEm: new Date().toISOString() };
    await salvarRecompensa(tenantId, atualizada);
    return atualizada;
  });
}

/** "Permitir remover a reserva sem perder o prêmio" — só funciona antes de a
 * reserva ser vinculada a um pedido de verdade. */
export async function cancelarReservaRecompensa(clienteId: string, recompensaId: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada> {
  return comBloqueioJornada(tenantId, clienteId, async () => {
    const recompensa = await obterRecompensa(recompensaId, tenantId);
    if (!recompensa || recompensa.clienteId !== clienteId) throw new Error("Recompensa nao encontrada");
    if (recompensa.status !== "reservada" || recompensa.reservaPedidoId) {
      throw new Error(`Reserva nao pode ser removida (status atual: ${recompensa.status})`);
    }
    const atualizada: RecompensaJornada = { ...recompensa, status: "disponivel", reservadaEm: undefined };
    await salvarRecompensa(tenantId, atualizada);
    return atualizada;
  });
}

/** Vincula a reserva a um pedido real — chamado na criação do pedido quando o
 * item-presente está no carrinho. Nunca confia em `clienteId`/`recompensaId`
 * vindos do frontend sem checar a sessão e a propriedade no servidor (isso é
 * responsabilidade do chamador, na rota de pedido). Idempotente por pedidoId. */
export async function confirmarReservaNoPedido(clienteId: string, recompensaId: string, pedidoId: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada> {
  return comBloqueioJornada(tenantId, clienteId, async () => {
    const recompensa = await obterRecompensa(recompensaId, tenantId);
    if (!recompensa || recompensa.clienteId !== clienteId) throw new Error("Recompensa nao encontrada");
    if (recompensa.reservaPedidoId === pedidoId) return recompensa; // reprocessamento idempotente
    if (recompensa.status !== "reservada" || recompensa.reservaPedidoId) {
      throw new Error(`Recompensa nao esta disponivel para uso neste pedido (status atual: ${recompensa.status})`);
    }
    if (recompensaExpirada(recompensa)) throw new Error("Recompensa expirada");
    const atualizada: RecompensaJornada = { ...recompensa, reservaPedidoId: pedidoId };
    await salvarRecompensa(tenantId, atualizada);
    await registrarEventoAnalytics(tenantId, "recompensa_reservada", { clienteRef: refAnalytics(clienteId) ?? undefined, recompensaId, pedidoId });
    return atualizada;
  });
}

/** Confirma o resgate definitivo — chamado quando o pedido que usou o
 * presente chega ao status final (entregue/retirado/finalizado). */
async function confirmarResgateRecompensa(clienteId: string, recompensaId: string, pedidoId: string, tenantId: string): Promise<void> {
  await comBloqueioJornada(tenantId, clienteId, async () => {
    const recompensa = await obterRecompensa(recompensaId, tenantId);
    if (!recompensa || recompensa.status === "resgatada") return; // idempotente / já resgatada
    if (recompensa.reservaPedidoId !== pedidoId || recompensa.status !== "reservada") return;
    const atualizada: RecompensaJornada = { ...recompensa, status: "resgatada", resgatadaEm: new Date().toISOString() };
    await salvarRecompensa(tenantId, atualizada);
    await registrarEventoAnalytics(tenantId, "recompensa_resgatada", { clienteRef: refAnalytics(clienteId) ?? undefined, recompensaId, pedidoId });
  });
}

/** Libera a reserva quando o pedido que a usava é cancelado antes de chegar
 * ao status final — devolve a recompensa para "disponivel". Se já havia sido
 * resgatada (pedido cancelado tarde demais), NUNCA reverte silenciosamente:
 * abre pendência para revisão da Kellyne. */
async function liberarOuSinalizarRecompensaCancelada(clienteId: string, recompensaId: string, pedidoId: string, tenantId: string): Promise<void> {
  await comBloqueioJornada(tenantId, clienteId, async () => {
    const recompensa = await obterRecompensa(recompensaId, tenantId);
    if (!recompensa) return;
    if (recompensa.status === "reservada" && recompensa.reservaPedidoId === pedidoId) {
      const atualizada: RecompensaJornada = { ...recompensa, status: "disponivel", reservaPedidoId: undefined, reservadaEm: undefined };
      await salvarRecompensa(tenantId, atualizada);
      return;
    }
    if (recompensa.status === "resgatada" && recompensa.reservaPedidoId === pedidoId) {
      await criarPendencia(tenantId, {
        clienteId,
        pedidoId,
        recompensaId,
        tipo: "reversao_apos_abertura",
        motivo: `Pedido ${pedidoId} cancelado, mas o presente da Jornada do Chef ja havia sido marcado como resgatado.`,
      });
    }
  });
}

/** Aplicação manual pela Kellyne (fallback obrigatório, rule 15) — não passa
 * pelo fluxo automático de carrinho/pedido do site. `aplicadoPor` só é usado
 * para o evento de analytics e deve ser o papel operacional (ex.: "admin"),
 * nunca um nome de usuário ou nome completo recuperável. */
export async function aplicarResgateManual(codigoPublico: string, aplicadoPor: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada> {
  const recompensaId = await redis.get<string>(chaveCodigoResgate(tenantId, codigoPublico));
  if (!recompensaId) throw new Error("Codigo de resgate invalido ou revogado");
  const recompensa = await obterRecompensa(recompensaId, tenantId);
  if (!recompensa) throw new Error("Recompensa nao encontrada");
  return comBloqueioJornada(tenantId, recompensa.clienteId, async () => {
    const atual = await obterRecompensa(recompensaId, tenantId);
    if (!atual) throw new Error("Recompensa nao encontrada");
    if (atual.status === "resgatada") throw new Error("Codigo ja foi utilizado");
    if (atual.status !== "disponivel" && atual.status !== "reservada") {
      throw new Error(`Recompensa nao pode ser resgatada manualmente (status atual: ${atual.status})`);
    }
    const atualizada: RecompensaJornada = { ...atual, status: "resgatada", resgatadaEm: new Date().toISOString() };
    await salvarRecompensa(tenantId, atualizada);
    await registrarEventoAnalytics(tenantId, "resgate_manual", { clienteRef: refAnalytics(atual.clienteId) ?? undefined, recompensaId, papelOperador: aplicadoPor });
    return atualizada;
  });
}

/** Revoga um código de resgate (perdido/comprometido) sem afetar o status da
 * recompensa em si — gera um novo código. */
export async function revogarCodigoResgate(recompensaId: string, tenantId: string = TENANT_PADRAO): Promise<RecompensaJornada> {
  const recompensa = await obterRecompensa(recompensaId, tenantId);
  if (!recompensa) throw new Error("Recompensa nao encontrada");
  return comBloqueioJornada(tenantId, recompensa.clienteId, async () => {
    const atual = await obterRecompensa(recompensaId, tenantId);
    if (!atual) throw new Error("Recompensa nao encontrada");
    await redis.del(chaveCodigoResgate(tenantId, atual.codigoPublico));
    const novoCodigo = gerarCodigoPublico();
    const atualizada: RecompensaJornada = { ...atual, codigoPublico: novoCodigo };
    await redis.set(chaveCodigoResgate(tenantId, novoCodigo), recompensaId);
    await salvarRecompensa(tenantId, atualizada);
    return atualizada;
  });
}

/** Substituição manual — só por produto permitido e valor igual/superior;
 * toda substituição fica registrada (rule 14). */
export async function substituirRecompensa(
  recompensaId: string,
  novoProdutoId: string,
  novoProdutoNome: string,
  motivo: string,
  por: string,
  tenantId: string = TENANT_PADRAO
): Promise<RecompensaJornada> {
  const recompensa = await obterRecompensa(recompensaId, tenantId);
  if (!recompensa) throw new Error("Recompensa nao encontrada");
  return comBloqueioJornada(tenantId, recompensa.clienteId, async () => {
    const atual = await obterRecompensa(recompensaId, tenantId);
    if (!atual) throw new Error("Recompensa nao encontrada");
    if (atual.status === "resgatada" || atual.status === "cancelada" || atual.status === "expirada") {
      throw new Error(`Recompensa nao pode ser substituida (status atual: ${atual.status})`);
    }
    const historico = atual.historicoSubstituicao ?? [];
    const atualizada: RecompensaJornada = {
      ...atual,
      produtoId: novoProdutoId,
      produtoNome: novoProdutoNome,
      historicoSubstituicao: [
        ...historico,
        { produtoIdAnterior: atual.produtoId ?? "(nenhum)", produtoIdNovo: novoProdutoId, produtoNomeNovo: novoProdutoNome, motivo: `${motivo} (por ${por})`, em: new Date().toISOString() },
      ],
    };
    await salvarRecompensa(tenantId, atualizada);
    return atualizada;
  });
}

/** Suspende uma recompensa (ex.: reversão de crédito) para revisão manual. */
async function suspenderRecompensaSeAbrivel(tenantId: string, recompensaId: string, motivo: string): Promise<void> {
  const recompensa = await obterRecompensa(recompensaId, tenantId);
  if (!recompensa) return;
  if (recompensa.status !== "fechada" && recompensa.status !== "disponivel") return;
  const atualizada: RecompensaJornada = { ...recompensa, status: "suspensa", suspensaEm: new Date().toISOString(), motivoSuspensao: motivo };
  await salvarRecompensa(tenantId, atualizada);
}

async function cancelarRecompensa(tenantId: string, recompensaId: string): Promise<void> {
  const recompensa = await obterRecompensa(recompensaId, tenantId);
  if (!recompensa) return;
  const atualizada: RecompensaJornada = { ...recompensa, status: "cancelada", canceladaEm: new Date().toISOString() };
  await salvarRecompensa(tenantId, atualizada);
}

// ============================================================================
// Pendências de revisão (fallback Kellyne)
// ============================================================================

async function criarPendencia(tenantId: string, input: Omit<PendenciaRevisaoJornada, "pendenciaId" | "tenantId" | "criadaEm">): Promise<PendenciaRevisaoJornada> {
  const pendencia: PendenciaRevisaoJornada = {
    ...input,
    pendenciaId: `pnd_${Date.now()}_${randomBytes(4).toString("hex")}`,
    tenantId,
    criadaEm: new Date().toISOString(),
  };
  const chave = chavePendencias(tenantId);
  const atuais = (await redis.get<PendenciaRevisaoJornada[]>(chave)) ?? [];
  await redis.set(chave, [...atuais, pendencia]);
  return pendencia;
}

export async function obterPendencias(tenantId: string = TENANT_PADRAO, incluirResolvidas = false): Promise<PendenciaRevisaoJornada[]> {
  const pendencias = (await redis.get<PendenciaRevisaoJornada[]>(chavePendencias(tenantId))) ?? [];
  return incluirResolvidas ? pendencias : pendencias.filter((p) => !p.resolvidaEm);
}

export async function resolverPendencia(pendenciaId: string, resolvidaPor: string, nota: string, tenantId: string = TENANT_PADRAO): Promise<void> {
  const chave = chavePendencias(tenantId);
  const pendencias = (await redis.get<PendenciaRevisaoJornada[]>(chave)) ?? [];
  const atualizadas = pendencias.map((p) =>
    p.pendenciaId === pendenciaId ? { ...p, resolvidaEm: new Date().toISOString(), resolvidaPor, notaResolucao: nota } : p
  );
  await redis.set(chave, atualizadas);
}

// ============================================================================
// Analytics sanitizado (rule 19) — nunca telefone/nome/token/cookie/OTP.
// ============================================================================

type EventoAnalyticsJornada =
  | "jornada_creditada"
  | "fase_concluida"
  | "caixa_desbloqueada"
  | "caixa_aberta"
  | "recompensa_reservada"
  | "recompensa_aplicada"
  | "recompensa_resgatada"
  | "recompensa_expirada"
  | "credito_revertido"
  | "resgate_manual"
  | "falha_processamento";

const LIMITE_EVENTOS_ANALYTICS = 2000;

// Defesa em profundidade: mesmo que um chamador erre e envie um campo
// sensível (clienteId, telefone, nome, cookie, token, otp, codigoPublico,
// usuário/nome de quem aplicou), o registrador remove antes de persistir —
// nunca confiamos apenas na disciplina de cada call site.
const CHAVES_PROIBIDAS_ANALYTICS = new Set([
  "clienteid",
  "telefone",
  "phone",
  "nome",
  "name",
  "cookie",
  "token",
  "otp",
  "codigopublico",
  "aplicadopor",
  "username",
  "senha",
  "password",
]);

function sanitizarDetalhesAnalytics(detalhes: Record<string, string | number | undefined>): Record<string, string | number | undefined> {
  const limpo: Record<string, string | number | undefined> = {};
  for (const [chave, valor] of Object.entries(detalhes)) {
    if (CHAVES_PROIBIDAS_ANALYTICS.has(chave.toLowerCase())) continue;
    if (valor === undefined) continue;
    limpo[chave] = valor;
  }
  return limpo;
}

export async function registrarEventoAnalytics(tenantId: string, tipo: EventoAnalyticsJornada, detalhes: Record<string, string | number | undefined>): Promise<void> {
  try {
    const chave = chaveEventosAnalytics(tenantId);
    const eventos = (await redis.get<unknown[]>(chave)) ?? [];
    const evento = { tipo, criadoEm: new Date().toISOString(), ...sanitizarDetalhesAnalytics(detalhes) };
    const atualizados = [...eventos, evento].slice(-LIMITE_EVENTOS_ANALYTICS);
    await redis.set(chave, atualizados);
  } catch {
    // analytics nunca pode derrubar o fluxo principal
  }
}

// ============================================================================
// Processamento centralizado da conclusão de pedido — chamado pelas 3
// transições oficiais de status (painel, app do entregador, confirmação via
// WhatsApp). Idempotente por pedidoId, protegido por lock por cliente.
// ============================================================================

export type ResultadoProcessamentoJornada = {
  processado: boolean;
  pizzasElegiveisTotal: number;
  pizzasNaTrilha: number;
  progressoAntes: { ciclo: number; pizzasNoCiclo: number };
  progressoDepois: { ciclo: number; pizzasNoCiclo: number };
  fasesCruzadas: number[];
  recompensasDesbloqueadas: RecompensaJornada[];
};

function statusCorrespondeAConclusao(pedido: PedidoParaJornada): boolean {
  // "entregue" é o único status persistido para as 3 modalidades (delivery,
  // retirada, consumo local) — o rótulo "Entregue"/"Retirado"/"Finalizado" é
  // só de exibição (derivado de tipoEntrega em src/lib/clientePedidos.ts).
  return pedido.status === "entregue";
}

export async function processarConclusaoPedidoJornada(pedido: PedidoParaJornada, tenantId: string = TENANT_PADRAO): Promise<ResultadoProcessamentoJornada | null> {
  try {
    const config = await obterConfigJornadaChef(tenantId);
    if (!statusCorrespondeAConclusao(pedido)) return null;

    const clienteId = derivarClienteIdPorTelefone(pedido.telefone) ?? pedido.clienteId;
    if (!clienteId || !jornadaAtivaParaCliente(config, clienteId)) return null;

    // Confirma o resgate do presente da Jornada, se este pedido usou um —
    // parte do mesmo hook centralizado (rule 13/14), nunca duplicado em rotas.
    if (pedido.recompensaJornadaId) {
      await confirmarResgateRecompensa(clienteId, pedido.recompensaJornadaId, pedido.id, tenantId).catch((err) =>
        console.error("[ChefeBot] Erro ao confirmar resgate da Jornada do Chef (ignorado):", err)
      );
    }

    const chaveIdempotencia = chavePedidoJornada(tenantId, pedido.id);
    const existente = await redis.get<RegistroProcessamentoPedidoJornada>(chaveIdempotencia);
    if (existente) {
      const recompensas = await Promise.all(existente.recompensasCriadasIds.map((id) => obterRecompensa(id, tenantId)));
      return {
        processado: false,
        pizzasElegiveisTotal: existente.pizzasElegiveisTotal,
        pizzasNaTrilha: existente.pizzasNaTrilha,
        progressoAntes: existente.progressoAntes,
        progressoDepois: existente.progressoDepois,
        fasesCruzadas: existente.fasesCruzadas,
        recompensasDesbloqueadas: recompensas.filter((r): r is RecompensaJornada => r !== null),
      };
    }

    const pizzasElegiveisTotal = contarPizzasElegiveisPedido(pedido);
    const pizzasNaTrilha = Math.min(pizzasElegiveisTotal, config.limitePizzasPorPedido);

    const resultado = await comBloqueioJornada(tenantId, clienteId, async () => {
      // Double-check dentro do lock: outra chamada concorrente pode ter
      // processado este mesmo pedido enquanto esperávamos o lock.
      const jaProcessado = await redis.get<RegistroProcessamentoPedidoJornada>(chaveIdempotencia);
      if (jaProcessado) {
        const recompensas = await Promise.all(jaProcessado.recompensasCriadasIds.map((id) => obterRecompensa(id, tenantId)));
        return {
          processado: false,
          pizzasElegiveisTotal: jaProcessado.pizzasElegiveisTotal,
          pizzasNaTrilha: jaProcessado.pizzasNaTrilha,
          progressoAntes: jaProcessado.progressoAntes,
          progressoDepois: jaProcessado.progressoDepois,
          fasesCruzadas: jaProcessado.fasesCruzadas,
          recompensasDesbloqueadas: recompensas.filter((r): r is RecompensaJornada => r !== null),
        };
      }

      const estadoAntes = await obterEstadoJornada(clienteId, tenantId);
      const progressoAntes = { ciclo: estadoAntes.cicloAtual, pizzasNoCiclo: estadoAntes.pizzasNoCiclo };

      let cicloAtual = estadoAntes.cicloAtual;
      let pizzasNoCiclo = estadoAntes.pizzasNoCiclo;
      let totalConcluidas = estadoAntes.totalJornadasConcluidas;
      let restante = pizzasNaTrilha;
      const fasesCruzadasComCiclo: { ciclo: number; marco: number }[] = [];
      const recompensasDesbloqueadas: RecompensaJornada[] = [];
      const pizzasPorFase = config.metaPizzas / 4;
      const marcos = [Math.round(pizzasPorFase), Math.round(pizzasPorFase * 2), Math.round(pizzasPorFase * 3), config.metaPizzas];

      while (restante > 0) {
        const espacoNoCiclo = config.metaPizzas - pizzasNoCiclo;
        const usar = Math.min(restante, espacoNoCiclo);
        const antes = pizzasNoCiclo;
        pizzasNoCiclo += usar;
        restante -= usar;
        for (const marco of marcos) {
          if (antes < marco && pizzasNoCiclo >= marco) fasesCruzadasComCiclo.push({ ciclo: cicloAtual, marco });
        }
        if (pizzasNoCiclo >= config.metaPizzas) {
          const recompensa = await criarRecompensa(tenantId, clienteId, cicloAtual, pedido.id, config);
          recompensasDesbloqueadas.push(recompensa);
          totalConcluidas += 1;
          cicloAtual += 1;
          pizzasNoCiclo = 0;
        }
      }
      const fasesCruzadas = fasesCruzadasComCiclo.map((f) => f.marco);

      const estadoDepois: EstadoJornadaCliente = {
        clienteId,
        cicloAtual,
        pizzasNoCiclo,
        totalJornadasConcluidas: totalConcluidas,
        versaoRegra: VERSAO_REGRA_ATUAL,
        criadoEm: estadoAntes.criadoEm,
        atualizadoEm: new Date().toISOString(),
      };
      if (pizzasNaTrilha > 0) await persistirEstado(tenantId, estadoDepois);

      const progressoDepois = { ciclo: estadoDepois.cicloAtual, pizzasNoCiclo: estadoDepois.pizzasNoCiclo };

      for (const { ciclo, marco } of fasesCruzadasComCiclo) {
        await registrarEventoFase(tenantId, {
          clienteId,
          ciclo,
          marco,
          faseConcluida: Math.min(4, Math.round(marco / (config.metaPizzas / 4))),
          pedidoId: pedido.id,
          criadoEm: new Date().toISOString(),
        });
      }

      const registro: RegistroProcessamentoPedidoJornada = {
        pedidoId: pedido.id,
        tenantId,
        clienteId,
        canal: pedido.origem,
        tipoAtendimento: pedido.tipoEntrega,
        statusQueGerouCredito: pedido.status ?? "entregue",
        pizzasElegiveisTotal,
        pizzasNaTrilha,
        progressoAntes,
        progressoDepois,
        fasesCruzadas,
        recompensasCriadasIds: recompensasDesbloqueadas.map((r) => r.recompensaId),
        processadoEm: new Date().toISOString(),
      };
      await redis.set(chaveIdempotencia, registro);

      await registrarEventoAnalytics(tenantId, "jornada_creditada", { clienteRef: refAnalytics(clienteId) ?? undefined, pedidoId: pedido.id, pizzasNaTrilha });
      for (const marco of fasesCruzadas) {
        if (marco < config.metaPizzas) await registrarEventoAnalytics(tenantId, "fase_concluida", { clienteRef: refAnalytics(clienteId) ?? undefined, pedidoId: pedido.id, marco });
      }
      for (const recompensa of recompensasDesbloqueadas) {
        await registrarEventoAnalytics(tenantId, "caixa_desbloqueada", { clienteRef: refAnalytics(clienteId) ?? undefined, pedidoId: pedido.id, recompensaId: recompensa.recompensaId });
      }

      return { processado: true, pizzasElegiveisTotal, pizzasNaTrilha, progressoAntes, progressoDepois, fasesCruzadas, recompensasDesbloqueadas };
    });

    if (resultado.processado) {
      await enviarMensagensProgresso(pedido, resultado, config, tenantId).catch((err) =>
        console.error("[ChefeBot] Erro ao enviar mensagem de WhatsApp da Jornada do Chef (ignorado):", err)
      );
    }
    return resultado;
  } catch (err) {
    console.error("[ChefeBot] Erro ao processar Jornada do Chef (ignorado):", err);
    await registrarEventoAnalytics(tenantId, "falha_processamento", { pedidoId: pedido?.id });
    return null;
  }
}

/**
 * Reverte o crédito de um pedido reaberto/cancelado/estornado após já ter
 * avançado a trilha (rule 9). Política de segurança:
 *  - Se nada aconteceu depois (estado atual == snapshot "depois" salvo) E a(s)
 *    recompensa(s) criada(s) por este pedido ainda não foram abertas/usadas:
 *    reverte de forma completa e auditável (desfaz o delta e cancela a(s)
 *    recompensa(s)).
 *  - Caso contrário (progresso já avançou mais desde então, ou a recompensa já
 *    foi aberta/reservada/resgatada): NUNCA mexe no progresso retroativamente
 *    (isso corromperia avanços legítimos posteriores) — suspende a(s)
 *    recompensa(s) ainda "fechada"/"disponivel" e abre pendência para revisão
 *    manual da Kellyne. Nunca cria saldo negativo silenciosamente.
 */
export async function reverterConclusaoPedidoJornada(pedidoId: string, motivo: string, tenantId: string = TENANT_PADRAO): Promise<{ ok: boolean; pendenciaAberta: boolean }> {
  const chaveIdempotencia = chavePedidoJornada(tenantId, pedidoId);
  const registro = await redis.get<RegistroProcessamentoPedidoJornada>(chaveIdempotencia);
  if (!registro) return { ok: true, pendenciaAberta: false }; // nunca creditou — nada a reverter

  // Também libera/sinaliza a reserva do presente usado neste pedido, se houver.
  // (Chamado pelo caller antes de invocar esta função, já que só ele tem o
  // `recompensaJornadaId` do pedido — ver integração em src/app/api/orders/route.ts.)

  if (registro.revertidoEm || registro.pendenciaRevisaoEm) return { ok: true, pendenciaAberta: Boolean(registro.pendenciaRevisaoEm) };

  return comBloqueioJornada(tenantId, registro.clienteId, async () => {
    const atual = await redis.get<RegistroProcessamentoPedidoJornada>(chaveIdempotencia);
    if (!atual || atual.revertidoEm || atual.pendenciaRevisaoEm) return { ok: true, pendenciaAberta: Boolean(atual?.pendenciaRevisaoEm) };

    if (atual.pizzasNaTrilha === 0) {
      await redis.set(chaveIdempotencia, { ...atual, revertidoEm: new Date().toISOString() });
      return { ok: true, pendenciaAberta: false };
    }

    const recompensas = await Promise.all(atual.recompensasCriadasIds.map((id) => obterRecompensa(id, tenantId)));
    // Só é seguro reverter automaticamente se NENHUMA recompensa criada por
    // este pedido já foi aberta (o cliente ainda não viu o prêmio) — "disponivel"
    // já significa "caixa aberta", e rule 9 proíbe reverter isso sem sinalização.
    const nenhumaFoiAberta = recompensas.every((r) => !r || r.status === "fechada");

    const estadoAtual = await obterEstadoJornada(atual.clienteId, tenantId);
    const nadaMudouDesdeEntao = estadoAtual.cicloAtual === atual.progressoDepois.ciclo && estadoAtual.pizzasNoCiclo === atual.progressoDepois.pizzasNoCiclo;

    if (nenhumaFoiAberta && nadaMudouDesdeEntao) {
      // Reversão total e segura: desfaz exatamente o delta deste pedido.
      const estadoRevertido: EstadoJornadaCliente = {
        ...estadoAtual,
        cicloAtual: atual.progressoAntes.ciclo,
        pizzasNoCiclo: atual.progressoAntes.pizzasNoCiclo,
        totalJornadasConcluidas: Math.max(0, estadoAtual.totalJornadasConcluidas - atual.recompensasCriadasIds.length),
      };
      await persistirEstado(tenantId, estadoRevertido);
      for (const id of atual.recompensasCriadasIds) await cancelarRecompensa(tenantId, id);
      await redis.set(chaveIdempotencia, { ...atual, revertidoEm: new Date().toISOString() });
      await registrarEventoAnalytics(tenantId, "credito_revertido", { clienteRef: refAnalytics(atual.clienteId) ?? undefined, pedidoId });
      return { ok: true, pendenciaAberta: false };
    }

    // Caminho conservador: suspende o que ainda dá para suspender e abre
    // pendência — nunca mexe em progresso que já avançou por pedidos
    // posteriores, nunca reverte prêmio já aberto/reservado/resgatado.
    for (const r of recompensas) {
      if (r && (r.status === "fechada" || r.status === "disponivel")) {
        await suspenderRecompensaSeAbrivel(tenantId, r.recompensaId, motivo);
      }
    }
    await criarPendencia(tenantId, {
      clienteId: atual.clienteId,
      pedidoId,
      tipo: nenhumaFoiAberta ? "reversao_progresso_avancado" : "reversao_apos_abertura",
      motivo,
    });
    await redis.set(chaveIdempotencia, { ...atual, pendenciaRevisaoEm: new Date().toISOString() });
    return { ok: true, pendenciaAberta: true };
  });
}

/** Libera (ou sinaliza para revisão) a reserva do presente usado num pedido
 * cancelado — chamar junto com `reverterConclusaoPedidoJornada` no mesmo
 * ponto de cancelamento. */
export async function liberarRecompensaDePedidoCancelado(pedido: PedidoParaJornada, tenantId: string = TENANT_PADRAO): Promise<void> {
  if (!pedido.recompensaJornadaId) return;
  const clienteId = derivarClienteIdPorTelefone(pedido.telefone) ?? pedido.clienteId;
  if (!clienteId) return;
  await liberarOuSinalizarRecompensaCancelada(clienteId, pedido.recompensaJornadaId, pedido.id, tenantId).catch((err) =>
    console.error("[ChefeBot] Erro ao liberar recompensa da Jornada do Chef apos cancelamento (ignorado):", err)
  );
}

// ============================================================================
// Mensagens de WhatsApp (rule 17) — reaproveita a função oficial de envio,
// nunca duplica a mesma mensagem (dedupe por pedidoId+tipo).
// ============================================================================

async function jaEnviouMensagem(tenantId: string, pedidoId: string, tipo: string): Promise<boolean> {
  const chave = chaveMensagemEnviada(tenantId, pedidoId, tipo);
  const marcado = await redis.set(chave, true, { nx: true, ex: 3 * 24 * 60 * 60 });
  return !marcado; // marcado === null quando a chave já existia
}

async function enviarMensagensProgresso(
  pedido: PedidoParaJornada,
  resultado: ResultadoProcessamentoJornada,
  config: ConfigJornadaChef,
  tenantId: string
): Promise<void> {
  if (!config.mensagensWhatsappAtivas || !pedido.telefone) return;
  if (resultado.pizzasNaTrilha <= 0) return;

  if (resultado.recompensasDesbloqueadas.length > 0) {
    if (!(await jaEnviouMensagem(tenantId, pedido.id, "caixa"))) {
      await enviarTextoWhatsApp(pedido.telefone, "Você completou sua Jornada do Chef! Seu presente está esperando no seu perfil 🎁");
    }
    return;
  }

  const faltam = config.metaPizzas - resultado.progressoDepois.pizzasNoCiclo;
  if (faltam === 1) {
    if (!(await jaEnviouMensagem(tenantId, pedido.id, "quase_vitoria"))) {
      await enviarTextoWhatsApp(pedido.telefone, "Falta só 1 pizza para você abrir seu presente 🎁");
    }
    return;
  }

  if (!(await jaEnviouMensagem(tenantId, pedido.id, "progresso"))) {
    await enviarTextoWhatsApp(
      pedido.telefone,
      `Seu pedido foi concluído! ${resultado.pizzasNaTrilha} pizza${resultado.pizzasNaTrilha === 1 ? "" : "s"} avançaram na sua Jornada do Chef. Agora você está em ${resultado.progressoDepois.pizzasNoCiclo} de ${config.metaPizzas} 🍕`
    );
  }
}
