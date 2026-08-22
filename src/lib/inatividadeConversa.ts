import { Client } from "@upstash/qstash";
import { redis } from "./redis";
import type { AutorMensagem, BotSession, BotStep } from "./bot";

// Cronômetro de inatividade da conversa do WhatsApp — depois de
// CANCELAMENTO_INATIVIDADE_DELAY_MS sem resposta do cliente DEPOIS da nossa
// última mensagem (bot OU atendente humano, por qualquer canal — app direto
// ou painel), o cliente recebe um lembrete gentil. O lembrete não cancela pedido,
// não apaga a sessão e não encerra atendimento. Ver
// /api/interno/cancelamento-inatividade para o lado que recebe o tick.
//
// Arquitetura espelha o Guardião Pix (pixGuardiaoScheduler.ts): nunca tenta
// cancelar um tick já publicado no QStash. Cada tick carrega o número da
// "geração" da conversa no momento em que foi agendado; se QUALQUER
// mensagem nova chegar antes do tick disparar, a geração avança e o tick
// antigo vira no-op quando finalmente chega (comparado no endpoint) — sem
// precisar rastrear/cancelar messageId nenhum.

export const CANCELAMENTO_INATIVIDADE_DELAY_MS = 20 * 60 * 1000; // 20 minutos

// Etapas em que o cronômetro NUNCA se aplica: pedido já concluído (sessão
// vira "done", nada pra cancelar) e aguardando comprovante de Pix (tem
// cronômetro próprio — o Guardião Pix — para não competir com ele). Todo o
// resto conta, inclusive "escalado"/conversa em atendimento humano: o
// silêncio do cliente é o mesmo problema não importa quem estava
// respondendo por último.
export const STEPS_SEM_CRONOMETRO_INATIVIDADE = new Set<BotStep>(["done", "aguardando_pix"]);

function chaveGeracao(phone: string): string {
  return `inatividade:geracao:${phone}`;
}

// Alinhado com o TTL da sessão (session:{phone}) — sem sentido o contador de
// geração sobreviver mais tempo que a própria conversa que ele rastreia.
const GERACAO_TTL_SEGUNDOS = 1800;

export async function geracaoAtualCronometroInatividade(phone: string): Promise<number> {
  try {
    const valor = await redis.get<number>(chaveGeracao(phone));
    return valor ?? 0;
  } catch {
    return 0;
  }
}

let avisoSemTokenEmitido = false;
let clienteQstash: Client | null | undefined;

function obterClienteQstash(): Client | null {
  if (clienteQstash !== undefined) return clienteQstash;

  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    if (!avisoSemTokenEmitido) {
      avisoSemTokenEmitido = true;
      console.warn("[Cronometro Inatividade] QSTASH_TOKEN ausente — cancelamento automático por inatividade desativado.");
    }
    clienteQstash = null;
    return clienteQstash;
  }

  clienteQstash = new Client({ token });
  return clienteQstash;
}

function resolveBaseUrl(): string {
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://chefebot-pjif.vercel.app";
}

function endpointCancelamentoUrl(): string {
  const override = process.env.CANCELAMENTO_INATIVIDADE_QSTASH_CALLBACK_URL?.trim();
  if (override) return override;
  return `${resolveBaseUrl()}/api/interno/cancelamento-inatividade`;
}

// QStash rejeita ":" em deduplicationId (mesmo motivo documentado em
// pixGuardiaoScheduler.ts) — telefone nunca deveria conter isso, mas
// sanitiza por segurança de qualquer forma.
function sanitizarParaDeduplicationId(valor: string): string {
  return valor.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
}

/**
 * Chamada por registrarMensagem() (src/lib/conversa.ts) toda vez que
 * QUALQUER mensagem é registrada, de qualquer autor — é o único ponto de
 * entrada, então nenhum caminho de envio/recebimento precisa lembrar de
 * sincronizar isso manualmente. Nunca lança.
 */
export async function sincronizarCronometroInatividade(phone: string, autor: AutorMensagem): Promise<void> {
  if (!phone) return;
  try {
    // Toda mensagem (de qualquer autor) invalida um tick pendente, avançando
    // a geração. Só uma mensagem NOSSA (bot/atendente) agenda um tick novo —
    // enquanto o cliente for o último a falar, o cronômetro fica parado.
    const geracao = await redis.incr(chaveGeracao(phone));
    await redis.expire(chaveGeracao(phone), GERACAO_TTL_SEGUNDOS);

    if (autor === "cliente") return;

    const session = await redis.get<BotSession>(`session:${phone}`);
    if (!session || STEPS_SEM_CRONOMETRO_INATIVIDADE.has(session.step)) return;

    const client = obterClienteQstash();
    if (!client) return;

    const delaySegundos = Math.max(1, Math.round(CANCELAMENTO_INATIVIDADE_DELAY_MS / 1000));
    await client.publishJSON({
      url: endpointCancelamentoUrl(),
      body: { phone, geracao },
      delay: delaySegundos,
      deduplicationId: `cancelamento-inatividade-${sanitizarParaDeduplicationId(phone)}-g${geracao}`,
      retries: 2,
    });
  } catch (error) {
    console.error("[Cronometro Inatividade] Falha ao sincronizar", {
      motivo: error instanceof Error ? error.message : "erro_desconhecido",
    });
  }
}
