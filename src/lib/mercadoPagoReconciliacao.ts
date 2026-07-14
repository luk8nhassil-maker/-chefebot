import { randomUUID } from "node:crypto";
import { redis } from "./redis";
import { buscarPagamentoMercadoPagoDetalhado, mapearStatusMercadoPago } from "./mercadoPagoWebhook";
import { enviarTextoWhatsApp } from "./whatsappMensagem";
import type { PedidoComPix } from "./pix";
import { incrementarContadorPix } from "./pixMetricas";

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

type PedidoReconciliavel = PedidoComPix & {
  pixConfirmado?: boolean;
  // Aditivos (Nível 6.6A) — presentes só em pedidos criados pelo webhook do
  // WhatsApp (origem) ou que já tinham telefone (app/site/WhatsApp). Nunca
  // usados para decidir CONFIRMAÇÃO do Pix — só para decidir NOTIFICAÇÃO.
  origem?: string;
  telefone?: string;
};

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

// Instrumentação por pedido (Guardião Pix) — última tentativa, última
// resposta válida (não-erro, independente de aprovar) e falhas consecutivas.
// Puramente observacional: nunca influencia se um pagamento é confirmado,
// só alimenta a avaliação de saúde do Guardião (pixGuardiao.ts). TTL de 24h
// é suficiente para qualquer janela de detecção usada pelo Guardião.
const ULTIMA_TENTATIVA_PREFIXO = "pix:verificacao:ultimaTentativa:";
const ULTIMO_SUCESSO_PREFIXO = "pix:verificacao:ultimoSucesso:";
const FALHAS_CONSECUTIVAS_PREFIXO = "pix:verificacao:falhasConsecutivas:";
const INSTRUMENTACAO_TTL_SEGUNDOS = 24 * 60 * 60;

async function registrarTentativaVerificacao(pedidoId: string, sucesso: boolean): Promise<void> {
  try {
    const agora = Date.now().toString();
    await redis.set(`${ULTIMA_TENTATIVA_PREFIXO}${pedidoId}`, agora, { ex: INSTRUMENTACAO_TTL_SEGUNDOS });
    if (sucesso) {
      await redis.set(`${ULTIMO_SUCESSO_PREFIXO}${pedidoId}`, agora, { ex: INSTRUMENTACAO_TTL_SEGUNDOS });
      await redis.set(`${FALHAS_CONSECUTIVAS_PREFIXO}${pedidoId}`, "0", { ex: INSTRUMENTACAO_TTL_SEGUNDOS });
    } else {
      const chave = `${FALHAS_CONSECUTIVAS_PREFIXO}${pedidoId}`;
      const atual = Number((await redis.get<string | number>(chave)) || 0);
      await redis.set(chave, String(atual + 1), { ex: INSTRUMENTACAO_TTL_SEGUNDOS });
    }
  } catch {
    // Observabilidade nunca pode impedir a reconciliação de seguir.
  }
}

// Nível 6.6A — notificação ao cliente WhatsApp quando o conciliador confirma
// o Pix. Duas chaves distintas por pedido:
// - lock curto (NX + TTL curto): evita duplicidade entre chamadas concorrentes
//   a esta função (defesa em profundidade além do lock global acima).
// - marcador permanente: só é gravado DEPOIS que a Evolution confirma sucesso.
//   Sem ele, a próxima rodada tenta notificar de novo (retry natural).
const PIX_NOTIFICADO_PREFIXO = "pix:notificado:";
const PIX_NOTIFICACAO_LOCK_PREFIXO = "lock:pix:notificacao:";
const PIX_NOTIFICACAO_LOCK_TTL_SEGUNDOS = 30;

const MSG_PIX_CONFIRMADO_WHATSAPP = "Pagamento confirmado ✅ Recebemos seu Pix e seu pedido foi confirmado.";

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

// Leitura (só leitura) da instrumentação acima, usada pelo Guardião Pix para
// avaliar saúde sem duplicar nenhum estado próprio de tentativa.
export type EstadoVerificacaoPix = {
  ultimaTentativaMs: number | null;
  ultimoSucessoMs: number | null;
  falhasConsecutivas: number;
};

export async function obterEstadoVerificacaoPix(pedidoId: string): Promise<EstadoVerificacaoPix> {
  const [ultimaTentativa, ultimoSucesso, falhas] = await Promise.all([
    redis.get<string>(`${ULTIMA_TENTATIVA_PREFIXO}${pedidoId}`),
    redis.get<string>(`${ULTIMO_SUCESSO_PREFIXO}${pedidoId}`),
    redis.get<string | number>(`${FALHAS_CONSECUTIVAS_PREFIXO}${pedidoId}`),
  ]);
  return {
    ultimaTentativaMs: ultimaTentativa ? Number(ultimaTentativa) : null,
    ultimoSucessoMs: ultimoSucesso ? Number(ultimoSucesso) : null,
    falhasConsecutivas: Number(falhas || 0),
  };
}

// Só leitura: nunca apaga nem cria o lock — o Guardião usa isto apenas para
// classificar saúde ("recovering" quando alguém já está processando). A
// posse/liberação do lock continua 100% dentro desta função, via
// compare-and-delete atômico (liberarLockSeDono).
export async function lockReconciliacaoAtivo(): Promise<boolean> {
  return !!(await redis.get(LOCK_KEY));
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

// Elegibilidade para NOTIFICAÇÃO (Nível 6.6A) — distinta e mais restrita que
// elegivelParaReconciliacao (que decide CONFIRMAÇÃO). Só considera pedidos:
// - com origem === "whatsapp" (nunca app/site, mesmo com telefone);
// - com telefone válido (não vazio após trim);
// - já confirmados, e confirmados especificamente por este conciliador
//   (confirmadoPor === "conciliador_mercadopago" — nunca por comprovante,
//   que já dispara sua própria mensagem inline no webhook, nem por Pix
//   manual, que nunca chega a este confirmadoPor).
// Recalculada a cada rodada a partir do array de pedidos já em memória —
// não depende de nenhuma fila/flag adicional: o único "estado" de retry é a
// ausência do marcador permanente pix:notificado:{id}.
export function elegivelParaNotificacaoWhatsApp(pedido: PedidoReconciliavel): boolean {
  const telefone = typeof pedido.telefone === "string" ? pedido.telefone.trim() : "";
  return (
    typeof pedido.id === "string" &&
    pedido.id.length > 0 &&
    pedido.origem === "whatsapp" &&
    telefone.length > 0 &&
    pedido.pix?.status === "confirmado" &&
    pedido.pix?.confirmadoPor === "conciliador_mercadopago"
  );
}

// Best-effort: qualquer falha (rede, HTTP, exceção) é isolada aqui e nunca
// propaga — a confirmação do Pix já foi persistida antes desta chamada e não
// pode ser revertida ou impedida por um problema de envio de WhatsApp.
async function notificarClienteWhatsAppSeElegivel(pedido: PedidoReconciliavel): Promise<void> {
  if (!elegivelParaNotificacaoWhatsApp(pedido)) return;
  const pedidoId = pedido.id as string;

  try {
    const marcadorKey = `${PIX_NOTIFICADO_PREFIXO}${pedidoId}`;
    const jaNotificado = await redis.get(marcadorKey);
    if (jaNotificado) return;

    const lockKey = `${PIX_NOTIFICACAO_LOCK_PREFIXO}${pedidoId}`;
    const lockAdquirido = await redis.set(lockKey, "1", { nx: true, ex: PIX_NOTIFICACAO_LOCK_TTL_SEGUNDOS });
    if (!lockAdquirido) return;

    try {
      const telefone = (pedido.telefone as string).trim();
      const resultado = await enviarTextoWhatsApp(telefone, MSG_PIX_CONFIRMADO_WHATSAPP);
      if (resultado.ok) {
        // Marcador permanente (sem TTL) — só gravado após sucesso confirmado
        // pela Evolution. Enquanto ausente, a próxima rodada tenta de novo.
        await redis.set(marcadorKey, "1");
      }
    } finally {
      // Libera o lock assim que o envio termina (sucesso ou falha) em vez de
      // depender só do TTL — a próxima rodada da reconciliação (ex.: a
      // auto-verificação de 20s) pode tentar de novo sem esperar.
      await redis.del(lockKey).catch(() => {});
    }
  } catch {
    // Falha isolada: não grava marcador, não relança. Próxima rodada tenta de novo.
  }
}

// Roda a cada rodada em que o lock principal foi adquirido, mesmo quando não
// há nenhum pedido pendente para reconciliar — é exatamente o caso em que um
// pedido já confirmado numa rodada anterior, mas cuja notificação falhou,
// precisa ser re-tentado (ele nunca mais aparece em `elegiveis`, então este é
// o único lugar que o pega de novo).
async function notificarConfirmadosWhatsApp(pedidos: PedidoReconciliavel[]): Promise<void> {
  const candidatos = pedidos.filter(elegivelParaNotificacaoWhatsApp);
  await Promise.all(candidatos.map((pedido) => notificarClienteWhatsAppSeElegivel(pedido)));
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

export type ReconciliarPixOpts = {
  // Restringe a rodada a pedidos específicos (usado pelo Guardião Pix para
  // recolocar um pagamento travado na fila sem esperar o próximo ciclo do
  // lote completo). Ausente/omitido = comportamento padrão (todos os
  // elegíveis), igual a antes desta mudança.
  apenasPedidoIds?: string[];
};

export async function reconciliarPixMercadoPago(opts?: ReconciliarPixOpts): Promise<ResumoReconciliacaoPix> {
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
    const idsFiltro = opts?.apenasPedidoIds?.length ? new Set(opts.apenasPedidoIds) : null;
    const elegiveis = selecionarPedidosPixMercadoPagoPendentes(pedidos).filter(
      (p) => !idsFiltro || idsFiltro.has(p.id as string)
    );

    const resumo: ResumoReconciliacaoPix = resumoVazio();
    if (elegiveis.length === 0) {
      // Nada para reconciliar agora, mas ainda pode haver notificação
      // pendente de uma rodada anterior (pedido já confirmado, envio falhou).
      await notificarConfirmadosWhatsApp(pedidos);
      return resumo;
    }

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
    const idsConfirmadosNestaRodada = new Set<string>();

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
        await registrarTentativaVerificacao(pedidoId, resultado.ok);

        if (!resultado.ok) {
          if (resultado.status === 429) {
            rateLimited = true;
            resumo.erros++;
            resumo.detalhes.push({ pedidoId, outcome: "erro", motivo: "rate_limited" });
            await incrementarContadorPix("rate_limited");
            continue;
          }
          resumo.erros++;
          resumo.detalhes.push({ pedidoId, outcome: "erro", motivo: resultado.motivo });
          if (resultado.motivo === "timeout") await incrementarContadorPix("timeout");
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
        idsConfirmadosNestaRodada.add(pedidoId);

        resumo.confirmados++;
        resumo.detalhes.push({ pedidoId, outcome: "confirmado" });
      }
    }

    if (rateLimited) {
      resumo.rateLimited = true;
      await redis.set(COOLDOWN_RATE_LIMIT_KEY, "1", { ex: COOLDOWN_RATE_LIMIT_TTL_SEGUNDOS });
    }

    // Persistência com merge por id (Guardião Pix — corrida webhook x
    // polling): em vez de sobrescrever "pedidos" com o snapshot lido no
    // início da rodada (que pode estar desatualizado se o webhook ou a
    // confirmação manual gravaram nesse meio-tempo), relê o estado mais
    // recente e aplica só o patch dos pedidos que ESTA rodada confirmou —
    // e, mesmo assim, nunca sobre um pedido que essa releitura já mostra
    // confirmado por outro caminho ("primeira confirmação vence").
    let resultadoFinal = atualizados;
    if (mudou) {
      const maisRecente = (await redis.get<PedidoReconciliavel[]>("pedidos")) || atualizados;
      const idsComDuplicidadeEvitada: string[] = [];
      resultadoFinal = maisRecente.map((p) => {
        const id = p.id as string;
        if (!idsConfirmadosNestaRodada.has(id)) return p;
        if (p.pixConfirmado === true || p.pix?.status === "confirmado") {
          idsComDuplicidadeEvitada.push(id);
          return p;
        }
        const patch = atualizados.find((a) => a.id === id);
        return patch || p;
      });
      await redis.set("pedidos", resultadoFinal);
      await Promise.all(idsComDuplicidadeEvitada.map(() => incrementarContadorPix("duplicidade_evitada")));
    }

    // Notificação Nível 6.6A — roda só APÓS persistir a confirmação, e nunca
    // pode afetar `resumo`/`atualizados`. Cobre tanto os pedidos recém
    // confirmados nesta rodada quanto retries de rodadas anteriores cuja
    // notificação tinha falhado.
    await notificarConfirmadosWhatsApp(resultadoFinal);

    return resumo;
  } finally {
    // Libera o lock só se ainda formos o dono (compare-and-delete atômico) —
    // sucesso, erro ou exceção, sempre tenta liberar para não segurar a
    // auto-verificação de 20s por mais tempo que o necessário. Se o EVAL
    // falhar, o TTL de 90s continua como rede de segurança.
    await liberarLockSeDono(lockId);
  }
}
