import { randomUUID } from "crypto";
import { redis } from "./redis";
import {
  buscarComanda,
  comRodadasNormalizadas,
  fecharComanda,
  type Comanda,
} from "./comandas";
import { getMENUDinamico } from "./menu.server";
import { mutarPedidos } from "./pedidosConcorrencia";
import {
  avaliarSolicitacaoConta,
  compararTotalEsperado,
  contaBloqueiaNovosItens,
  ehStatusPedidoSalao,
  estadoInicialContaSalao,
  subtotalEnvioCentavos,
  totalAtivoCentavos,
  type EnvioOperacionalSalao,
  type EstadoContaSalao,
  type StatusPedidoSalao,
} from "./salaoConta";
import { validarPagamentoContaSalao } from "./salaoPagamento";

const PREFIXO_ESTADO = "salao:conta:v1:";
const PREFIXO_LOCK = "salao:conta:lock:v1:";
const LOCK_TTL_SEGUNDOS = 20;

const LIBERAR_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

type PedidoSalaoOperacional = {
  id: string;
  total?: number;
  status?: unknown;
  statusAtualizadoEm?: string;
  pagamento?: string;
  troco?: string;
  tipoEntrega?: string;
  endereco?: string;
  salaoPagamentoConfirmadoEm?: string;
  salaoPagamentoConfirmadoPor?: string;
};

export type ResumoOperacionalComanda = {
  comanda: Comanda;
  conta: EstadoContaSalao;
  envios: EnvioOperacionalSalao[];
  totalAtivoCentavos: number;
  todosServidos: boolean;
  temRodadaEmAndamento: boolean;
};

function chaveEstado(comandaId: string) {
  return `${PREFIXO_ESTADO}${comandaId}`;
}

function chaveLock(comandaId: string) {
  return `${PREFIXO_LOCK}${comandaId}`;
}

function escritaBloqueadaNoPreview() {
  return process.env.VERCEL_ENV === "preview";
}

async function comLockComanda<T>(comandaId: string, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const key = chaveLock(comandaId);
  const adquirido = await redis.set(key, token, { nx: true, ex: LOCK_TTL_SEGUNDOS });
  if (!adquirido) throw new Error("comanda_em_atualizacao");
  try {
    return await fn();
  } finally {
    try {
      await redis.eval(LIBERAR_LOCK_LUA, [key], [token]);
    } catch {
      // best-effort: TTL impede lock permanente.
    }
  }
}

export async function lerEstadoContaSalao(comandaId: string): Promise<EstadoContaSalao> {
  const salvo = await redis.get<EstadoContaSalao>(chaveEstado(comandaId)).catch(() => null);
  if (!salvo || salvo.comandaId !== comandaId || !["aberta", "conta_solicitada", "fechando", "fechada"].includes(salvo.status)) {
    return estadoInicialContaSalao(comandaId);
  }
  return salvo;
}

async function salvarEstadoContaSalao(estado: EstadoContaSalao): Promise<void> {
  await redis.set(chaveEstado(estado.comandaId), { ...estado, atualizadoEm: new Date().toISOString() });
}

async function mapaPedidos(ids: string[]): Promise<Map<string, PedidoSalaoOperacional>> {
  const idsSet = new Set(ids.filter(Boolean));
  if (idsSet.size === 0) return new Map();
  const pedidos = await redis.get<PedidoSalaoOperacional[]>("pedidos").catch(() => null);
  const mapa = new Map<string, PedidoSalaoOperacional>();
  if (!Array.isArray(pedidos)) return mapa;
  for (const pedido of pedidos) {
    if (pedido && typeof pedido.id === "string" && idsSet.has(pedido.id)) mapa.set(pedido.id, pedido);
  }
  return mapa;
}

export async function resumoOperacionalComanda(comandaId: string): Promise<ResumoOperacionalComanda | null> {
  const comandaBase = await buscarComanda(comandaId);
  if (!comandaBase) return null;
  const comanda = comRodadasNormalizadas(comandaBase);
  const ids = comanda.rodadas!.flatMap((rodada) => rodada.pedidoId ? [rodada.pedidoId] : []);
  const [conta, pedidos] = await Promise.all([lerEstadoContaSalao(comandaId), mapaPedidos(ids)]);

  const envios: EnvioOperacionalSalao[] = comanda.rodadas!.map((rodada) => {
    const pedido = rodada.pedidoId ? pedidos.get(rodada.pedidoId) : undefined;
    const status = ehStatusPedidoSalao(pedido?.status) ? pedido.status : undefined;
    return {
      rodadaId: rodada.id,
      numero: rodada.numero,
      ...(rodada.pedidoId ? { pedidoId: rodada.pedidoId } : {}),
      subtotalCentavos: subtotalEnvioCentavos({
        subtotalRodada: rodada.subtotal,
        pedidoId: rodada.pedidoId,
        totalPedidoOficial: pedido?.total,
      }),
      ...(status ? { status } : {}),
      ...(typeof pedido?.statusAtualizadoEm === "string" ? { statusAtualizadoEm: pedido.statusAtualizadoEm } : {}),
    };
  });

  const temRodadaEmAndamento = comanda.rodadas!.some((rodada) => rodada.status !== "enviada");
  const ativos = envios.filter((envio) => envio.pedidoId && envio.status !== "cancelado");
  const todosServidos = ativos.length > 0 && ativos.every((envio) => envio.status === "entregue");
  return {
    comanda,
    conta,
    envios,
    totalAtivoCentavos: totalAtivoCentavos(envios),
    todosServidos,
    temRodadaEmAndamento,
  };
}

export async function listarResumosOperacionais(): Promise<ResumoOperacionalComanda[]> {
  const { listarComandas } = await import("./comandas");
  const comandas = await listarComandas();
  const abertas = comandas.filter((comanda) => comanda.status !== "fechada");
  const resumos = await Promise.all(abertas.map((comanda) => resumoOperacionalComanda(comanda.id)));
  return resumos.filter((item): item is ResumoOperacionalComanda => Boolean(item));
}

export async function podeAdicionarItensNaComanda(comandaId: string): Promise<boolean> {
  const estado = await lerEstadoContaSalao(comandaId);
  return !contaBloqueiaNovosItens(estado);
}

/**
 * Serializa qualquer mutação de uma comanda aberta com as transições da conta.
 * O check de "conta aberta" acontece dentro do MESMO lock usado por
 * solicitar/reabrir/fechar conta. Assim uma requisição que começou um instante
 * antes do clique em "Pedir conta" não consegue gravar itens depois da conta
 * ter sido solicitada, e o pedido da conta não consegue ultrapassar uma
 * mutação de itens ainda não concluída.
 */
export async function executarMutacaoComContaAbertaSalao<T>(
  comandaId: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; valor: T } | { ok: false; status: number; error: string }> {
  try {
    return await comLockComanda(comandaId, async () => {
      const estado = await lerEstadoContaSalao(comandaId);
      if (contaBloqueiaNovosItens(estado)) {
        return { ok: false as const, status: 409, error: "A conta já foi solicitada. Continue o atendimento antes de alterar a comanda." };
      }
      return { ok: true as const, valor: await fn() };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "comanda_em_atualizacao") {
      return { ok: false as const, status: 409, error: "Esta comanda está sendo atualizada em outro aparelho. Tente novamente." };
    }
    throw error;
  }
}

export async function solicitarContaSalao(comandaId: string, responsavel: string) {
  if (escritaBloqueadaNoPreview()) return { ok: false as const, status: 403, error: "Ações reais do Salão ficam bloqueadas no Preview." };
  try {
    return await comLockComanda(comandaId, async () => {
      const resumo = await resumoOperacionalComanda(comandaId);
      if (!resumo) return { ok: false as const, status: 404, error: "Comanda não encontrada." };
      if (resumo.comanda.status === "fechada" || resumo.conta.status === "fechada") {
        return { ok: false as const, status: 409, error: "Esta comanda já está fechada." };
      }
      if (resumo.conta.status === "conta_solicitada") return { ok: true as const, estado: resumo.conta, deduplicado: true };
      if (resumo.conta.status === "fechando") {
        return { ok: false as const, status: 409, error: "O pagamento desta comanda já está sendo processado." };
      }

      const avaliacao = avaliarSolicitacaoConta({
        envios: resumo.envios,
        temRodadaEmAndamento: resumo.temRodadaEmAndamento,
      });
      if (!avaliacao.ok) return { ok: false as const, status: 409, error: avaliacao.error, code: avaliacao.code };

      const agora = new Date().toISOString();
      const estado: EstadoContaSalao = {
        ...resumo.conta,
        status: "conta_solicitada",
        contaSolicitadaEm: agora,
        contaSolicitadaPor: responsavel || "Salão",
        atualizadoEm: agora,
      };
      await salvarEstadoContaSalao(estado);
      return { ok: true as const, estado, deduplicado: false };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "comanda_em_atualizacao") {
      return { ok: false as const, status: 409, error: "Esta comanda está sendo atualizada em outro aparelho. Tente novamente." };
    }
    throw error;
  }
}

export async function reabrirAtendimentoSalao(comandaId: string, responsavel: string) {
  if (escritaBloqueadaNoPreview()) return { ok: false as const, status: 403, error: "Ações reais do Salão ficam bloqueadas no Preview." };
  try {
    return await comLockComanda(comandaId, async () => {
      const resumo = await resumoOperacionalComanda(comandaId);
      if (!resumo) return { ok: false as const, status: 404, error: "Comanda não encontrada." };
      if (resumo.comanda.status === "fechada" || resumo.conta.status === "fechada") {
        return { ok: false as const, status: 409, error: "Comanda paga não pode ser reaberta." };
      }
      if (resumo.conta.status === "fechando") {
        return { ok: false as const, status: 409, error: "O fechamento desta comanda já começou e não pode ser desfeito agora." };
      }
      const agora = new Date().toISOString();
      const estado: EstadoContaSalao = {
        comandaId,
        status: "aberta",
        atualizadoEm: agora,
      };
      await salvarEstadoContaSalao(estado);
      return { ok: true as const, estado, responsavel };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "comanda_em_atualizacao") {
      return { ok: false as const, status: 409, error: "Esta comanda está sendo atualizada em outro aparelho. Tente novamente." };
    }
    throw error;
  }
}

export async function marcarEnvioServidoSalao(comandaId: string, pedidoId: string, responsavel: string) {
  if (escritaBloqueadaNoPreview()) return { ok: false as const, status: 403, error: "Ações reais do Salão ficam bloqueadas no Preview." };
  try {
    return await comLockComanda(comandaId, async () => {
      const resumo = await resumoOperacionalComanda(comandaId);
      if (!resumo) return { ok: false as const, status: 404, error: "Comanda não encontrada." };
      if (contaBloqueiaNovosItens(resumo.conta)) {
        return { ok: false as const, status: 409, error: "A conta já foi solicitada. Reabra o atendimento antes de corrigir o serviço." };
      }
      const envio = resumo.envios.find((item) => item.pedidoId === pedidoId);
      if (!envio) return { ok: false as const, status: 404, error: "Envio não encontrado nesta comanda." };
      if (envio.status === "entregue") return { ok: true as const, deduplicado: true };
      if (envio.status !== "saiu_entrega") {
        return { ok: false as const, status: 409, error: "Somente um pedido pronto pode ser marcado como servido." };
      }

      const agora = new Date().toISOString();
      const alterado = await mutarPedidos<PedidoSalaoOperacional, boolean>((pedidos) => {
        const idx = pedidos.findIndex((pedido) => pedido.id === pedidoId);
        if (idx < 0 || pedidos[idx].status !== "saiu_entrega") return { persistir: false, resultado: false };
        const novos = [...pedidos];
        novos[idx] = {
          ...novos[idx],
          status: "entregue" satisfies StatusPedidoSalao,
          statusAtualizadoEm: agora,
          salaoServidoPor: responsavel || "Salão",
        } as PedidoSalaoOperacional;
        return { persistir: true, pedidos: novos, resultado: true };
      });
      if (!alterado) return { ok: false as const, status: 409, error: "O pedido mudou de etapa em outro aparelho. Atualize e tente novamente." };
      return { ok: true as const, deduplicado: false };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "comanda_em_atualizacao") {
      return { ok: false as const, status: 409, error: "Esta comanda está sendo atualizada em outro aparelho. Tente novamente." };
    }
    throw error;
  }
}

export async function fecharContaSalao(params: {
  comandaId: string;
  responsavel: string;
  requestId: string;
  totalEsperadoCentavos: unknown;
  pagamento: unknown;
  troco?: unknown;
  valorPix?: unknown;
  valorDinheiro?: unknown;
}) {
  if (escritaBloqueadaNoPreview()) return { ok: false as const, status: 403, error: "Pagamento real do Salão fica bloqueado no Preview." };
  try {
    return await comLockComanda(params.comandaId, async () => {
      const resumo = await resumoOperacionalComanda(params.comandaId);
      if (!resumo) return { ok: false as const, status: 404, error: "Comanda não encontrada." };

      if (resumo.conta.status === "fechada") {
        if (resumo.conta.fechamentoRequestId === params.requestId) {
          return { ok: true as const, estado: resumo.conta, deduplicado: true };
        }
        return { ok: false as const, status: 409, error: "Esta comanda já foi paga." };
      }
      if (resumo.conta.status === "fechando" && resumo.conta.fechamentoRequestId !== params.requestId) {
        return { ok: false as const, status: 409, error: "Outro fechamento já está em andamento para esta comanda." };
      }
      if (resumo.conta.status === "aberta") {
        return { ok: false as const, status: 409, error: "Peça a conta antes de receber o pagamento." };
      }

      const avaliacao = avaliarSolicitacaoConta({
        envios: resumo.envios,
        temRodadaEmAndamento: resumo.temRodadaEmAndamento,
      });
      if (!avaliacao.ok) return { ok: false as const, status: 409, error: avaliacao.error, code: avaliacao.code };
      const totalOficialCentavos = avaliacao.totalCentavos;
      if (!compararTotalEsperado(params.totalEsperadoCentavos, totalOficialCentavos)) {
        return { ok: false as const, status: 409, error: "A comanda mudou enquanto o pagamento estava aberto. Atualize e confira o novo total." };
      }

      const menu = await getMENUDinamico();
      const formasOficiais = Array.isArray(menu.payments) ? menu.payments.filter((item): item is string => typeof item === "string") : [];
      const pagamento = validarPagamentoContaSalao({
        pagamento: params.pagamento,
        troco: params.troco,
        valorPix: params.valorPix,
        valorDinheiro: params.valorDinheiro,
        totalCentavos: totalOficialCentavos,
        formasOficiais,
      });
      if (!pagamento.ok) return { ok: false as const, status: 400, error: pagamento.error };

      const agora = new Date().toISOString();
      const estadoFechando: EstadoContaSalao = {
        ...resumo.conta,
        status: "fechando",
        fechamentoRequestId: params.requestId,
        fechamentoIniciadoEm: resumo.conta.fechamentoIniciadoEm ?? agora,
        totalFinalCentavos: totalOficialCentavos,
        pagamento: pagamento.valor.pagamento,
        ...(pagamento.valor.troco ? { troco: pagamento.valor.troco } : {}),
        atualizadoEm: agora,
      };
      await salvarEstadoContaSalao(estadoFechando);

      const ids = new Set(resumo.envios.flatMap((envio) => envio.pedidoId ? [envio.pedidoId] : []));
      await mutarPedidos<PedidoSalaoOperacional, void>((pedidos) => {
        const novos = pedidos.map((pedido) => ids.has(pedido.id)
          ? {
              ...pedido,
              pagamento: pagamento.valor.pagamento,
              ...(pagamento.valor.troco ? { troco: pagamento.valor.troco } : {}),
              salaoPagamentoConfirmadoEm: agora,
              salaoPagamentoConfirmadoPor: params.responsavel || "Caixa",
            }
          : pedido);
        return { persistir: true, pedidos: novos, resultado: undefined };
      });

      const fechamento = await fecharComanda(params.comandaId);
      if (fechamento === "nao_encontrada") {
        return { ok: false as const, status: 404, error: "Comanda não encontrada durante o fechamento." };
      }
      if (fechamento === "ainda_aberta") {
        return { ok: false as const, status: 409, error: "A comanda ainda possui pedido não enviado." };
      }
      if (fechamento === "ja_fechada" && resumo.comanda.status !== "fechada") {
        // Pode ter sido concluída após perda da resposta. Continuamos a reconciliação.
      }

      const estadoFechado: EstadoContaSalao = {
        ...estadoFechando,
        status: "fechada",
        fechadaEm: agora,
        fechadaPor: params.responsavel || "Caixa",
        atualizadoEm: agora,
      };
      await salvarEstadoContaSalao(estadoFechado);
      return { ok: true as const, estado: estadoFechado, deduplicado: false };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "comanda_em_atualizacao") {
      return { ok: false as const, status: 409, error: "Esta comanda está sendo atualizada em outro aparelho. Tente novamente." };
    }
    throw error;
  }
}
