import { Client } from "@upstash/qstash";
import { redis } from "./redis";
import {
  PIX_AUTO_CHECK_INITIAL_INTERVAL_MS,
  PIX_GUARDIAO_IDADE_MAXIMA_MS,
} from "./pixAutoCheckConfig";

// Guardião Pix server-side — agendamento atrasado via QStash (Nível 6.8).
// Anteriormente o Guardião só rodava quando o painel /pedidos estava aberto
// (chamado pelo timer do navegador). Este módulo inicia uma CADEIA de
// verificações agendadas assim que o Pix Mercado Pago é criado, independente
// de qualquer aba aberta — o painel continua chamando o mesmo endpoint
// admin como REDUNDÂNCIA, nunca como único caminho.
//
// Cada "tick" da cadeia é uma mensagem QStash com delay (10s/20s/30s
// conforme a idade do pagamento, mesma tabela de `pixAutoCheckConfig.ts`)
// entregue em `/api/interno/pix-guardiao/verificar`, que reconcilia esse
// pedido específico e, se ainda pendente, agenda o próximo tick — até
// confirmar, cancelar, expirar (idade máxima) ou esgotar tentativas.
//
// Sem QSTASH_TOKEN configurado: agenda vira no-op seguro (loga uma vez) e o
// sistema cai de volta ao comportamento anterior (webhook + polling do
// painel) — nunca lança exceção nem impede a criação do Pix.

const QSTASH_CHAIN_LOCK_PREFIXO = "pix:guardiao:cadeia:lock:";
// Chave de dedupe do QSTASH: se `agendarProximaVerificacaoPixGuardiao` for
// chamada duas vezes para o mesmo pedidoId+tentativa (ex.: retry de rede no
// nosso lado), o QStash aceita a segunda mas não enfileira de novo.
const QSTASH_MAX_TENTATIVAS_CADEIA = 400; // rede de segurança adicional além da idade máxima

let avisoSemTokenEmitido = false;

function resolveBaseUrl(): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chefebot-pjif.vercel.app";
}

function endpointVerificacaoUrl(): string {
  const override = process.env.PIX_GUARDIAO_QSTASH_CALLBACK_URL?.trim();
  if (override) return override;
  return `${resolveBaseUrl()}/api/interno/pix-guardiao/verificar`;
}

let clienteQstash: Client | null | undefined;

function obterClienteQstash(): Client | null {
  if (clienteQstash !== undefined) return clienteQstash;

  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    if (!avisoSemTokenEmitido) {
      avisoSemTokenEmitido = true;
      console.warn("[Guardiao Pix] QSTASH_TOKEN ausente — cadeia server-side desativada, usando apenas polling do painel/webhook.");
    }
    clienteQstash = null;
    return clienteQstash;
  }

  clienteQstash = new Client({ token });
  return clienteQstash;
}

export type AgendarTickInput = {
  pedidoId: string;
  tentativa: number;
  delayMs: number;
};

// Publica um único tick futuro. Nunca lança — falha de agendamento não pode
// derrubar a criação do Pix nem a reconciliação em andamento; o polling do
// painel continua como rede de segurança se a cadeia parar de avançar.
export async function agendarProximaVerificacaoPixGuardiao(input: AgendarTickInput): Promise<boolean> {
  const client = obterClienteQstash();
  if (!client) return false;
  if (input.tentativa > QSTASH_MAX_TENTATIVAS_CADEIA) return false;

  const delaySegundos = Math.max(1, Math.round(input.delayMs / 1000));
  try {
    await client.publishJSON({
      url: endpointVerificacaoUrl(),
      body: { pedidoId: input.pedidoId, tentativa: input.tentativa },
      delay: delaySegundos,
      deduplicationId: `pix-guardiao:${input.pedidoId}:${input.tentativa}`,
      retries: 3,
    });
    return true;
  } catch (error) {
    console.error("[Guardiao Pix] Falha ao agendar tick via QStash", {
      pedidoId: input.pedidoId,
      tentativa: input.tentativa,
      motivo: error instanceof Error ? error.message : "erro_desconhecido",
    });
    return false;
  }
}

// Chamada exatamente uma vez, logo após o Mercado Pago aceitar a cobrança
// Pix (prepararPixProviderMercadoPago). Lock NX no Redis evita iniciar duas
// cadeias para o mesmo pedido caso a criação seja repetida por qualquer
// motivo — a segunda chamada é um no-op silencioso.
export async function iniciarCadeiaGuardiaoPix(pedidoId: string): Promise<void> {
  if (!pedidoId) return;
  const client = obterClienteQstash();
  if (!client) return;

  try {
    const ttlSegundos = Math.ceil(PIX_GUARDIAO_IDADE_MAXIMA_MS / 1000) + 60;
    const lockAdquirido = await redis.set(`${QSTASH_CHAIN_LOCK_PREFIXO}${pedidoId}`, "1", {
      nx: true,
      ex: ttlSegundos,
    });
    if (!lockAdquirido) return;

    await agendarProximaVerificacaoPixGuardiao({
      pedidoId,
      tentativa: 1,
      delayMs: PIX_AUTO_CHECK_INITIAL_INTERVAL_MS,
    });
  } catch (error) {
    console.error("[Guardiao Pix] Falha ao iniciar cadeia server-side", {
      pedidoId,
      motivo: error instanceof Error ? error.message : "erro_desconhecido",
    });
  }
}
