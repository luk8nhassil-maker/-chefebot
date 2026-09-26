// Migalha da conversão de indicação (primeira compra válida) por pedido —
// permite que o cancelamento tardio (correção do pedido do indicado para
// "cancelado" depois de já ter creditado a indicação) encontre indicador e
// indicado sem precisar reconsultar `indicacaoToken.ts` (a relação
// permanente já foi confirmada nesse momento e não muda depois).
import "server-only";
import { redis } from "./redis";
import { comBloqueioGamificacaoComToken } from "./rankingGamificacaoLock";

function chaveBreadcrumb(pedidoId: string): string {
  return `estrelasIndicacao:conversao:pedido:${pedidoId}`;
}

export type BreadcrumbConversaoIndicacao = {
  indicadorId: string;
  indicadoId: string;
  pedidoId: string;
};

export async function registrarConversaoIndicacao(params: BreadcrumbConversaoIndicacao): Promise<void> {
  await redis.set(chaveBreadcrumb(params.pedidoId), params);
}

export async function obterConversaoIndicacaoDoPedido(pedidoId: string): Promise<BreadcrumbConversaoIndicacao | null> {
  if (!pedidoId) return null;
  return redis.get<BreadcrumbConversaoIndicacao>(chaveBreadcrumb(pedidoId));
}

// Estado DURÁVEL da conversão principal de um indicado — separado da
// RELAÇÃO permanente indicador→indicado (indicacaoToken.ts), que nunca é
// apagada. Correção de blocker: sem isso, depois que a primeira compra do
// indicado fosse cancelada/estornada, a relação permanente continuava
// existindo e todo pedido seguinte caía direto em "apoio recorrente" — a
// conversão principal (+6 ao indicador) nunca podia acontecer de novo com
// uma compra comercial realmente válida.
//
// Este registro tem DOIS estados possíveis, nunca só "existe/não existe":
//   "processando" — um pedido RESERVOU o direito de ser a conversão
//                    principal, ANTES de creditar o +6. Escrito sob o lock
//                    (comReservaConversaoAtiva), sem TTL — sobrevive a um
//                    crash do processo entre o crédito e a confirmação. Só o
//                    PRÓPRIO pedidoId da reserva pode avançá-la para "ativa";
//                    nenhum outro pedido pode nem creditar, nem cair em
//                    apoio recorrente, enquanto ela existir — a segurança
//                    contra duas conversões principais simultâneas vem
//                    DESTE estado persistente, não do lock (que é só a
//                    seção crítica curta da transição, com TTL de 10s e
//                    portanto insuficiente sozinho contra um crash).
//   "ativa"       — a conversão principal já foi confirmada (crédito real
//                    concluído). Só então um pedido seguinte do mesmo
//                    indicado passa a virar apoio recorrente.
function chaveConversaoAtivaIndicado(indicadoId: string): string {
  return `estrelasIndicacao:conversaoAtiva:${indicadoId}`;
}

export type EstadoConversaoIndicado = "processando" | "ativa";
export type ConversaoAtivaIndicado = {
  estado: EstadoConversaoIndicado;
  indicadorId: string;
  pedidoId: string;
  // BLOCKER 5: metadado técnico (não é regra de negócio) usado só para
  // decidir se uma reserva "processando" é candidata a reconciliação — nunca
  // para decidir QUEM vence, isso continua sendo sempre o dono original.
  // Ausente em registros gravados antes desta correção (tratado como "não
  // decidível", nunca como órfã por omissão).
  reservadaEm?: string;
};

// BLOCKER 5: limiar técnico para considerar uma reserva "processando"
// candidata a reconciliação (nunca uma regra de negócio) — bem acima de
// qualquer duração real de crédito no ledger, para nunca competir com uma
// reserva genuinamente em andamento. Antes deste limiar, uma disputa
// concorrente continua sendo só "retryable" (ocupada_processando_outro),
// exatamente como hoje.
export const LIMIAR_RESERVA_ORFA_MS = 5 * 60 * 1000;

/**
 * Critério técnico de "órfã": só reservas "processando" mais velhas que o
 * limiar, com `reservadaEm` presente. Nunca decide sozinho o que fazer com a
 * reserva (isso é responsabilidade de quem reconcilia, olhando o pedido
 * real) — só se ela é sequer candidata a essa checagem.
 */
export function reservaConversaoEhCandidataAOrfandade(reserva: ConversaoAtivaIndicado): boolean {
  if (reserva.estado !== "processando" || !reserva.reservadaEm) return false;
  const reservadaEmMs = new Date(reserva.reservadaEm).getTime();
  if (Number.isNaN(reservadaEmMs)) return false;
  return Date.now() - reservadaEmMs > LIMIAR_RESERVA_ORFA_MS;
}

export async function obterConversaoAtivaIndicado(indicadoId: string): Promise<ConversaoAtivaIndicado | null> {
  if (!indicadoId) return null;
  return redis.get<ConversaoAtivaIndicado>(chaveConversaoAtivaIndicado(indicadoId));
}

function chaveLockConversaoAtiva(indicadoId: string): string {
  return `estrelasIndicacao:conversaoAtiva:lock:${indicadoId}`;
}

/**
 * Reserva atômica de uma SEÇÃO CRÍTICA CURTA por indicadoId — usada só para
 * tornar cada TRANSIÇÃO de estado (reservar, confirmar, revogar) atômica em
 * relação a qualquer outra transição concorrente do mesmo indicado. Nunca
 * precisa envolver o crédito no ledger inteiro (que pode ser lento e não
 * deve ficar refém do TTL de 10s deste lock) — a segurança contra crash vem
 * do ESTADO DURÁVEL gravado dentro da seção crítica, não do lock em si.
 *
 * Expõe o TOKEN da aquisição a `fn` — BLOCKER 8: cada escrita/remoção do
 * estado dentro da seção crítica é condicionada a este token continuar
 * sendo o dono do lock NO MOMENTO EXATO da escrita (ver
 * escreverConversaoSeDono/apagarConversaoSeDono abaixo), nunca só "rodar
 * dentro do bloco". Sem isso, se `fn` levasse mais que o TTL do lock (10s —
 * nunca deveria, já que só faz GET/SET locais, mas a prova não pode
 * depender de "na prática nunca leva"), outro worker podia adquirir o
 * MESMO lock e os dois acabarem escrevendo o estado, um por cima do outro.
 * Com a escrita condicionada ao token, só o dono de verdade no instante da
 * escrita consegue gravar — o outro recebe `false` e trata como retryable,
 * nunca reporta sucesso sem ter escrito.
 */
export async function comReservaConversaoAtiva<T>(indicadoId: string, fn: (token: string) => Promise<T>): Promise<T> {
  return comBloqueioGamificacaoComToken(chaveLockConversaoAtiva(indicadoId), fn);
}

// BLOCKER 8: escreve/apaga a chave de ESTADO só se a chave de LOCK ainda
// contiver exatamente este `token` — verificação e escrita/remoção na MESMA
// operação Lua, sem nenhuma janela entre "checar dono" e "gravar" (mesmo
// padrão já usado em fidelidade.ts/persistirEstadoPontosSeDono). Retorna
// `false` sem escrever nada quando o token não é mais o dono.
const ESCREVER_CONVERSAO_SE_DONO_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("SET", KEYS[2], ARGV[2])
  return 1
else
  return 0
end
`;
const APAGAR_CONVERSAO_SE_DONO_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[2])
else
  return 0
end
`;

async function escreverConversaoSeDono(indicadoId: string, token: string, valor: ConversaoAtivaIndicado): Promise<boolean> {
  const resultado = await redis.eval(
    ESCREVER_CONVERSAO_SE_DONO_SCRIPT,
    [chaveLockConversaoAtiva(indicadoId), chaveConversaoAtivaIndicado(indicadoId)],
    [token, JSON.stringify(valor)],
  );
  return resultado === 1;
}

async function apagarConversaoSeDono(indicadoId: string, token: string): Promise<boolean> {
  const resultado = await redis.eval(
    APAGAR_CONVERSAO_SE_DONO_SCRIPT,
    [chaveLockConversaoAtiva(indicadoId), chaveConversaoAtivaIndicado(indicadoId)],
    [token],
  );
  return resultado === 1;
}

export type ResultadoReservaConversao =
  // Ninguém tinha reserva para este indicado — este pedido acabou de
  // reservar o direito de ser a conversão principal. Pode prosseguir com o
  // crédito e, ao final, confirmar via marcarConversaoAtivaIndicado.
  | "reservada_processando"
  // A reserva (em qualquer estado, processando OU ativa) já pertence a ESTE
  // MESMO pedidoId — é um retry seguro; o chamador deve prosseguir/repetir o
  // crédito (idempotente no ledger) e garantir os efeitos auxiliares.
  | "mesmo_pedido"
  // OUTRO pedido está no meio da própria conversão (processando, ainda não
  // confirmada). Este pedido NUNCA pode creditar a conversão principal, e
  // NUNCA pode virar apoio recorrente nesta disputa — apoio só é válido
  // contra uma conversão já ATIVA e sustentada. O chamador deve tratar como
  // retryable (lançar para o pipeline de efeitos criar uma pendência).
  | "ocupada_processando_outro"
  // Outro pedido já é a conversão principal ATIVA e sustentada — este
  // pedido segue o fluxo normal de apoio recorrente.
  | "ativa_outro_pedido";

/**
 * Reserva (ou identifica) atomicamente a conversão principal de um indicado
 * para um pedido específico — sempre a PRIMEIRA coisa a acontecer, antes de
 * qualquer crédito no ledger. Nunca resolve com um GET seguido de um SET
 * separados: toda a leitura+decisão+escrita roda dentro da mesma reserva
 * (comReservaConversaoAtiva).
 */
export async function reservarOuIdentificarConversao(
  indicadoId: string,
  params: { indicadorId: string; pedidoId: string },
): Promise<ResultadoReservaConversao> {
  return comReservaConversaoAtiva(indicadoId, async (token) => {
    const atual = await obterConversaoAtivaIndicado(indicadoId);
    if (!atual) {
      const escrito = await escreverConversaoSeDono(indicadoId, token, {
        estado: "processando",
        indicadorId: params.indicadorId,
        pedidoId: params.pedidoId,
        reservadaEm: new Date().toISOString(),
      });
      // BLOCKER 8: o TTL do lock expirou entre o GET e este SET (janela
      // teórica — nunca deveria acontecer numa seção que só faz GET/SET
      // locais, mas nunca reporta reserva sem ter escrito de verdade).
      // Outro worker pode já ter reservado de verdade nesse meio-tempo —
      // nunca inventa aqui: o chamador trata como retryable, igual a
      // "ocupada_processando_outro".
      if (!escrito) throw new Error("ranking_indicacao_lock_perdido_durante_reserva");
      return "reservada_processando";
    }
    if (atual.pedidoId === params.pedidoId) return "mesmo_pedido";
    return atual.estado === "processando" ? "ocupada_processando_outro" : "ativa_outro_pedido";
  });
}

export type ResultadoConfirmacaoConversao =
  // Reserva "processando" deste MESMO pedido confirmada como "ativa" agora.
  | "confirmada"
  // Retry seguro: este pedido já era a conversão "ativa" (no-op idempotente).
  | "ja_ativa_mesmo"
  // BLOCKER 4: não existe reserva para este indicado, OU ela pertence a
  // OUTRO pedido — nunca escreve/altera nada neste caso. Cobre o worker
  // "atrasado" de um pedido cuja reserva já foi revogada por um
  // cancelamento (ex.: creditou, foi cancelado, estornou e liberou a
  // reserva, e só DEPOIS este worker antigo tenta confirmar) — sem esta
  // checagem, `atual` viria `null` e a conversão do pedido cancelado podia
  // "ressuscitar" como ativa. O chamador NUNCA deve declarar a conversão
  // concluída (ex.: pular a missão da temporada) quando recebe isto.
  | "reserva_perdida";

/**
 * Confirma a conversão principal como ATIVA — só tem efeito se a reserva
 * atual EXISTIR e pertencer a este MESMO pedidoId (nunca cria uma reserva do
 * nada, nunca confirma por cima de uma reserva que outro pedido já tenha
 * tomado, e é idempotente: confirmar de novo o mesmo pedido — já processando
 * ou já ativa — é um no-op seguro). Roda sob a mesma reserva atômica.
 */
export async function marcarConversaoAtivaIndicado(indicadoId: string, params: { indicadorId: string; pedidoId: string }): Promise<ResultadoConfirmacaoConversao> {
  if (!indicadoId) return "reserva_perdida";
  return comReservaConversaoAtiva(indicadoId, async (token) => {
    const atual = await obterConversaoAtivaIndicado(indicadoId);
    // Nunca escreve por cima de `null` (nenhuma reserva) nem de uma reserva
    // de OUTRO pedido — só o dono atual da reserva pode confirmá-la.
    if (!atual || atual.pedidoId !== params.pedidoId) return "reserva_perdida";
    if (atual.estado === "ativa") return "ja_ativa_mesmo";
    const escrito = await escreverConversaoSeDono(indicadoId, token, {
      estado: "ativa",
      indicadorId: params.indicadorId,
      pedidoId: params.pedidoId,
    });
    // BLOCKER 8: o TTL expirou entre o GET e este SET — nunca reporta
    // "confirmada" sem ter escrito de verdade. O chamador (registrarConversaoPrincipal)
    // nunca declara a conversão concluída neste caso, exatamente como faz
    // para "reserva_perdida" — o retry seguinte resolve com segurança.
    if (!escrito) throw new Error("ranking_indicacao_lock_perdido_durante_confirmacao");
    return "confirmada";
  });
}

/**
 * Revoga a marca de conversão (em qualquer estado — processando OU ativa)
 * SOMENTE se ela pertence ao `pedidoId` dado — nunca apaga a marca de uma
 * conversão MAIS NOVA por engano quando um cancelamento tardio de um pedido
 * antigo é reprocessado fora de ordem, e nunca apaga uma reserva
 * "processando" de OUTRO pedido em andamento. A checagem+remoção roda sob a
 * MESMA reserva atômica usada para criar/marcar uma conversão, fechando a
 * corrida em que uma nova conversão é gravada exatamente entre o GET e o
 * DEL.
 */
export async function revogarConversaoAtivaIndicadoSePedido(indicadoId: string, pedidoId: string): Promise<void> {
  if (!indicadoId || !pedidoId) return;
  await comReservaConversaoAtiva(indicadoId, async (token) => {
    const atual = await obterConversaoAtivaIndicado(indicadoId);
    if (atual?.pedidoId === pedidoId) {
      const apagado = await apagarConversaoSeDono(indicadoId, token);
      // BLOCKER 8: o TTL expirou entre o GET e este DEL — nunca reporta
      // "revogada" sem ter apagado de verdade (o chamador trata como falha
      // best-effort, igual ao resto do pipeline; um retry reprocessa com
      // segurança, já que nada foi marcado como concluído).
      if (!apagado) throw new Error("ranking_indicacao_lock_perdido_durante_revogacao");
    }
  });
}
