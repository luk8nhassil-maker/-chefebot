import { randomUUID } from "node:crypto";
import { redis } from "./redis";
import { buscarPagamentoMercadoPagoDetalhado, mapearStatusMercadoPago } from "./mercadoPagoWebhook";
import type { PedidoComPix } from "./pix";

// Conciliador manual/sob-demanda do Pix Mercado Pago (Nivel 6.2A) — usado
// enquanto nao ha webhook configurado no painel MP. Consulta a API do MP pelo
// providerPaymentId ja salvo em cada pedido pendente e confirma quando (e só
// quando) o pagamento está "approved" e valor/txid batem. NAO gera Pix, NAO
// mexe no serializador do cliente nem no fallback manual — só lê pedidos já
// existentes e, quando elegível, atualiza pix.status/pixConfirmado, igual ao
// que o webhook (route.ts) já faz.
//
// Nivel 6.5 — robustez para múltiplos Pix pendentes simultâneos: lock Redis
// (evita duas execuções concorrentes de abas/admins diferentes), lote máximo
// por rodada, concorrência limitada às consultas ao MP, timeout por consulta,
// isolamento de erro por pedido, cooldown global em caso de rate limit (429)
// e cooldown curto por pedido para não reconsultar o mesmo pending demais
// vezes. Nenhuma regra de confirmação muda: só approved + centavos batendo +
// txid batendo (quando ambos existem) confirma — timeout, erro de API e rate
// limit nunca confirmam.

type PedidoReconciliavel = PedidoComPix & { pixConfirmado?: boolean };

export type ReconciliacaoOutcome = "confirmado" | "pendente" | "ignorado" | "erro";

export type ReconciliacaoDetalhe = {
  pedidoId: string;
  outcome: ReconciliacaoOutcome;
  motivo?: string;
};

export type ResumoReconciliacaoPix = {
  verificados: number;
  confirmados: number;
  pendentes: number;
  ignorados: number;
  erros: number;
  detalhes: ReconciliacaoDetalhe[];
  // Campos aditivos (Nivel 6.5) — frontend existente ignora o que não conhece.
  locked?: boolean;
  rateLimited?: boolean;
  limitados?: number;
};

const LOCK_KEY = "lock:mercadopago:reconciliacao";
const LOCK_TTL_SEGUNDOS = 90;

const COOLDOWN_RATE_LIMIT_KEY = "cooldown:mercadopago:reconciliacao";
const COOLDOWN_RATE_LIMIT_TTL_SEGUNDOS = 60;

const COOLDOWN_PEDIDO_PREFIXO = "cooldown:pix:";
const COOLDOWN_PEDIDO_TTL_SEGUNDOS = 60;

const LOTE_MAXIMO = 20;
const CONCORRENCIA_MAXIMA = 3;
const TIMEOUT_CONSULTA_MS = 5000;

// Compare-and-delete atômico (Lua via EVAL, suportado pelo @upstash/redis e
// pela REST API da Upstash): só apaga o lock se o valor gravado ainda for o
// lockId desta execução. Evita a corrida de um get+del "manual" (que poderia
// apagar o lock de uma execução seguinte que já tivesse adquirido o lock
// entre o get e o del desta).
const LIBERAR_LOCK_SE_DONO_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

async function liberarLockSeDono(lockId: string): Promise<void> {
  try {
    await redis.eval(LIBERAR_LOCK_SE_DONO_SCRIPT, [LOCK_KEY], [lockId]);
  } catch {
    // Se o EVAL falhar por qualquer motivo, não faz nada: o lock expira
    // sozinho pelo TTL (90s) em vez de arriscar um del sem confirmar dono.
  }
}

function resumoVazio(): ResumoReconciliacaoPix {
  return { verificados: 0, confirmados: 0, pendentes: 0, ignorados: 0, erros: 0, detalhes: [] };
}

function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

function chunk<T>(itens: T[], tamanho: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) chunks.push(itens.slice(i, i + tamanho));
  return chunks;
}

// Critérios de elegibilidade (Nivel 6.2A, item 3): provider mercadopago,
// providerPaymentId salvo, ainda não confirmado por nenhum caminho, e com id
// de pedido válido (defensivo — nunca deveria faltar em pedidos reais).
export function elegivelParaReconciliacao(pedido: PedidoReconciliavel): boolean {
  return (
    typeof pedido.id === "string" &&
    pedido.id.length > 0 &&
    pedido.pix?.provider === "mercadopago" &&
    typeof pedido.pix?.providerPaymentId === "string" &&
    pedido.pix.providerPaymentId.trim().length > 0 &&
    pedido.pix?.status !== "confirmado" &&
    pedido.pixConfirmado !== true
  );
}

export function selecionarPedidosPixMercadoPagoPendentes(
  pedidos: PedidoReconciliavel[]
): PedidoReconciliavel[] {
  return pedidos.filter(elegivelParaReconciliacao);
}

// Timeout defensivo por consulta — não cancela de fato o fetch (evita mexer
// no fetch/webhook além do necessário), mas garante que, do ponto de vista do
// conciliador, uma consulta lenta nunca trava o lote: após ~5s vira erro
// "timeout" e nunca confirma.
async function consultarComTimeout(paymentId: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_CONSULTA_MS);
  try {
    return await buscarPagamentoMercadoPagoDetalhado(paymentId, controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function reconciliarPixMercadoPago(): Promise<ResumoReconciliacaoPix> {
  // Cooldown global de rate limit primeiro — nem tenta o lock nem lê pedidos
  // se uma rodada recente já tomou 429 do Mercado Pago.
  const emCooldownGlobal = await redis.get(COOLDOWN_RATE_LIMIT_KEY);
  if (emCooldownGlobal) return { ...resumoVazio(), rateLimited: true };

  // Lock via Redis (NX): evita duas execuções concorrentes (abas/admins
  // diferentes chamando a rota ao mesmo tempo). TTL 90s continua como rede de
  // segurança contra crash/travamento (execução nunca libera e nunca some);
  // no caminho feliz, o lock é liberado no finally logo ao terminar, via
  // compare-and-delete atômico por lockId — não apaga o lock de execução
  // nenhuma que não seja a própria, então a auto-verificação de 20s não fica
  // bloqueada 90s inteiros por uma reconciliação rápida.
  const lockId = randomUUID();
  const lockAdquirido = await redis.set(LOCK_KEY, lockId, { nx: true, ex: LOCK_TTL_SEGUNDOS });
  if (!lockAdquirido) return { ...resumoVazio(), locked: true };

  try {
    const pedidos = (await redis.get<PedidoReconciliavel[]>("pedidos")) || [];
    const elegiveis = selecionarPedidosPixMercadoPagoPendentes(pedidos);

    const resumo: ResumoReconciliacaoPix = resumoVazio();
    if (elegiveis.length === 0) return resumo;

    // Pula pedidos consultados recentemente (cooldown por pedido) antes de
    // aplicar o corte de lote, para o lote priorizar pedidos "frescos".
    const cooldowns = await Promise.all(
      elegiveis.map((p) => redis.get(`${COOLDOWN_PEDIDO_PREFIXO}${p.id}`))
    );
    const disponiveis = elegiveis.filter((_, i) => !cooldowns[i]);

    // Sem campo de data confiável nos pedidos (horario é só "HH:MM", sem data)
    // — mantém a ordem atual em vez de inventar critério de recência.
    const lote = disponiveis.slice(0, LOTE_MAXIMO);
    const limitados = disponiveis.length - lote.length;
    if (limitados > 0) resumo.limitados = limitados;

    let atualizados = pedidos;
    let mudou = false;
    let rateLimited = false;

    for (const grupo of chunk(lote, CONCORRENCIA_MAXIMA)) {
      if (rateLimited) break;

      const resultados = await Promise.all(
        grupo.map(async (pedido) => {
          const pedidoId = pedido.id as string;
          const paymentId = (pedido.pix?.providerPaymentId as string).trim();
          const resultado = await consultarComTimeout(paymentId).catch((err) => ({
            ok: false as const,
            status: null,
            motivo: err instanceof Error ? err.message : "erro_desconhecido",
          }));
          return { pedido, pedidoId, resultado };
        })
      );

      for (const { pedido, pedidoId, resultado } of resultados) {
        resumo.verificados++;

        if (!resultado.ok) {
          if (resultado.status === 429) {
            rateLimited = true;
            resumo.erros++;
            resumo.detalhes.push({ pedidoId, outcome: "erro", motivo: "rate_limited" });
            continue;
          }
          resumo.erros++;
          resumo.detalhes.push({ pedidoId, outcome: "erro", motivo: resultado.motivo });
          await redis.set(`${COOLDOWN_PEDIDO_PREFIXO}${pedidoId}`, "1", { ex: COOLDOWN_PEDIDO_TTL_SEGUNDOS });
          continue;
        }

        const pagamento = resultado.pagamento;
        const statusInterno = mapearStatusMercadoPago(pagamento.status);

        if (statusInterno === "pendente") {
          resumo.pendentes++;
          resumo.detalhes.push({ pedidoId, outcome: "pendente", motivo: pagamento.status });
          await redis.set(`${COOLDOWN_PEDIDO_PREFIXO}${pedidoId}`, "1", { ex: COOLDOWN_PEDIDO_TTL_SEGUNDOS });
          continue;
        }
        if (statusInterno !== "pago") {
          // rejected/cancelled/refunded e demais: nunca confirma.
          resumo.ignorados++;
          resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: pagamento.status });
          await redis.set(`${COOLDOWN_PEDIDO_PREFIXO}${pedidoId}`, "1", { ex: COOLDOWN_PEDIDO_TTL_SEGUNDOS });
          continue;
        }

        const valorEsperado = pedido.pix?.valorEsperado;
        if (typeof valorEsperado !== "number" || !Number.isFinite(valorEsperado)) {
          resumo.ignorados++;
          resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: "pix_valor_esperado_ausente" });
          await redis.set(`${COOLDOWN_PEDIDO_PREFIXO}${pedidoId}`, "1", { ex: COOLDOWN_PEDIDO_TTL_SEGUNDOS });
          continue;
        }
        if (pagamento.transactionAmount === null || emCentavos(pagamento.transactionAmount) !== emCentavos(valorEsperado)) {
          resumo.ignorados++;
          resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: "valor_divergente" });
          await redis.set(`${COOLDOWN_PEDIDO_PREFIXO}${pedidoId}`, "1", { ex: COOLDOWN_PEDIDO_TTL_SEGUNDOS });
          continue;
        }
        // external_reference só bloqueia quando ambos existem e divergem —
        // ausência de qualquer um dos dois lados não impede a confirmação.
        if (pedido.pix?.txid && pagamento.externalReference && pagamento.externalReference !== pedido.pix.txid) {
          resumo.ignorados++;
          resumo.detalhes.push({ pedidoId, outcome: "ignorado", motivo: "external_reference_divergente" });
          await redis.set(`${COOLDOWN_PEDIDO_PREFIXO}${pedidoId}`, "1", { ex: COOLDOWN_PEDIDO_TTL_SEGUNDOS });
          continue;
        }

        const index = atualizados.findIndex((p) => p.id === pedidoId);
        if (index < 0) {
          resumo.erros++;
          resumo.detalhes.push({ pedidoId, outcome: "erro", motivo: "pedido_nao_encontrado" });
          continue;
        }

        const confirmadoEm = new Date().toISOString();
        atualizados = [...atualizados];
        atualizados[index] = {
          ...atualizados[index],
          pixConfirmado: true,
          pix: {
            ...atualizados[index].pix,
            status: "confirmado",
            confirmadoPor: "conciliador_mercadopago",
            confirmadoEm,
            providerPaymentId: pagamento.id,
          },
        };
        mudou = true;

        resumo.confirmados++;
        resumo.detalhes.push({ pedidoId, outcome: "confirmado" });
      }
    }

    if (rateLimited) {
      resumo.rateLimited = true;
      await redis.set(COOLDOWN_RATE_LIMIT_KEY, "1", { ex: COOLDOWN_RATE_LIMIT_TTL_SEGUNDOS });
    }

    if (mudou) await redis.set("pedidos", atualizados);

    return resumo;
  } finally {
    // Libera o lock só se ainda formos o dono (compare-and-delete atômico) —
    // sucesso, erro ou exceção, sempre tenta liberar para não segurar a
    // auto-verificação de 20s por mais tempo que o necessário. Se o EVAL
    // falhar, o TTL de 90s continua como rede de segurança.
    await liberarLockSeDono(lockId);
  }
}
