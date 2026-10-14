import { deveSilenciarNovoAtendimentoWhatsapp } from "./assinaturaWhatsappGuard";
import { obterConfigEvolution } from "./evolutionApi";
import { maskMessageId } from "./sanitizeLog";
import { marcarTentativaEnvio } from "./whatsappDiag";
import {
  agendarDrenoWhatsapp,
  enfileirarImagemWhatsapp,
  enfileirarMensagemWhatsapp,
  obterJobWhatsapp,
  processarFilaWhatsapp,
  type PrioridadeWhatsapp,
} from "./whatsappOutbox";

// Envio cru de texto pela Evolution API (sendText) — extraído do `enviarMensagem`
// do webhook (src/app/api/whatsapp/route.ts) para ser reaproveitado por
// consumidores fora do fluxo de conversa do bot (ex.: notificação pós-conciliação
// do Pix Mercado Pago, Nível 6.6A; canário de diagnóstico E2E).
//
// Timeout explícito (AbortController) e uma única tentativa por job. A
// Evolution não fornece idempotency key: rede, timeout e 5xx podem ocorrer
// depois de o provider aceitar o envio, portanto são encaminhados para
// reconciliação, nunca repetidos automaticamente.
export type ResultadoEnvioWhatsApp = {
  ok: boolean;
  motivo?: string;
  statusHttp?: number;
  messageIdMascarado?: string;
  /** Uso interno server-side para deduplicar o eco fromMe; nunca registrar em log/resposta pública. */
  messageIdInterno?: string;
  latenciaMs: number;
  tentativas: number;
  /** Identificador da outbox para consulta/reconciliação; nunca é da Evolution. */
  jobId?: string;
};

const TIMEOUT_PADRAO_MS = 10_000;
type OpcoesEnvio = {
  delay?: number; presence?: "composing"; timeoutMs?: number; maxAttempts?: 1;
  /** Evento estável de negócio; evita criar duas tarefas para o mesmo efeito. */
  idempotencyKey?: string;
  prioridade?: PrioridadeWhatsapp;
  /** Só usado pelo painel: o histórico é confirmado pelo worker depois do provider. */
  humanSenderName?: string;
};
const LINK_CARDAPIO_OFICIAL = "https://chefedapizza.com.br/cardapio";
const LINK_CARDAPIO_LEGADO = /https?:\/\/chefebot-pjif\.vercel\.app\/cardapio(?=$|[\s/?#])/gi;

export function normalizarLinksPublicosWhatsApp(text: string) {
  return text.replace(LINK_CARDAPIO_LEGADO, LINK_CARDAPIO_OFICIAL);
}

function extrairMessageId(data: unknown): string | undefined {
  const d = data as Record<string, unknown> | null | undefined;
  if (!d) return undefined;
  const key = d.key as Record<string, unknown> | undefined;
  if (key && typeof key.id === "string") return key.id;
  if (typeof d.id === "string") return d.id;
  return undefined;
}

async function tentarEnvio(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ tipo: "http"; ok: boolean; status: number; data: unknown } | { tipo: "network"; erro: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => undefined);
    return { tipo: "http", ok: res.ok, status: res.status, data };
  } catch (erro) {
    return { tipo: "network", erro };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Choke point real de saída para a Evolution. Envolve `executarEnvioTexto`
 * apenas para registrar telemetria do resultado — sem alterar payload,
 * retries, timeout ou o valor devolvido.
 *
 * Existe porque `outboundLastSuccessAt` só é gravado dentro de
 * `enviarMensagem` (fluxo de conversa do bot) e portanto NÃO cobre a
 * notificação de status de pedido, que chama esta função direto. Sem isso não
 * há como distinguir "notificação nem foi tentada" de "foi tentada e a
 * Evolution recusou".
 */
export async function enviarTextoWhatsApp(
  phone: string,
  text: string,
  opts?: OpcoesEnvio
): Promise<ResultadoEnvioWhatsApp> {
  // A aceitação durável ocorre ANTES de qualquer contato com a Evolution.
  // O chamador continua recebendo ok:true apenas depois de confirmação do
  // provider; queued_pending é erro explícito e o job permanece recuperável.
  let resultado: ResultadoEnvioWhatsApp;
  try {
    const enfileirado = await enfileirarMensagemWhatsapp({
      phone, text, opts, priority: opts?.prioridade ?? "critica", idempotencyKey: opts?.idempotencyKey,
      humanSenderName: opts?.humanSenderName,
    });
    void agendarDrenoWhatsapp();
    await processarFilaWhatsapp(executarJobWhatsapp, 1);
    const job = await obterJobWhatsapp(enfileirado.jobId);
    resultado = !job && process.env.NODE_ENV === "test"
      ? await executarEnvioTexto(phone, text, opts)
      : resultadoDoJob(job);
    resultado.jobId = enfileirado.jobId;
  } catch (erro) {
    // Mocks legados de rotas não conheciam a API de scripts da outbox. O
    // desvio é exclusivamente de teste; em runtime real a indisponibilidade
    // do Redis deve propagar para que ninguém alegue aceitação sem escrita
    // durável.
    if (process.env.NODE_ENV !== "test") throw erro;
    resultado = await executarEnvioTexto(phone, text, opts);
  }
  marcarTentativaEnvio({
    ok: resultado.ok,
    motivo: resultado.motivo,
    statusHttp: resultado.statusHttp,
  }).catch(() => {});
  return resultado;
}

function resultadoDoJob(job: Awaited<ReturnType<typeof obterJobWhatsapp>>): ResultadoEnvioWhatsApp {
  if (!job) return { ok: false, motivo: "outbox_job_not_found", latenciaMs: 0, tentativas: 0 };
  const result = (job as typeof job & { result?: ResultadoEnvioWhatsApp }).result;
  if (job.state === "delivered" && result) return result;
  if ((job.state === "failed" || job.state === "ambiguous") && result) return result;
  return { ok: false, motivo: "queued_pending", latenciaMs: Date.now() - job.createdAt, tentativas: job.attempt };
}

export async function executarEnvioTexto(
  phone: string,
  text: string,
  opts?: OpcoesEnvio
): Promise<ResultadoEnvioWhatsApp> {
  const inicio = Date.now();

  // Somente mensagens automáticas do bot (identificadas pelo `delay`) passam
  // pelo gate de assinatura. Mensagens administrativas/operacionais sem
  // delay continuam disponíveis, e o guard preserva conversas e pedidos já
  // em andamento para nunca abandonar cliente no meio do fluxo.
  if (opts?.delay !== undefined && await deveSilenciarNovoAtendimentoWhatsapp(phone)) {
    return {
      ok: true,
      motivo: "subscription_silenced_new_contact",
      latenciaMs: Date.now() - inicio,
      tentativas: 0,
    };
  }

  const config = obterConfigEvolution();
  if (!config) {
    return { ok: false, motivo: "provider_not_configured", latenciaMs: Date.now() - inicio, tentativas: 0 };
  }

  const url = `${config.baseUrl}/message/sendText/${config.instanceName}`;
  const body: Record<string, unknown> = { number: phone, text: normalizarLinksPublicosWhatsApp(text) };
  if (opts?.delay !== undefined) {
    body.delay = opts.delay;
    body.options = { delay: opts.delay, presence: opts.presence ?? "composing" };
  }
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_PADRAO_MS;
  // A Evolution não oferece chave de idempotência. Logo timeout, rede e 5xx
  // são resultados incertos: repetir pode duplicar a mensagem. Cada job faz
  // exatamente uma chamada; a outbox conserva o estado para reconciliação.
  const maxTentativas = 1;

  let tentativas = 0;
  let ultimoResultado: Awaited<ReturnType<typeof tentarEnvio>> | null = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    tentativas = tentativa;
    ultimoResultado = await tentarEnvio(url, config.apiKey, body, timeoutMs);

    if (ultimoResultado.tipo === "http") {
      const { ok, status, data } = ultimoResultado;
      if (ok) {
        const messageId = extrairMessageId(data);
        return {
          ok: true,
          statusHttp: status,
          messageIdMascarado: maskMessageId(messageId),
          messageIdInterno: messageId,
          latenciaMs: Date.now() - inicio,
          tentativas,
        };
      }
      // 4xx, 5xx e respostas incompletas não são retentados. Em especial, um
      // 5xx pode ter sido devolvido depois de a Evolution aceitar o envio.
      if (!(status >= 500) || tentativa === maxTentativas) {
        return { ok: false, motivo: `http_${status}`, statusHttp: status, latenciaMs: Date.now() - inicio, tentativas };
      }
    } else {
      // Falha de rede/timeout é ambígua e também não recebe retry automático.
      if (tentativa === maxTentativas) {
        const timeoutOcorreu = ultimoResultado.erro instanceof Error && ultimoResultado.erro.name === "AbortError";
        return {
          ok: false,
          motivo: timeoutOcorreu ? "timeout" : "network_error",
          latenciaMs: Date.now() - inicio,
          tentativas,
        };
      }
    }

  }

  // Inalcançável na prática (o loop sempre retorna dentro de si), mas mantém
  // o compilador feliz e evita `undefined` implícito.
  return { ok: false, motivo: "erro_desconhecido", latenciaMs: Date.now() - inicio, tentativas };
}

async function executarEnvioImagem(phone: string, mediaUrl: string, caption: string): Promise<ResultadoEnvioWhatsApp> {
  const inicio = Date.now();
  const config = obterConfigEvolution();
  if (!config) return { ok: false, motivo: "provider_not_configured", latenciaMs: Date.now() - inicio, tentativas: 0 };
  const resposta = await tentarEnvio(`${config.baseUrl}/message/sendMedia/${config.instanceName}`, config.apiKey,
    { number: phone, mediatype: "image", media: mediaUrl, caption }, TIMEOUT_PADRAO_MS);
  if (resposta.tipo === "network") {
    const timeout = resposta.erro instanceof Error && resposta.erro.name === "AbortError";
    return { ok: false, motivo: timeout ? "timeout" : "network_error", latenciaMs: Date.now() - inicio, tentativas: 1 };
  }
  if (!resposta.ok) return { ok: false, motivo: `http_${resposta.status}`, statusHttp: resposta.status, latenciaMs: Date.now() - inicio, tentativas: 1 };
  const messageId = extrairMessageId(resposta.data);
  return { ok: true, statusHttp: resposta.status, messageIdMascarado: maskMessageId(messageId), messageIdInterno: messageId, latenciaMs: Date.now() - inicio, tentativas: 1 };
}

export async function executarJobWhatsapp(job: import("./whatsappOutbox").JobOutboxWhatsapp): Promise<ResultadoEnvioWhatsApp> {
  return job.kind === "image"
    ? executarEnvioImagem(job.phone, job.mediaUrl ?? "", job.mediaCaption ?? "")
    : executarEnvioTexto(job.phone, job.text, job.opts);
}

export async function enviarImagemWhatsApp(phone: string, mediaUrl: string, caption = ""): Promise<ResultadoEnvioWhatsApp> {
  try {
    const enfileirado = await enfileirarImagemWhatsapp({ phone, mediaUrl, caption, priority: "critica" });
    void agendarDrenoWhatsapp();
    await processarFilaWhatsapp(executarJobWhatsapp, 1);
    return resultadoDoJob(await obterJobWhatsapp(enfileirado.jobId));
  } catch (erro) {
    if (process.env.NODE_ENV !== "test") throw erro;
    return executarEnvioImagem(phone, mediaUrl, caption);
  }
}
