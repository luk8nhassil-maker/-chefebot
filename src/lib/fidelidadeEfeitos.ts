import { redis } from "./redis";
import {
  calcularPontosElegiveisPedido,
  construirEventoIdPontos,
  creditarFidelidadePedido,
  creditarPontosPedidoEntregue,
  derivarClienteIdPorTelefone,
  obterExtratoPontos,
  registrarMovimentoPontosIdempotente,
  reverterResgateConfirmado,
} from "./fidelidade";
import { calcularEstrelasPorValorElegivel, REGRA_ESTRELAS_V1 } from "./estrelas";
import { creditarEstrelasIndicacaoValida, creditarEstrelaApoioRecorrente } from "./estrelasIndicacao";
import { obterRelacaoIndicacao, obterCandidaturaIndicacao, registrarRelacaoIndicacao } from "./indicacaoToken";
import { chaveExpedienteOperacional } from "./expedienteOperacional";
import {
  liberarRecompensaDePedidoCancelado,
  processarConclusaoPedidoJornada,
  reverterConclusaoPedidoJornada,
  TENANT_PADRAO,
  type PedidoParaJornada,
} from "./jornadaChef";
import type { PedidoSnapshotOficial } from "./pedidoSnapshot";
import { registrarEventoEntregue, estornarEventoAnalitico } from "./historicoAnalitico";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";
import { obterTemporadaAtiva } from "./temporadas";
import { detectarCreditoDoPedido } from "./rankingRetencao";
import { consumirMissaoSemanalNoPedido, reverterMissaoSemanalDoPedido } from "./rankingMissaoSemanalEstado";
import { concluirMissaoIndicacaoNoPedido, reverterMissaoIndicacaoDoPedido } from "./rankingMissaoIndicacaoEstado";
import {
  registrarConversaoIndicacao,
  obterConversaoIndicacaoDoPedido,
  marcarConversaoAtivaIndicado,
  obterConversaoAtivaIndicado,
  revogarConversaoAtivaIndicadoSePedido,
  reservarOuIdentificarConversao,
} from "./rankingIndicacaoConversao";
import { estornarEstrelasIndicacaoValida, estornarEstrelaApoioRecorrente } from "./estrelasIndicacao";
import type { ItemApp } from "./pedidoAppItens";
import type { PedidoRedis } from "@/types/pedidoRedis";

export type PedidoParaEfeitosFidelidade = PedidoParaJornada & {
  id: string;
  status?: string;
  telefone?: string;
  clienteId?: string;
  total?: number;
  taxaEntrega?: number;
  snapshotOficial?: PedidoSnapshotOficial;
  pizzasCount?: number;
  resgateId?: string;
  recompensaJornadaId?: string;
  itensDetalhados?: ItemApp[];
  statusAnterior?: string;
  tenantId?: string;
};

export type PendenciaEfeitosFidelidade = {
  tenantId: string;
  pedidoId: string;
  acao: "entregue" | "cancelado";
  criadaEm: string;
  atualizadaEm: string;
  ultimoErro?: string;
};

type EstadoEfeito = "pendente" | "concluido";

type EstadoProcessamento = {
  versao: 1;
  pedidoId: string;
  acao: "entregue" | "cancelado";
  status: "processando" | "concluido";
  efeitos: Record<string, EstadoEfeito>;
  atualizadoEm: string;
  ultimoErro?: string;
};

const LOCK_TTL_SEGUNDOS = 10;
const PENDENCIA_LOCK_TTL_SEGUNDOS = 10;

async function estrelasV1AtivaEmProducao(): Promise<boolean> {
  const config = await redis.get<{ ativo?: boolean; regraVersao?: string }>("config:fidelidade:pontos");
  return config?.ativo === true && config.regraVersao === REGRA_ESTRELAS_V1;
}

function chaveEstado(pedidoId: string, acao: EstadoProcessamento["acao"]): string {
  return `fidelidade:efeitos:pedido:${pedidoId}:${acao}`;
}

function chaveLock(pedidoId: string): string {
  return `fidelidade:efeitos:lock:${pedidoId}`;
}

function chavePendencias(tenantId: string): string {
  return `fidelidade:efeitos:pendencias:${tenantId}`;
}

function chaveLockPendencias(tenantId: string): string {
  return `fidelidade:efeitos:pendencias:lock:${tenantId}`;
}

const LIBERAR_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function tokenLock(pedidoId: string): string {
  return `${pedidoId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

async function comLockPendencias<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const token = tokenLock(tenantId);
  const chave = chaveLockPendencias(tenantId);
  const adquirido = await redis.set(chave, token, { nx: true, ex: PENDENCIA_LOCK_TTL_SEGUNDOS });
  if (!adquirido) throw new Error("fidelidade_pendencias_lock_indisponivel");
  try {
    return await fn();
  } finally {
    const clienteComEval = redis as typeof redis & {
      eval?: (script: string, keys: string[], args: string[]) => Promise<unknown>;
    };
    if (clienteComEval.eval) {
      await clienteComEval.eval(LIBERAR_LOCK_LUA, [chave], [token]);
    } else if ((await redis.get<string>(chave)) === token) {
      await redis.del(chave);
    }
  }
}

async function comLockPedido<T>(pedidoId: string, fn: () => Promise<T>): Promise<T | null> {
  const token = tokenLock(pedidoId);
  const chave = chaveLock(pedidoId);
  const adquirido = await redis.set(chave, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
  if (!adquirido) return null;
  try {
    return await fn();
  } finally {
    const clienteComEval = redis as typeof redis & {
      eval?: (script: string, keys: string[], args: string[]) => Promise<unknown>;
    };
    if (clienteComEval.eval) {
      await clienteComEval.eval(LIBERAR_LOCK_LUA, [chave], [token]);
    } else if ((await redis.get<string>(chave)) === token) {
      await redis.del(chave);
    }
  }
}

function erroTexto(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function salvarEstado(chave: string, estado: EstadoProcessamento): Promise<void> {
  await redis.set(chave, { ...estado, atualizadoEm: new Date().toISOString() });
}

async function registrarPendencia(
  pedidoId: string,
  acao: EstadoProcessamento["acao"],
  erro: unknown,
  tenantId: string
): Promise<void> {
  await comLockPendencias(tenantId, async () => {
    const chave = chavePendencias(tenantId);
    const agora = new Date().toISOString();
    const atuais = (await redis.get<PendenciaEfeitosFidelidade[]>(chave)) ?? [];
    const existente = atuais.find((item) => item.pedidoId === pedidoId && item.acao === acao);
    const pendencia: PendenciaEfeitosFidelidade = {
      tenantId,
      pedidoId,
      acao,
      criadaEm: existente?.criadaEm ?? agora,
      atualizadaEm: agora,
      ultimoErro: erroTexto(erro).slice(0, 300),
    };
    await redis.set(chave, [...atuais.filter((item) => item.pedidoId !== pedidoId || item.acao !== acao), pendencia]);
  });
}

async function removerPendencia(pedidoId: string, acao: EstadoProcessamento["acao"], tenantId: string): Promise<void> {
  await comLockPendencias(tenantId, async () => {
    const chave = chavePendencias(tenantId);
    const atuais = (await redis.get<PendenciaEfeitosFidelidade[]>(chave)) ?? [];
    const restantes = atuais.filter((item) => item.pedidoId !== pedidoId || item.acao !== acao);
    if (restantes.length === atuais.length) return;
    await redis.set(chave, restantes);
  });
}

export async function obterPendenciasEfeitosFidelidade(
  tenantId: string = TENANT_PADRAO
): Promise<PendenciaEfeitosFidelidade[]> {
  return (await redis.get<PendenciaEfeitosFidelidade[]>(chavePendencias(tenantId))) ?? [];
}

export async function reprocessarPendenciaEfeitosFidelidade(
  pedidoId: string,
  acao: "entregue" | "cancelado",
  tenantId: string = TENANT_PADRAO
): Promise<void> {
  const pendente = (await obterPendenciasEfeitosFidelidade(tenantId)).some(
    (item) => item.pedidoId === pedidoId && item.acao === acao
  );
  if (!pendente) throw new Error("pendencia_de_efeitos_nao_encontrada");
  const pedidos = (await redis.get<PedidoRedis[]>("pedidos")) ?? [];
  const pedido = pedidos.find((item) => item.id === pedidoId);
  if (!pedido) throw new Error("pedido_da_pendencia_nao_encontrado");
  const pedidoComTenant = { ...pedido, tenantId } as PedidoParaEfeitosFidelidade;
  if (acao === "entregue") return processarEfeitosPedidoEntregue(pedidoComTenant);
  return processarEfeitosPedidoCancelado(pedidoComTenant);
}

async function executarEfeito(
  chave: string,
  estado: EstadoProcessamento,
  nome: string,
  efeito: () => Promise<void>
): Promise<void> {
  if (estado.efeitos[nome] === "concluido") return;
  try {
    await efeito();
    estado.efeitos[nome] = "concluido";
    estado.ultimoErro = undefined;
    await salvarEstado(chave, estado);
  } catch (error) {
    estado.ultimoErro = `${nome}: ${erroTexto(error)}`;
    await salvarEstado(chave, estado).catch(() => undefined);
    throw error;
  }
}

async function novoEstado(
  pedidoId: string,
  acao: EstadoProcessamento["acao"],
  efeitos: string[]
): Promise<EstadoProcessamento> {
  const estado: EstadoProcessamento = {
    versao: 1,
    pedidoId,
    acao,
    status: "processando",
    efeitos: Object.fromEntries(efeitos.map((efeito) => [efeito, "pendente"])),
    atualizadoEm: new Date().toISOString(),
  };
  await redis.set(chaveEstado(pedidoId, acao), estado, { nx: true });
  return (await redis.get<EstadoProcessamento>(chaveEstado(pedidoId, acao))) ?? estado;
}

/**
 * Autoridade única dos efeitos de um pedido entregue. Cada consumidor fica
 * marcado separadamente: se o processo cair depois de um consumidor, o
 * retry retoma o próximo; se cair antes de persistir a marca, o consumidor
 * é chamado novamente e precisa ser idempotente.
 */
export async function processarEfeitosPedidoEntregue(pedido: PedidoParaEfeitosFidelidade): Promise<void> {
  if (!pedido.id || pedido.status !== "entregue") return;
  const tenantId = pedido.tenantId ?? TENANT_PADRAO;
  try {
    const resultado = await comLockPedido(pedido.id, async () => {
    const chave = chaveEstado(pedido.id, "entregue");
    let estado = await redis.get<EstadoProcessamento>(chave);
    if (estado?.status === "concluido") {
      await removerPendencia(pedido.id, "entregue", tenantId);
      return;
    }
    estado = estado ?? (await novoEstado(pedido.id, "entregue", ["fidelidade_legada", "pontos", "gamificacao", "jornada", "indicacao", "analytics"]));

    await executarEfeito(chave, estado, "fidelidade_legada", async () => {
      await creditarFidelidadePedido({
        pedidoId: pedido.id,
        clienteId: pedido.clienteId,
        pizzas: pedido.pizzasCount ?? 0,
      });
    });
    await executarEfeito(chave, estado, "pontos", async () => {
      await creditarPontosPedidoEntregue({
        id: pedido.id,
        status: "entregue",
        telefone: pedido.telefone,
        clienteId: pedido.clienteId,
        total: pedido.total ?? 0,
        taxaEntrega: pedido.taxaEntrega,
        snapshotOficial: pedido.snapshotOficial,
      });
    });
    await executarEfeito(chave, estado, "gamificacao", async () => {
      // Bônus de competição da temporada (Caçada ao Pódio) — nunca toca no
      // saldo de fidelidade; só lê o que "pontos" acabou de creditar PARA
      // ESTE pedidoId exato (nunca por janela de tempo, correção do #445) e
      // credita o dobro num ledger separado quando há missão desbloqueada.
      const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
      if (!clienteId) return;
      const temporada = await obterTemporadaAtiva(tenantId);
      if (!temporada) return;
      const extrato = await obterExtratoPontos(clienteId);
      const credito = detectarCreditoDoPedido(
        extrato.map((m) => ({ pedidoId: m.pedidoId ?? null, tipo: m.tipo, pontos: m.pontos })),
        pedido.id,
      );
      if (!credito || credito.pontos <= 0) return;
      await consumirMissaoSemanalNoPedido({
        tenantId,
        temporadaId: temporada.temporadaId,
        clienteId,
        pedidoId: pedido.id,
        estrelasBaseDoPedido: credito.pontos,
        agora: new Date(),
      });
    });
    await executarEfeito(chave, estado, "jornada", async () => {
      await processarConclusaoPedidoJornada(pedido);
    });
    await executarEfeito(chave, estado, "indicacao", async () => {
      const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
      if (!clienteId) return;
      await processarConversaoIndicacao(clienteId);
    });

    async function processarConversaoIndicacao(clienteId: string): Promise<void> {
      // Conversão principal (+6 ao indicador, SEM apoio) — sempre pelo MESMO
      // caminho, seja a primeira compra de sempre (relação nova) ou uma
      // compra comercial válida substituta depois que a conversão original
      // foi cancelada/estornada (correção de blocker: a RELAÇÃO permanente
      // indicador→indicado nunca é apagada, mas a marca de "conversão ativa"
      // sim — sem ela, todo pedido seguinte caía direto em apoio recorrente
      // para sempre, mesmo sem nenhuma conversão principal ter realmente se
      // sustentado).
      //
      // A reserva (reservarOuIdentificarConversao) é SEMPRE o primeiro passo,
      // ANTES de qualquer crédito no ledger — ela é o estado DURÁVEL que
      // sobrevive a um crash do processo entre o +6 e a confirmação
      // (marcarConversaoAtivaIndicado). O crédito em si roda FORA de
      // qualquer lock (pode ser lento; a segurança não depende disso), mas
      // nunca é chamado sem a reserva ter sido concedida a este pedido
      // primeiro — é isso que impede duas conversões principais simultâneas
      // mesmo quando o processo morre no meio do caminho.
      const registrarConversaoPrincipal = async (indicadorId: string) => {
        const resultadoIndicacao = await creditarEstrelasIndicacaoValida({
          indicadorId,
          indicadoId: clienteId,
          pedidoId: pedido.id,
          primeiraCompraComercialValida: true,
        });
        // "creditado" e "ja_creditado" (retry do MESMO pedido, ex.: crash
        // depois do +6 e antes do breadcrumb/conversão ativa/fato/missão)
        // convergem para o MESMO estado final íntegro — nunca só o primeiro.
        // Cada passo abaixo é idempotente por si só (SET plano ou SET NX por
        // eventoId), então repeti-los num retry nunca duplica nada; só
        // "nao_elegivel" é fail-closed de verdade (nunca houve crédito real).
        if (resultadoIndicacao === "nao_elegivel") return;

        // Fato de negócio "indicação convertida" registrado no MESMO instante
        // idempotente do crédito real — nunca inferido depois por regex/diff
        // de extrato no navegador (correção do #445). O eventoId espelha
        // exatamente a chave de idempotência do próprio ledger, então mesmo
        // um retry deste efeito nunca conta o fato duas vezes.
        await registrarFatoRankingGamificacao(
          "indicacao_convertida",
          `indicacao:${clienteId}:primeira-compra:${pedido.id}`,
        );
        // Migalha para o cancelamento tardio (ver "gamificacao" do
        // cancelado) encontrar indicador/indicado sem reconsultar a relação.
        await registrarConversaoIndicacao({ indicadorId, indicadoId: clienteId, pedidoId: pedido.id });
        // Confirma a reserva como a conversão ATIVA do indicado — é o que
        // permite uma futura conversão substituta se esta também for
        // cancelada. Só tem efeito se a reserva ainda pertencer a este
        // MESMO pedido (comReservaConversaoAtiva/marcarConversaoAtivaIndicado
        // nunca deixam outro pedido roubar ou sobrescrever a reserva).
        await marcarConversaoAtivaIndicado(clienteId, { indicadorId, pedidoId: pedido.id });
        // Missão da temporada "Indique um amigo" — reaproveita o MESMO
        // crédito real de indicação, nunca cria um sistema paralelo. Quem
        // cumpre a missão é o indicador, não o indicado. Sem temporada
        // ativa, fica fail-closed (sem missão).
        const temporadaIndicacao = await obterTemporadaAtiva(tenantId);
        if (temporadaIndicacao) {
          await concluirMissaoIndicacaoNoPedido({
            tenantId,
            temporadaId: temporadaIndicacao.temporadaId,
            clienteId: indicadorId,
            pedidoId: pedido.id,
            agora: new Date(),
          });
        }
      };

      const creditarApoioRecorrente = async (indicadorId: string) => {
        const snapshotOficial = pedido.snapshotOficial;
        const pedidoTemPartePaga = snapshotOficial
          ? snapshotOficial.subtotalCents > snapshotOficial.descontoFidelidadeCents
          : (pedido.total ?? 0) > (pedido.taxaEntrega ?? 0);
        await creditarEstrelaApoioRecorrente({
          indicadorId,
          indicadoId: clienteId,
          pedidoId: pedido.id,
          expedienteId: chaveExpedienteOperacional(),
          pedidoComercialValido: true,
          pedidoTemPartePaga,
        });
      };

      // Relação permanente já existe.
      const relacao = await obterRelacaoIndicacao(clienteId);
      if (relacao) {
        const reserva = await reservarOuIdentificarConversao(clienteId, { indicadorId: relacao.indicadorId, pedidoId: pedido.id });
        if (reserva === "ativa_outro_pedido") {
          // Já existe uma conversão principal ATIVA e sustentada → esta
          // compra é apoio recorrente (+1/expediente), nunca uma segunda
          // conversão.
          await creditarApoioRecorrente(relacao.indicadorId);
          return;
        }
        if (reserva === "ocupada_processando_outro") {
          // Outro pedido está NO MEIO da própria conversão principal (ainda
          // não confirmada) — nunca credita, nunca vira apoio "de brinde"
          // por ter perdido a disputa. Lança para o pipeline de efeitos
          // tratar como pendência e reprocessar depois, quando a reserva já
          // tiver sido confirmada (ou liberada por um cancelamento).
          throw new Error("ranking_indicacao_conversao_em_processamento");
        }
        // "reservada_processando" (nova reserva conseguida agora) ou
        // "mesmo_pedido" (retry do próprio pedido, reserva ainda pertence a
        // ele em qualquer estado) — prossegue com o crédito real.
        await registrarConversaoPrincipal(relacao.indicadorId);
        return;
      }

      // Sem relação permanente: verifica candidatura pendente
      const candidatura = await obterCandidaturaIndicacao(clienteId);
      if (!candidatura) return;

      // Confirma relação permanente (first-write-wins); se outro worker venceu a corrida, pula
      const confirmado = await registrarRelacaoIndicacao(clienteId, candidatura.indicadorId);
      if (confirmado !== "registrado") return;

      // Mesmo aqui (primeiríssima conversão, relação acabou de nascer) a
      // reserva ainda é necessária: cobre o crash entre o +6 e a confirmação
      // também neste caminho, exatamente como no caminho de "relação já
      // existia". Em teoria nenhum outro pedido pode disputar esta reserva
      // ainda (a relação só agora passou a existir), mas o mesmo contrato
      // vale por segurança e consistência.
      const reserva = await reservarOuIdentificarConversao(clienteId, { indicadorId: candidatura.indicadorId, pedidoId: pedido.id });
      if (reserva === "ocupada_processando_outro") {
        throw new Error("ranking_indicacao_conversao_em_processamento");
      }
      await registrarConversaoPrincipal(candidatura.indicadorId);
    }

    await executarEfeito(chave, estado, "analytics", async () => {
      await registrarEventoEntregue({
        id: pedido.id,
        telefone: pedido.telefone,
        tenantId: pedido.tenantId,
        total: pedido.total,
        taxaEntrega: pedido.taxaEntrega,
        snapshotOficial: pedido.snapshotOficial,
        origem: pedido.origem,
        tipoEntrega: pedido.tipoEntrega,
      });
    });

    estado.status = "concluido";
    await salvarEstado(chave, estado);
    await removerPendencia(pedido.id, "entregue", tenantId);
    });

    if (resultado === null) throw new Error("fidelidade_efeitos_pedido_em_processamento");
  } catch (error) {
    await registrarPendencia(pedido.id, "entregue", error, tenantId).catch(() => undefined);
    throw error;
  }
}

/**
 * Autoridade única dos efeitos atuais de cancelamento. Mantém as operações
 * já existentes, mas torna a sequência retomável e impede que cada rota
 * execute uma parte diferente do mesmo fato.
 */
export async function processarEfeitosPedidoCancelado(pedido: PedidoParaEfeitosFidelidade): Promise<void> {
  if (!pedido.id || pedido.status !== "cancelado") return;
  const tenantId = pedido.tenantId ?? TENANT_PADRAO;
  try {
    const resultado = await comLockPedido(pedido.id, async () => {
    const chave = chaveEstado(pedido.id, "cancelado");
    let estado = await redis.get<EstadoProcessamento>(chave);
    if (estado?.status === "concluido") {
      await removerPendencia(pedido.id, "cancelado", tenantId);
      return;
    }
    estado = estado ?? (await novoEstado(pedido.id, "cancelado", ["pontos", "resgate", "gamificacao", "jornada", "analytics"]));

    await executarEfeito(chave, estado, "pontos", async () => {
      const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
      if (!clienteId) return;
      const usaEstrelas = await estrelasV1AtivaEmProducao();
      const valorElegivelCents = pedido.snapshotOficial
        ? Math.max(pedido.snapshotOficial.subtotalCents - pedido.snapshotOficial.descontoFidelidadeCents, 0)
        : Math.max(Math.round(((Number(pedido.total) || 0) - (Number(pedido.taxaEntrega) || 0)) * 100), 0);
      const pontos = usaEstrelas
        ? calcularEstrelasPorValorElegivel(valorElegivelCents)
        : pedido.snapshotOficial
          ? Math.max(Math.floor(valorElegivelCents / 100), 0)
          : calcularPontosElegiveisPedido({ total: pedido.total ?? 0, taxaEntrega: pedido.taxaEntrega });
      if (pontos <= 0) return;

      if (pedido.status === "cancelado") {
        const extrato = await obterExtratoPontos(clienteId);
        const teveConfirmado = extrato.some((movimento) => movimento.pedidoId === pedido.id && movimento.tipo === "confirmado");
        if (pedido.statusAnterior === "entregue" && teveConfirmado) {
          await registrarMovimentoPontosIdempotente(clienteId, {
            eventoId: construirEventoIdPontos(pedido.id, "estornado"),
            pedidoId: pedido.id,
            tipo: "estornado",
            pontos,
            motivo: `Pedido ${pedido.id} corrigido para cancelado`,
            ...(usaEstrelas ? { regraVersao: REGRA_ESTRELAS_V1, unidade: "estrelas" as const } : {}),
          });
        } else if (pedido.statusAnterior !== "entregue") {
          await registrarMovimentoPontosIdempotente(clienteId, {
            eventoId: construirEventoIdPontos(pedido.id, "cancelado"),
            pedidoId: pedido.id,
            tipo: "cancelado",
            pontos,
            motivo: `Pedido ${pedido.id} cancelado antes da entrega`,
            ...(usaEstrelas ? { regraVersao: REGRA_ESTRELAS_V1, unidade: "estrelas" as const } : {}),
          });
        }
      }
    });
    await executarEfeito(chave, estado, "resgate", async () => {
      if (!pedido.resgateId) return;
      const clienteId = derivarClienteIdPorTelefone(pedido.telefone);
      if (clienteId) await reverterResgateConfirmado(clienteId, pedido.resgateId, `Pedido ${pedido.id} cancelado`);
    });
    await executarEfeito(chave, estado, "gamificacao", async () => {
      // Nunca deixa o cliente "perder a chance" da missão semanal por causa
      // de um cancelamento: se ESTE pedido exato consumiu a missão, o
      // estorno do bônus e a reabertura da missão acontecem juntos aqui.
      // Sem migalha para este pedido, é no-op (nunca mexe no estado de
      // nenhum outro cliente/pedido).
      await reverterMissaoSemanalDoPedido(pedido.id, `Pedido ${pedido.id} cancelado`);
      // Cancelamento tardio da indicação: se este pedido (a primeira compra
      // do indicado) já tinha creditado a indicação real e concluído a
      // missão da temporada do indicador, reverte os dois — nunca deixa uma
      // vantagem de jogo (nem de estrelas base, nem de bônus de competição)
      // baseada num pedido comercial que virou inválido.
      const motivoCancelamento = `Pedido ${pedido.id} cancelado`;
      let conversao = await obterConversaoIndicacaoDoPedido(pedido.id);
      if (!conversao) {
        // Sem a migalha (breadcrumb): pode ser que este pedido nunca gerou
        // indicação nenhuma, OU que ele reservou a conversão principal,
        // creditou o +6, e o processo morreu ANTES de gravar o breadcrumb
        // (o breadcrumb é escrito DEPOIS do crédito real — nunca depender só
        // dele, ou um crash exatamente nessa janela deixaria o +6 sem
        // estorno possível para sempre). O estado DURÁVEL da reserva
        // (rankingIndicacaoConversao.ts) é escrito ANTES do crédito e por
        // isso é a fonte de verdade mais confiável para descobrir
        // indicador/indicado neste caso — indexado por indicadoId, então
        // primeiro é preciso saber quem é o indicado deste pedido.
        const indicadoId = derivarClienteIdPorTelefone(pedido.telefone);
        if (indicadoId) {
          const reserva = await obterConversaoAtivaIndicado(indicadoId);
          if (reserva?.pedidoId === pedido.id) {
            conversao = { indicadorId: reserva.indicadorId, indicadoId, pedidoId: pedido.id };
          }
        }
      }
      if (conversao) {
        // Idempotente e seguro mesmo se nenhum crédito real chegou a
        // acontecer (reserva "processando" cancelada antes do +6): devolve
        // "credito_nao_encontrado" e não escreve nada no ledger.
        await estornarEstrelasIndicacaoValida({ ...conversao, motivo: motivoCancelamento });
        // Libera a marca de conversão (em qualquer estado — processando OU
        // ativa; só se ainda for esta mesma) — sem isso, uma reserva
        // "processando" órfã travaria QUALQUER conversão futura deste
        // indicado para sempre, e uma "ativa" travaria em apoio recorrente
        // para sempre, mesmo sem nenhuma conversão principal sustentada.
        await revogarConversaoAtivaIndicadoSePedido(conversao.indicadoId, pedido.id);
      }
      await reverterMissaoIndicacaoDoPedido(pedido.id, motivoCancelamento);
      // Cancelamento tardio do apoio recorrente (+1/expediente): nunca
      // remove a Estrela quando outro pedido comercial válido do mesmo
      // expediente ainda a sustenta — no-op para um pedido que nunca
      // qualificou para apoio nenhum.
      await estornarEstrelaApoioRecorrente({ pedidoId: pedido.id, motivo: motivoCancelamento });
    });
    await executarEfeito(chave, estado, "jornada", async () => {
      await reverterConclusaoPedidoJornada(pedido.id, `Pedido ${pedido.id} cancelado`);
      await liberarRecompensaDePedidoCancelado(pedido);
    });
    await executarEfeito(chave, estado, "analytics", async () => {
      if (pedido.statusAnterior === "entregue") {
        await estornarEventoAnalitico(pedido.id, pedido.tenantId);
      }
    });

    estado.status = "concluido";
    await salvarEstado(chave, estado);
    await removerPendencia(pedido.id, "cancelado", tenantId);
    });

    if (resultado === null) throw new Error("fidelidade_efeitos_pedido_em_processamento");
  } catch (error) {
    await registrarPendencia(pedido.id, "cancelado", error, tenantId).catch(() => undefined);
    throw error;
  }
}
