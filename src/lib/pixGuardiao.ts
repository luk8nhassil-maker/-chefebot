import { redis } from "./redis";
import type { PedidoComPix } from "./pix";
import {
  obterEstadoVerificacaoPix,
  lockReconciliacaoAtivo,
  reconciliarPixMercadoPago,
  type ResumoReconciliacaoPix,
} from "./mercadoPagoReconciliacao";
import {
  calcularIntervaloPorIdade,
  PIX_GUARDIAO_MAX_RECUPERACOES,
  PIX_GUARDIAO_COOLDOWN_RECUPERACAO_SEGUNDOS,
  PIX_GUARDIAO_MULTIPLICADOR_ATRASO,
  PIX_GUARDIAO_FALHAS_CONSECUTIVAS_LIMITE,
  PIX_GUARDIAO_IDADE_MAXIMA_MS,
} from "./pixAutoCheckConfig";
import { incrementarContadorPix, mascararIdentificador } from "./pixMetricas";

// Guardião Pix — evolução do conciliador (Guardião Pix). Módulo interno,
// 100% determinístico: NENHUMA decisão probabilística/LLM sobre dinheiro.
// Só avalia saúde OPERACIONAL da verificação e, quando seguro, reencaminha
// o pagamento para o mecanismo central de confirmação já existente
// (reconciliarPixMercadoPago) — nunca cria um caminho de confirmação novo,
// nunca inventa paymentId, nunca confirma por tempo decorrido ou por
// existir comprovante. pix.status/pixConfirmado continuam sendo a única
// fonte da verdade financeira; os estados abaixo são só observabilidade.

export type PixSaude =
  | "healthy"
  | "delayed"
  | "recovering"
  | "rate_limited"
  | "failed"
  | "confirmed"
  | "cancelled"
  | "expired";

export type PixGuardiaoMotivo =
  | "sem_tentativa_na_janela_esperada"
  | "falhas_consecutivas"
  | "lock_abandonado_expirado"
  | "ultima_verificacao_antiga"
  | "conciliador_sem_atividade_recente"
  | "timeout_recorrente"
  | "rate_limited_recente"
  | "payment_id_ausente_ou_inconsistente"
  | "inconsistencia_pedido_metadata";

export type PixGuardiaoAvaliacao = {
  pedidoId: string;
  saude: PixSaude;
  motivos: PixGuardiaoMotivo[];
  idadeMs: number | null;
  precisaRecuperacao: boolean;
  ambiguo: boolean;
  recuperacoesRealizadas: number;
};

type PedidoGuardiao = PedidoComPix & {
  pixConfirmado?: boolean;
  status?: string;
};

const CONTADOR_RECUPERACOES_PREFIXO = "pix:guardiao:tentativas:";
const COOLDOWN_RECUPERACAO_PREFIXO = "pix:guardiao:cooldown:";
const LOG_TENTATIVAS_PREFIXO = "pix:guardiao:log:";
const LOG_TENTATIVAS_MAX = 20;
const CONTADOR_TTL_SEGUNDOS = 24 * 60 * 60;

// Margem acima do TTL do lock do conciliador (90s, mercadoPagoReconciliacao.ts)
// — se a última tentativa é mais antiga que isso E o lock não está mais
// ativo agora, o processo anterior quase certamente travou/derrubou sem
// concluir (o Redis já expirou o lock sozinho havia tempo). O Guardião só
// REGISTRA essa leitura — nunca apaga chave de lock nenhuma; quem readquire
// o lock é sempre reconciliarPixMercadoPago via NX, com segurança total.
const LOCK_TTL_COM_MARGEM_MS = 95_000;

// Elegibilidade do Guardião é DELIBERADAMENTE mais ampla que a do
// conciliador (elegivelParaReconciliacao, que exige providerPaymentId
// presente): o Guardião precisa enxergar exatamente os pedidos Mercado
// Pago pendentes SEM providerPaymentId — é esse o caso central que precisa
// classificar como ambíguo/precisa de conferência. Nunca aplicada a Pix
// manual por chave (provider !== "mercadopago").
export function selecionarPedidosGuardiaoPix(pedidos: PedidoGuardiao[]): PedidoGuardiao[] {
  return pedidos.filter(
    (p) =>
      typeof p.id === "string" &&
      p.id.length > 0 &&
      p.pix?.provider === "mercadopago" &&
      p.pix?.status !== "confirmado" &&
      p.pixConfirmado !== true
  );
}

function idade(criadoEm: string | undefined, agora: number): number | null {
  if (!criadoEm) return null;
  const t = new Date(criadoEm).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, agora - t);
}

// Consistência determinística entre pedido, metadata e paymentId — não é uma
// busca no Mercado Pago (o cliente MP existente só consulta por paymentId, não
// por external_reference). Quando o paymentId está ausente ou o txid não bate
// com o padrão gerado para o próprio pedido, o Guardião não tem como
// consultar com segurança: mantém pendente e sinaliza necessidade de
// conferência, em vez de inventar ou adivinhar um identificador.
function fallbackIdentificadoresSeguro(pedido: PedidoGuardiao): { seguro: boolean; motivo?: PixGuardiaoMotivo } {
  const paymentId = pedido.pix?.providerPaymentId?.trim();
  if (paymentId) return { seguro: true };

  const txid = pedido.pix?.txid?.trim();
  const txidEsperado = pedido.id ? `chefebot_${pedido.id}` : undefined;
  if (!txid || !txidEsperado || txid !== txidEsperado) {
    return { seguro: false, motivo: "inconsistencia_pedido_metadata" };
  }
  // txid consistente, mas sem paymentId: nada a consultar ainda — não é uma
  // ambiguidade grave, mas também não há query segura possível agora.
  return { seguro: false, motivo: "payment_id_ausente_ou_inconsistente" };
}

/**
 * Avaliação pura de saúde — não lê nem escreve Redis. Recebe o estado
 * operacional já resolvido (tentativas, lock, cooldown, contadores) para
 * ser 100% testável sem mocks de infraestrutura.
 */
export function avaliarSaudePix(
  pedido: PedidoGuardiao,
  agora: number,
  estado: {
    ultimaTentativaMs: number | null;
    ultimoSucessoMs: number | null;
    falhasConsecutivas: number;
    lockAtivo: boolean;
    emCooldownRateLimitGlobal: boolean;
    emCooldownRecuperacaoPropria: boolean;
    recuperacoesRealizadas: number;
  }
): PixGuardiaoAvaliacao {
  const pedidoId = String(pedido.id || "");

  if (pedido.status === "cancelado") {
    return { pedidoId, saude: "cancelled", motivos: [], idadeMs: null, precisaRecuperacao: false, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
  }
  if (pedido.pixConfirmado === true || pedido.pix?.status === "confirmado") {
    return { pedidoId, saude: "confirmed", motivos: [], idadeMs: null, precisaRecuperacao: false, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
  }

  const idadeMs = idade(pedido.pix?.criadoEm, agora);

  if (idadeMs !== null && idadeMs >= PIX_GUARDIAO_IDADE_MAXIMA_MS) {
    return { pedidoId, saude: "expired", motivos: [], idadeMs, precisaRecuperacao: false, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
  }

  if (estado.recuperacoesRealizadas >= PIX_GUARDIAO_MAX_RECUPERACOES) {
    return { pedidoId, saude: "failed", motivos: [], idadeMs, precisaRecuperacao: false, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
  }

  const { seguro, motivo: motivoAmbiguidade } = fallbackIdentificadoresSeguro(pedido);
  if (!seguro) {
    return {
      pedidoId,
      saude: "delayed",
      motivos: motivoAmbiguidade ? [motivoAmbiguidade] : [],
      idadeMs,
      precisaRecuperacao: false,
      ambiguo: true,
      recuperacoesRealizadas: estado.recuperacoesRealizadas,
    };
  }

  if (estado.emCooldownRateLimitGlobal) {
    return { pedidoId, saude: "rate_limited", motivos: ["rate_limited_recente"], idadeMs, precisaRecuperacao: false, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
  }

  if (estado.lockAtivo) {
    return { pedidoId, saude: "recovering", motivos: [], idadeMs, precisaRecuperacao: false, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
  }

  const motivos: PixGuardiaoMotivo[] = [];
  const intervaloEsperadoMs = calcularIntervaloPorIdade(idadeMs ?? 0);
  const limiteAtrasoMs = intervaloEsperadoMs * PIX_GUARDIAO_MULTIPLICADOR_ATRASO;

  if (estado.ultimaTentativaMs === null) {
    if (idadeMs !== null && idadeMs > intervaloEsperadoMs) motivos.push("sem_tentativa_na_janela_esperada");
  } else if (agora - estado.ultimaTentativaMs > limiteAtrasoMs) {
    motivos.push("ultima_verificacao_antiga");
    if (agora - estado.ultimaTentativaMs > LOCK_TTL_COM_MARGEM_MS) motivos.push("lock_abandonado_expirado");
  }

  if (estado.ultimoSucessoMs === null && estado.ultimaTentativaMs !== null && agora - estado.ultimaTentativaMs > limiteAtrasoMs) {
    motivos.push("conciliador_sem_atividade_recente");
  }

  if (estado.falhasConsecutivas >= PIX_GUARDIAO_FALHAS_CONSECUTIVAS_LIMITE) {
    motivos.push("falhas_consecutivas");
  }

  if (estado.emCooldownRecuperacaoPropria) {
    // Já tentamos recuperar recentemente — não reencaminha de novo agora,
    // mas continua "delayed"/"healthy" conforme os demais sinais.
    return {
      pedidoId,
      saude: motivos.length > 0 ? "delayed" : "healthy",
      motivos,
      idadeMs,
      precisaRecuperacao: false,
      ambiguo: false,
      recuperacoesRealizadas: estado.recuperacoesRealizadas,
    };
  }

  if (motivos.length > 0) {
    return { pedidoId, saude: "delayed", motivos, idadeMs, precisaRecuperacao: true, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
  }

  return { pedidoId, saude: "healthy", motivos: [], idadeMs, precisaRecuperacao: false, ambiguo: false, recuperacoesRealizadas: estado.recuperacoesRealizadas };
}

async function registrarLogTentativa(pedidoId: string, entrada: Record<string, unknown>): Promise<void> {
  try {
    const chave = `${LOG_TENTATIVAS_PREFIXO}${pedidoId}`;
    const existentes = (await redis.get<Record<string, unknown>[]>(chave)) || [];
    const atualizado = [...existentes, entrada].slice(-LOG_TENTATIVAS_MAX);
    await redis.set(chave, atualizado, { ex: CONTADOR_TTL_SEGUNDOS });
  } catch {
    // Log é best-effort — nunca pode impedir a recuperação de seguir.
  }
}

export type ResultadoGuardiaoPix = {
  avaliadas: number;
  saude: Record<PixSaude, number>;
  recuperacoesTentadas: number;
  recuperacoesBemSucedidas: number;
  ambiguos: number;
  resumoReconciliacao?: ResumoReconciliacaoPix;
};

function resumoSaudeVazio(): Record<PixSaude, number> {
  return { healthy: 0, delayed: 0, recovering: 0, rate_limited: 0, failed: 0, confirmed: 0, cancelled: 0, expired: 0 };
}

/**
 * Orquestração do Guardião Pix. Lê o estado real do sistema (Redis) e, para
 * pagamentos "delayed" e seguros (não ambíguos, dentro do limite de
 * recuperações, sem lock/cooldown ativos), reencaminha via o MESMO
 * mecanismo central de confirmação (reconciliarPixMercadoPago), agora
 * restrito a esses IDs — nunca abre um segundo caminho de confirmação e
 * nunca dispara mais de uma chamada concorrente por rodada (mesmo lock
 * Redis do conciliador protege isso).
 */
export async function executarGuardiaoPix(): Promise<ResultadoGuardiaoPix> {
  const agora = Date.now();
  const pedidos = (await redis.get<PedidoGuardiao[]>("pedidos")) || [];
  const pendentesMP = selecionarPedidosGuardiaoPix(pedidos);

  const resultado: ResultadoGuardiaoPix = {
    avaliadas: 0,
    saude: resumoSaudeVazio(),
    recuperacoesTentadas: 0,
    recuperacoesBemSucedidas: 0,
    ambiguos: 0,
  };

  if (pendentesMP.length === 0) return resultado;

  const [emCooldownRateLimitGlobal, lockAtivo] = await Promise.all([
    redis.get("cooldown:mercadopago:reconciliacao").then(Boolean),
    lockReconciliacaoAtivo(),
  ]);

  const idsParaRecuperar: string[] = [];
  const idsComLockAbandonado = new Set<string>();

  for (const pedido of pendentesMP) {
    const pedidoId = String(pedido.id || "");
    if (!pedidoId) continue;

    const [estadoVerificacao, tentativasBrutas, emCooldownRecuperacaoPropria] = await Promise.all([
      obterEstadoVerificacaoPix(pedidoId),
      redis.get<string | number>(`${CONTADOR_RECUPERACOES_PREFIXO}${pedidoId}`),
      redis.get(`${COOLDOWN_RECUPERACAO_PREFIXO}${pedidoId}`).then(Boolean),
    ]);

    const avaliacao = avaliarSaudePix(pedido, agora, {
      ...estadoVerificacao,
      lockAtivo,
      emCooldownRateLimitGlobal,
      emCooldownRecuperacaoPropria,
      recuperacoesRealizadas: Number(tentativasBrutas || 0),
    });

    resultado.avaliadas++;
    resultado.saude[avaliacao.saude]++;
    if (avaliacao.ambiguo) resultado.ambiguos++;
    if (avaliacao.saude === "failed") await incrementarContadorPix("guardiao_failed");

    if (avaliacao.precisaRecuperacao) {
      idsParaRecuperar.push(pedidoId);
      if (avaliacao.motivos.includes("lock_abandonado_expirado")) idsComLockAbandonado.add(pedidoId);
    }
  }

  if (idsParaRecuperar.length > 0) {
    resultado.recuperacoesTentadas = idsParaRecuperar.length;

    // Marca cooldown e incrementa o contador de tentativas ANTES de disparar
    // a consulta — limita recuperações mesmo se o processo cair no meio.
    await Promise.all(
      idsParaRecuperar.map(async (pedidoId) => {
        const chaveContador = `${CONTADOR_RECUPERACOES_PREFIXO}${pedidoId}`;
        const atual = Number((await redis.get<string | number>(chaveContador)) || 0);
        await redis.set(chaveContador, String(atual + 1), { ex: CONTADOR_TTL_SEGUNDOS });
        await redis.set(`${COOLDOWN_RECUPERACAO_PREFIXO}${pedidoId}`, "1", { ex: PIX_GUARDIAO_COOLDOWN_RECUPERACAO_SEGUNDOS });
        await registrarLogTentativa(pedidoId, {
          em: new Date(agora).toISOString(),
          motivo: "guardiao_recuperacao",
          identificador: mascararIdentificador(pedidoId),
        });
      })
    );

    const resumo = await reconciliarPixMercadoPago({ apenasPedidoIds: idsParaRecuperar });
    resultado.resumoReconciliacao = resumo;
    resultado.recuperacoesBemSucedidas = resumo.confirmados;
    if (resumo.confirmados > 0) await incrementarContadorPix("guardiao_recuperado", resumo.confirmados);
    if (idsComLockAbandonado.size > 0 && !resumo.locked) {
      await incrementarContadorPix("locks_recuperados", idsComLockAbandonado.size);
    }
  }

  return resultado;
}
