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
import { concluirMissaoIndicacaoNoPedido } from "./rankingMissaoIndicacaoEstado";
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

      // Relação permanente já existe → compra posterior à aquisição → apoio +1/expediente
      const relacao = await obterRelacaoIndicacao(clienteId);
      if (relacao) {
        const snapshotOficial = pedido.snapshotOficial;
        const pedidoTemPartePaga = snapshotOficial
          ? snapshotOficial.subtotalCents > snapshotOficial.descontoFidelidadeCents
          : (pedido.total ?? 0) > (pedido.taxaEntrega ?? 0);
        await creditarEstrelaApoioRecorrente({
          indicadorId: relacao.indicadorId,
          indicadoId: clienteId,
          pedidoId: pedido.id,
          expedienteId: chaveExpedienteOperacional(),
          pedidoComercialValido: true,
          pedidoTemPartePaga,
        });
        return;
      }

      // Sem relação permanente: verifica candidatura pendente
      const candidatura = await obterCandidaturaIndicacao(clienteId);
      if (!candidatura) return;

      // Confirma relação permanente (first-write-wins); se outro worker venceu a corrida, pula
      const confirmado = await registrarRelacaoIndicacao(clienteId, candidatura.indicadorId);
      if (confirmado !== "registrado") return;

      // Primeira compra comercial válida: +6 ao indicador — SEM apoio neste evento
      const resultadoIndicacao = await creditarEstrelasIndicacaoValida({
        indicadorId: candidatura.indicadorId,
        indicadoId: clienteId,
        pedidoId: pedido.id,
        primeiraCompraComercialValida: true,
      });
      // Fato de negócio "indicação convertida" registrado no MESMO instante
      // idempotente do crédito real — nunca inferido depois por regex/diff de
      // extrato no navegador (correção do #445). O eventoId espelha
      // exatamente a chave de idempotência do próprio ledger, então mesmo um
      // retry deste efeito nunca conta o fato duas vezes.
      if (resultadoIndicacao === "creditado") {
        await registrarFatoRankingGamificacao(
          "indicacao_convertida",
          `indicacao:${clienteId}:primeira-compra:${pedido.id}`,
        );
        // Missão da temporada "Indique um amigo" — reaproveita o MESMO
        // crédito real de indicação, nunca cria um sistema paralelo. Quem
        // cumpre a missão é o indicador (candidatura.indicadorId), não o
        // indicado. Sem temporada ativa, fica fail-closed (sem missão).
        const temporadaIndicacao = await obterTemporadaAtiva(tenantId);
        if (temporadaIndicacao) {
          await concluirMissaoIndicacaoNoPedido({
            tenantId,
            temporadaId: temporadaIndicacao.temporadaId,
            clienteId: candidatura.indicadorId,
            pedidoId: pedido.id,
            agora: new Date(),
          });
        }
      }
    });

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
