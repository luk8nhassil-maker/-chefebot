// Transição entre temporadas da Gamificação V2: vantagem de largada
// (carryover) e status social (Campeão/Prata/Bronze/Elite) herdado do Top 10
// da temporada anterior para a temporada nova.
//
// Padrão de avaliação: igual ao auto-expiry de temporadas.ts — não existe
// cron. Cada leitura do painel do cliente (um por vez, nunca em lote) chama
// as funções abaixo; a idempotência de cada uma garante que reprocessar não
// tem custo nem risco (SET NX no ledger de bônus / comparação de origem no
// status social).
import "server-only";
import { redis } from "./redis";
import { listarTemporadas, type ConfigTemporada } from "./temporadas";
import { obterResultadoTemporada } from "./temporadaResultado";
import { obterConfigGamificacao } from "./rankingGamificacaoConfig";
import { calcularBonusCarryover, calcularStatusPorPosicao, type StatusTemporada } from "./rankingGamificacao";
import { creditarBonusCompeticao } from "./rankingBonusTemporada";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";
import { sincronizarScoreTemporadaComBonus } from "./rankingScoreTemporadaSync";

/**
 * Encontra a temporada mais recentemente ENCERRADA antes da temporada atual
 * ter sido ativada. Nunca escolhe a própria temporada atual nem uma futura —
 * sem isso, "temporada anterior" fica indefinido e nada de transição roda
 * (fail-closed).
 */
export async function obterTemporadaAnteriorEncerrada(
  tenantId: string,
  temporadaAtual: ConfigTemporada,
): Promise<ConfigTemporada | null> {
  if (!tenantId || !temporadaAtual.ativadaEm) return null;
  const ativadaEmMs = new Date(temporadaAtual.ativadaEm).getTime();
  if (!Number.isFinite(ativadaEmMs)) return null;
  const todas = await listarTemporadas(tenantId);
  const anteriores = todas.filter((t) => {
    if (t.temporadaId === temporadaAtual.temporadaId) return false;
    if (t.estado !== "encerrada" || !t.encerradaEm) return false;
    const encerradaEmMs = new Date(t.encerradaEm).getTime();
    return Number.isFinite(encerradaEmMs) && encerradaEmMs <= ativadaEmMs;
  });
  if (anteriores.length === 0) return null;
  anteriores.sort((a, b) => new Date(b.encerradaEm as string).getTime() - new Date(a.encerradaEm as string).getTime());
  return anteriores[0];
}

/**
 * Aplica a vantagem de largada UMA única vez por (temporada anterior,
 * temporada nova, cliente) — o eventoId do ledger é a própria chave de
 * idempotência, então repetir a chamada (cada leitura do painel) nunca
 * duplica o crédito. Sem config de carryover ativa, ou sem o cliente ter
 * ficado no Top 10 da temporada anterior, não credita nada.
 */
export async function aplicarCarryoverClienteSeNecessario(
  tenantId: string,
  temporadaAtual: ConfigTemporada,
  clienteId: string,
): Promise<void> {
  if (!clienteId) return;
  const config = await obterConfigGamificacao();
  if (!config.carryoverAtivo) return;
  const anterior = await obterTemporadaAnteriorEncerrada(tenantId, temporadaAtual);
  if (!anterior) return;
  const resultado = await obterResultadoTemporada(tenantId, anterior.temporadaId);
  if (!resultado) return;
  const entrada = resultado.participantesTopo.find((e) => e.clienteId === clienteId && e.posicao <= 10);
  if (!entrada) return;
  const bonus = calcularBonusCarryover(entrada.posicao, config.carryoverTabela);
  if (bonus <= 0) return;
  const resultadoCredito = await creditarBonusCompeticao({
    tenantId,
    temporadaId: temporadaAtual.temporadaId,
    clienteId,
    eventoId: `carryover:${anterior.temporadaId}:${temporadaAtual.temporadaId}:${clienteId}`,
    tipo: "carryover",
    pontos: bonus,
    motivo: `Vantagem de largada — #${entrada.posicao} na temporada anterior`,
  });
  // "creditado" ou "ja_creditado" (retry pós-falha/reconciliação repetida)
  // precisam sincronizar o score da mesma forma — nunca só o primeiro (mesmo
  // blocker de "creditarBonusCompeticao" nas missões). "invalido" nunca
  // credita de verdade, então nunca sincroniza.
  if (resultadoCredito === "creditado" || resultadoCredito === "ja_creditado") {
    await sincronizarScoreTemporadaComBonus(tenantId, temporadaAtual.temporadaId, clienteId);
  }
}

export type StatusSocialVigente = {
  status: StatusTemporada;
  /** Temporada encerrada de onde esse status veio — usado só para saber se já sincronizou esta transição. */
  temporadaOrigemId: string;
  atribuidoEm: string;
};

function chaveStatusSocial(tenantId: string, clienteId: string): string {
  return `ranking:statusSocial:${tenantId}:${clienteId}`;
}

export async function obterStatusSocialVigente(tenantId: string, clienteId: string): Promise<StatusSocialVigente | null> {
  if (!tenantId || !clienteId) return null;
  return redis.get<StatusSocialVigente>(chaveStatusSocial(tenantId, clienteId));
}

/**
 * Sincroniza o status social (Campeão/Prata/Bronze/Elite) a partir do
 * resultado arquivado da temporada anterior. Só recalcula quando a origem
 * mudou (nova temporada encerrou desde a última sincronização) — leituras
 * repetidas dentro da mesma transição são no-op. Dispara o fato
 * "virou_campeao" só na transição em que o status vira campeão pela
 * primeira vez (nunca em toda leitura).
 */
export async function sincronizarStatusSocialCliente(
  tenantId: string,
  temporadaAtual: ConfigTemporada,
  clienteId: string,
): Promise<StatusSocialVigente | null> {
  if (!clienteId) return null;
  const anterior = await obterTemporadaAnteriorEncerrada(tenantId, temporadaAtual);
  const atual = await obterStatusSocialVigente(tenantId, clienteId);
  if (!anterior) return atual;
  if (atual && atual.temporadaOrigemId === anterior.temporadaId) return atual;

  const resultado = await obterResultadoTemporada(tenantId, anterior.temporadaId);
  const entrada = resultado?.participantesTopo.find((e) => e.clienteId === clienteId);
  const status = calcularStatusPorPosicao(entrada?.posicao ?? null);
  const novo: StatusSocialVigente = { status, temporadaOrigemId: anterior.temporadaId, atribuidoEm: new Date().toISOString() };
  await redis.set(chaveStatusSocial(tenantId, clienteId), novo);

  if (status === "campeao") {
    await registrarFatoRankingGamificacao("virou_campeao", `${clienteId}:${anterior.temporadaId}`);
  }
  return novo;
}

function chaveReconciliacaoEmAndamento(tenantId: string, temporadaAnteriorId: string, temporadaNovaId: string): string {
  return `ranking:reconciliacao:andamento:${tenantId}:${temporadaAnteriorId}:${temporadaNovaId}`;
}

function chaveReconciliacaoConcluida(tenantId: string, temporadaAnteriorId: string, temporadaNovaId: string): string {
  return `ranking:reconciliacao:concluida:${tenantId}:${temporadaAnteriorId}:${temporadaNovaId}`;
}

// Tempo generoso para reconciliar até 10 clientes (2 chamadas cada) — bem
// acima do que uma reconciliação saudável realmente leva. Não é o mecanismo
// principal de "nunca reprocessar à toa" (isso é a marca "concluída",
// escrita só no fim) — é a rede de segurança contra um crash abrupto
// (processo morto, container encerrado) que nunca chega a rodar nenhum
// catch/finally: sem TTL aqui, a marca "em andamento" ficaria presa PARA
// SEMPRE e o Top 10 nunca terminaria de reconciliar (blocker da auditoria).
const TTL_ANDAMENTO_SEGUNDOS = 300;

/**
 * Correção de blocker da auditoria do #446: carryover e status social NÃO
 * podem depender de cada membro do Top 10 anterior abrir o app — antes,
 * `aplicarCarryoverClienteSeNecessario`/`sincronizarStatusSocialCliente` só
 * rodavam quando O PRÓPRIO cliente lia o painel, deixando o ranking
 * incompleto até todo o Top 10 logar.
 *
 * Esta função reconcilia TODO o Top 10 elegível de uma vez, disparada pela
 * leitura de painel de QUALQUER cliente (não precisa ser um dos vencedores)
 * — sem cron, sem precisar tocar `temporadas.ts`.
 *
 * Segurança contra crash (correção de blocker adicional): a marca "feito"
 * só é escrita DEPOIS que o laço inteiro termina com sucesso — nunca antes.
 * Enquanto o laço roda, existe apenas uma marca "em andamento" COM TTL; se o
 * processo morrer no meio (sem nunca rodar o catch/finally), a marca expira
 * sozinha e a PRÓXIMA leitura de qualquer cliente reprocessa o Top 10 inteiro
 * do zero com segurança — cada crédito/sincronização por cliente já é
 * idempotente, então reprocessar clientes já reconciliados nunca duplica
 * nada nem quebra nada.
 *
 * Reaproveita as MESMAS funções por-cliente já testadas (nunca duplica a
 * regra de negócio) — só decide "para quem" chamar, em vez de esperar cada
 * um logar sozinho.
 */
export async function reconciliarTransicaoTemporada(
  tenantId: string,
  temporadaAtual: ConfigTemporada,
): Promise<void> {
  const anterior = await obterTemporadaAnteriorEncerrada(tenantId, temporadaAtual);
  if (!anterior) return;

  const chaveConcluida = chaveReconciliacaoConcluida(tenantId, anterior.temporadaId, temporadaAtual.temporadaId);
  if (await redis.get(chaveConcluida)) return; // já terminou de verdade — nunca reprocessa à toa

  const chaveAndamento = chaveReconciliacaoEmAndamento(tenantId, anterior.temporadaId, temporadaAtual.temporadaId);
  const marcou = await redis.set(chaveAndamento, true, { nx: true, ex: TTL_ANDAMENTO_SEGUNDOS });
  if (!marcou) return; // outro worker já está processando esta transição agora

  try {
    const resultado = await obterResultadoTemporada(tenantId, anterior.temporadaId);
    if (!resultado) {
      // Snapshot da temporada anterior ainda não foi arquivado — solta a
      // marca para a próxima leitura tentar de novo, nunca falha silenciosa
      // para sempre.
      return;
    }
    const top10 = resultado.participantesTopo.filter((e) => e.posicao <= 10);
    for (const entrada of top10) {
      await aplicarCarryoverClienteSeNecessario(tenantId, temporadaAtual, entrada.clienteId);
      await sincronizarStatusSocialCliente(tenantId, temporadaAtual, entrada.clienteId);
    }
    // Só agora, com TODO o Top 10 processado, marca como definitivamente
    // concluída (sem TTL — uma reconciliação real nunca precisa repetir).
    await redis.set(chaveConcluida, true);
  } catch (erro) {
    console.warn("[ChefeBot] Não foi possível reconciliar a transição de temporada", erro);
  } finally {
    // Libera a marca "em andamento" (sucesso ou falha) para o próximo
    // gatilho poder tentar de novo sem esperar o TTL inteiro — um crash
    // abrupto que pula este finally ainda está coberto pelo TTL acima.
    await redis.del(chaveAndamento).catch(() => undefined);
  }
}
