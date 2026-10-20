// Regras puras do Ranking 3. Não lê nem altera temporadas/resultados legados.
import type { MovimentoPontos } from "../fidelidade";
import type { MovimentoBonusTemporada } from "../rankingBonusTemporada";
import { REGRA_ESTRELAS_V1 } from "../estrelas";
import type { PizzaCatalog } from "../catalog/pizzas";
import type { ItemApp } from "../pedidoAppItens";

export const FUSO = "America/Sao_Paulo";
export const QUINZE_DIAS = 15 * 86_400_000;
export type Liga = 1 | 2 | 3;
export type Janela = { id: string; indice: number; inicio: string; fim: string };
export type Classificado = { clienteId: string; score: number; atingidoEm: number | null };
export type Cohort = { top10: string[]; nivel3: string[]; meta: number | null; pendentes: string[] };
export type Resultado = {
  janela: Janela; normal: Classificado[]; top10: Classificado[];
  campeoes: { liga: 1 | 2; clienteId: string }[];
  proximo: Cohort; decisaoPendente: "menos_de_dez_promovidos" | "meta_indisponivel" | null;
};
export type Premio = {
  id: string; temporadaId: string; clienteId: string; liga: 1 | 2;
  tetoCents: 4700 | 5000; concedidoEm: string;
  estado: "disponivel" | "associado" | "em_preparo" | "saiu_entrega" | "entregue";
  pedidoId?: string; tentativaId?: string; ultimoCancelamentoPedidoId?: string;
  proximoAvisoEm: number; revisao: number;
};

function partes(ms: number) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(ms);
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(p.find((v) => v.type === type)?.value);
  return { ano: n("year"), mes: n("month"), dia: n("day"), hora: n("hour"), minuto: n("minute"), segundo: n("second") };
}

// Converte data CIVIL para 03h local usando o fuso IANA, inclusive DST histórico.
export function corteCivil(data: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("data_civil_invalida");
  const [ano, mes, dia] = data.split("-").map(Number);
  const alvo = Date.UTC(ano, mes - 1, dia, 3);
  let utc = alvo;
  for (let i = 0; i < 4; i++) {
    const p = partes(utc);
    const observado = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
    if (observado === alvo) return new Date(utc).toISOString();
    utc += alvo - observado;
  }
  throw new Error("corte_local_inexistente");
}

export function janelaTemporada(ancora: string, indice: number): Janela {
  if (!Number.isSafeInteger(indice) || indice < 0 || indice > 10000) throw new Error("indice_invalido");
  // Valida também datas inválidas que Date normalizaria (31/02 etc.).
  const inicioAncora = corteCivil(ancora);
  const p = partes(Date.parse(inicioAncora));
  if (`${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}` !== ancora) throw new Error("ancora_invalida");
  const dia = (offset: number) => new Date(Date.UTC(p.ano, p.mes - 1, p.dia + offset)).toISOString().slice(0, 10);
  return { id: `r3-${ancora}-${indice}`, indice, inicio: corteCivil(dia(indice * 30)), fim: corteCivil(dia((indice + 1) * 30)) };
}

export function janelaAtual(ancora: string, agora: number): Janela | null {
  const primeira = janelaTemporada(ancora, 0);
  if (!Number.isFinite(agora)) throw new Error("agora_invalido");
  if (agora < Date.parse(primeira.inicio)) return null;
  let indice = Math.max(0, Math.floor((agora - Date.parse(primeira.inicio)) / (30 * 86_400_000)));
  let janela = janelaTemporada(ancora, indice);
  while (Date.parse(janela.inicio) > agora) janela = janelaTemporada(ancora, --indice);
  while (Date.parse(janela.fim) <= agora) janela = janelaTemporada(ancora, ++indice);
  return janela;
}

// Carteira gasta NÃO reduz mérito. Estorno real de crédito reduz; previsto não conta.
// Intervalo semiaberto: um evento exatamente às 03h pertence só ao novo ciclo.
export function scoreCompetitivo(movimentos: MovimentoPontos[], bonus: MovimentoBonusTemporada[], janela: Janela): Omit<Classificado, "clienteId"> {
  const inicio = Date.parse(janela.inicio), fim = Date.parse(janela.fim);
  const eventos = [
    ...movimentos.filter((m) => m.regraVersao === REGRA_ESTRELAS_V1 && ["confirmado", "ajuste", "estornado"].includes(m.tipo))
      .map((m) => ({ ms: Date.parse(m.createdAt), pontos: m.tipo === "estornado" ? -m.pontos : m.pontos })),
    ...bonus.map((m) => ({ ms: Date.parse(m.createdAt), pontos: m.pontos })),
  ].filter((e) => e.ms >= inicio && e.ms < fim && Number.isFinite(e.pontos)).sort((a, b) => a.ms - b.ms);
  let score = 0, atingidoEm: number | null = null;
  for (const evento of eventos) {
    const novo = Math.max(0, Math.round(score + evento.pontos));
    // Preserva o timestamp do primeiro crédito positivo usado pelo projetor
    // da main (calcularScoreDaTemporada); depois vem o ID estável.
    if (novo > 0 && atingidoEm === null) atingidoEm = evento.ms;
    score = novo;
  }
  return { score, atingidoEm };
}

export function ordenar(entradas: Classificado[]): Classificado[] {
  if (new Set(entradas.map((e) => e.clienteId)).size !== entradas.length) throw new Error("participante_duplicado");
  return [...entradas].sort((a, b) => b.score - a.score || (a.atingidoEm ?? Infinity) - (b.atingidoEm ?? Infinity) || a.clienteId.localeCompare(b.clienteId));
}

export function fechar(janela: Janela, entradas: Classificado[], cohort: Cohort): Resultado {
  const nivel3 = new Set(cohort.nivel3), elite = new Set(cohort.top10);
  const normal = ordenar(entradas.filter((e) => !nivel3.has(e.clienteId) && !elite.has(e.clienteId)));
  const top10 = ordenar(entradas.filter((e) => elite.has(e.clienteId)));
  const proximo: Cohort = { top10: [], nivel3: [...nivel3], pendentes: [...cohort.pendentes], meta: null };
  let decisaoPendente: Resultado["decisaoPendente"] = null;
  if (normal.length >= 10) {
    proximo.top10 = normal.slice(0, 10).map((e) => e.clienteId);
    proximo.meta = normal[5].score;
    proximo.pendentes = proximo.pendentes.filter((id) => !proximo.top10.includes(id));
  } else if (normal.length) {
    // Sem política aprovada de vagas reduzidas, não fabrica uma Liga Top 10.
    // Mérito preservado para decisão; fechamento/prêmio e outros ciclos continuam.
    proximo.pendentes = [...new Set([...proximo.pendentes, ...normal.map((e) => e.clienteId)])];
    decisaoPendente = "menos_de_dez_promovidos";
  }
  for (const id of cohort.top10) {
    const score = top10.find((e) => e.clienteId === id)?.score ?? 0;
    if (cohort.meta === null) {
      proximo.pendentes.push(id);
      decisaoPendente = "meta_indisponivel";
    } else if (top10.some((e) => e.clienteId === id) && score >= cohort.meta) proximo.nivel3.push(id);
    // Abaixo da meta: retorna naturalmente ao Nível 1 no próximo ciclo.
  }
  return {
    janela, normal, top10, proximo, decisaoPendente,
    campeoes: [normal[0] ? { liga: 1 as const, clienteId: normal[0].clienteId } : null, top10[0] ? { liga: 2 as const, clienteId: top10[0].clienteId } : null].filter((v) => v !== null),
  };
}

export function concederPremios(resultado: Resultado): Premio[] {
  return resultado.campeoes.map(({ clienteId, liga }) => ({
    id: `${resultado.janela.id}-liga-${liga}`, temporadaId: resultado.janela.id, clienteId, liga,
    tetoCents: liga === 1 ? 4700 : 5000, concedidoEm: resultado.janela.fim, estado: "disponivel",
    proximoAvisoEm: Date.parse(resultado.janela.fim), revisao: 0,
  }));
}

export function saboresElegiveis(premio: Pick<Premio, "tetoCents">, catalogo: PizzaCatalog) {
  return catalogo.flavors.filter((f) => f.available && typeof f.pricesBySizeCode.F === "number" && f.pricesBySizeCode.F > 0 && f.pricesBySizeCode.F <= premio.tetoCents);
}

export function materializarPizza(premio: Pick<Premio, "id" | "tetoCents">, selecao: unknown, catalogo: PizzaCatalog): ItemApp {
  if (!selecao || typeof selecao !== "object") throw new Error("selecao_invalida");
  const s = selecao as Record<string, unknown>;
  if (s.sizeId !== "size-f" || !Array.isArray(s.flavorIds) || s.flavorIds.length < 1 || s.flavorIds.length > 2 || new Set(s.flavorIds).size !== s.flavorIds.length || s.borderId || (s.addOnIds && (!Array.isArray(s.addOnIds) || s.addOnIds.length))) throw new Error("pizza_premio_invalida");
  const elegiveis = saboresElegiveis(premio, catalogo);
  const sabores = s.flavorIds.map((id) => elegiveis.find((f) => f.id === id));
  if (sabores.some((sabor) => !sabor)) throw new Error("sabor_premio_indisponivel");
  return { kind: "pizza", name: "Pizza Família — prêmio do Ranking", detail: sabores.map((sabor) => sabor!.name).join(" / "), price: 0, qty: 1, premioRankingId: premio.id };
}

export function transicionarPremio(premio: Premio, pedidoId: string, evento: "associado" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado", agora: number, tentativaId?: string): Premio {
  if (!pedidoId) throw new Error("pedido_obrigatorio");
  if (evento === "associado") {
    if (premio.pedidoId === pedidoId && premio.estado !== "disponivel") return premio;
    if (premio.estado !== "disponivel" || premio.ultimoCancelamentoPedidoId === pedidoId) throw new Error("premio_ja_associado");
    return { ...premio, estado: "associado", pedidoId, tentativaId, revisao: premio.revisao + 1 };
  }
  if (premio.pedidoId !== pedidoId) {
    if (evento === "cancelado" && premio.ultimoCancelamentoPedidoId === pedidoId) return premio;
    throw new Error("pedido_nao_corresponde_ao_premio");
  }
  if (evento === "cancelado") {
    if (premio.estado === "entregue") throw new Error("premio_entregue_nao_restauravel");
    return { ...premio, estado: "disponivel", pedidoId: undefined, tentativaId: undefined, ultimoCancelamentoPedidoId: pedidoId, proximoAvisoEm: agora + QUINZE_DIAS, revisao: premio.revisao + 1 };
  }
  const ordem = { disponivel: 0, associado: 1, em_preparo: 2, saiu_entrega: 3, entregue: 4 };
  if (ordem[evento] <= ordem[premio.estado]) return premio;
  return { ...premio, estado: evento, revisao: premio.revisao + 1 };
}

export function avisoDevido(premio: Premio, agora: number): boolean {
  return premio.estado === "disponivel" && premio.proximoAvisoEm <= agora;
}

export function premioPublico(premio: Premio) {
  return { id: premio.id, temporadaId: premio.temporadaId, liga: premio.liga, tetoCents: premio.tetoCents, concedidoEm: premio.concedidoEm, estado: premio.estado, pedidoId: premio.pedidoId, proximoAvisoEm: premio.proximoAvisoEm, revisao: premio.revisao };
}

export function copyPremio(nome: string, link: string): string {
  const url = new URL(link);
  if (url.origin !== "https://chefedapizza.com.br" || url.pathname !== "/cliente/premios" || url.search || url.hash) throw new Error("link_premio_invalido");
  const seguro = nome.replace(/[\r\n\[\]<>*_~`]/g, " ").trim().split(/\s+/)[0]?.slice(0, 40) || "cliente";
  return `🍕🎁 VOCÊ GANHOU UMA PIZZA FAMÍLIA GRÁTIS!\nOi, ${seguro}! Você terminou em 1º lugar no nosso ranking! 🥇\nA gente não esqueceu de você! ❤️\n👉 Escolha seus sabores e resgate: ${url.href}`;
}
