import "server-only";
import { redis } from "../redis";
import { Ranking3Store } from "./store";
import { obterRegrasJogoSecretoParaClientes } from "../consentimentoRanking";
import { premioPublico } from "./domain";
import type { EntradaRanking } from "../rankingClientes";

export const ranking3Ativo = () => process.env.RANKING3_ENABLED === "true";
export const ranking3 = (tenant = "default") => new Ranking3Store(redis, tenant);

export async function mesmaLiga<T extends { clienteId: string }>(entradas: T[], temporadaId: string, clienteId: string, tenant = "default"): Promise<T[]> {
  if (!temporadaId.startsWith("r3-")) return entradas;
  const indice = Number(temporadaId.split("-")[4]);
  const cohort = await ranking3(tenant).cohort(indice);
  const liga = (id: string) => cohort.nivel3.includes(id) ? 3 : cohort.top10.includes(id) ? 2 : 1;
  const propria = liga(clienteId);
  return propria === 3 ? [] : entradas.filter((e) => liga(e.clienteId) === propria);
}

export async function painelRanking3(clienteId: string, agora = Date.now(), projecao: EntradaRanking[] = []) {
  if (!ranking3Ativo()) return null;
  const store = ranking3();
  const janela = await store.atual(agora);
  if (!janela) return null;
  const premios = (await store.carteira(clienteId)).map(premioPublico);
  const checkpoint = Number(await redis.get<number>(store.chave("checkpoint")) ?? -1);
  // Leitura jamais fecha nem concede prêmio. Scheduler pode retomar sozinho.
  if (checkpoint < janela.indice - 1) return { janela, atualizando: true as const, premios };
  const cohort = await store.cohort(janela.indice);
  // A tela reaproveita a projeção já lida pelo painel. Ledger completo e
  // histórico de cada cliente são consultados só na apuração oficial.
  const regras = await obterRegrasJogoSecretoParaClientes(projecao.map((e) => e.clienteId));
  const liga = cohort.nivel3.includes(clienteId) ? 3 : cohort.top10.includes(clienteId) ? 2 : 1;
  const lista = liga === 3 ? [] : projecao.filter((e) => {
    const regra = regras.get(e.clienteId);
    const ligaDaEntrada = cohort.nivel3.includes(e.clienteId) ? 3 : cohort.top10.includes(e.clienteId) ? 2 : 1;
    return ligaDaEntrada === liga && regra?.participa === true && regra.aceitaRevelacao30d === true;
  });
  const posicao = lista.findIndex((e) => e.clienteId === clienteId);
  const anterior = janela.indice ? await store.resultado(janela.indice - 1) : null;
  return {
    janela, atualizando: false as const, liga, posicao: posicao >= 0 ? posicao + 1 : null,
    score: lista[posicao]?.score ?? 0, meta: liga === 2 ? cohort.meta : null,
    decisaoPendente: cohort.pendentes.includes(clienteId), premios,
    // Não expõe IDs/nomes de outros clientes nem resultados econômicos alheios.
    lista: lista.slice(0, 50).map((e, i) => ({ posicao: i + 1, score: e.score, eVoce: e.clienteId === clienteId })),
    conquistaAnterior: anterior?.campeoes.some((e) => e.clienteId === clienteId) ? "Campeão da temporada" : null,
  };
}
