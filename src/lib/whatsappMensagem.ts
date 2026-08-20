import { deveSilenciarNovoAtendimentoWhatsapp } from "./assinaturaWhatsappGuard";
import { obterConfigEvolution } from "./evolutionApi";
import { maskMessageId } from "./sanitizeLog";

// Envio cru de texto pela Evolution API (sendText) — extraído do `enviarMensagem`
// do webhook (src/app/api/whatsapp/route.ts) para ser reaproveitado por
// consumidores fora do fluxo de conversa do bot (ex.: notificação pós-conciliação
// do Pix Mercado Pago, Nível 6.6A; canário de diagnóstico E2E).
//
// Timeout explícito (AbortController) e até 1 retry (2 tentativas no total)
// só para falha de rede ou HTTP 5xx — nunca para 4xx, que é erro do payload/
// credencial e repetir não muda o resultado. Jitter curto entre tentativas
// para não martelar a Evolution em rajada.
//
// Aviso de idempotência: retry protege contra falha de rede/timeout ANTES da
// Evolution processar o envio. Não há garantia total contra duplicidade no
// caso raro de a Evolution ter enviado a mensagem mas a resposta HTTP ter se
// perdido (timeout pós-envio) — a Evolution não expõe uma idempotency key
// para sendText. Aceito como risco residual, documentado aqui.
export type ResultadoEnvioWhatsApp = {
  ok: boolean;
  motivo?: string;
  statusHttp?: number;
  messageIdMascarado?: string;
  latenciaMs: number;
  tentativas: number;
};

const TIMEOUT_PADRAO_MS = 10_000;
const MAX_TENTATIVAS = 2;
const LINK_CARDAPIO_OFICIAL = "https://chefedapizza.com.br/cardapio";
const LINK_CARDAPIO_LEGADO = /https?:\/\/chefebot-pjif\.vercel\.app\/cardapio(?=$|[\s/?#])/gi;

export function normalizarLinksPublicosWhatsApp(text: string) {
  return text.replace(LINK_CARDAPIO_LEGADO, LINK_CARDAPIO_OFICIAL);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function enviarTextoWhatsApp(
  phone: string,
  text: string,
  opts?: { delay?: number; presence?: "composing"; timeoutMs?: number }
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

  let tentativas = 0;
  let ultimoResultado: Awaited<ReturnType<typeof tentarEnvio>> | null = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    tentativas = tentativa;
    ultimoResultado = await tentarEnvio(url, config.apiKey, body, timeoutMs);

    if (ultimoResultado.tipo === "http") {
      const { ok, status, data } = ultimoResultado;
      if (ok) {
        return {
          ok: true,
          statusHttp: status,
          messageIdMascarado: maskMessageId(extrairMessageId(data)),
          latenciaMs: Date.now() - inicio,
          tentativas,
        };
      }
      // 4xx nunca é retentado — erro de payload/credencial, repetir não ajuda.
      // status pode vir 0/undefined em mocks de teste incompletos — trata como
      // não retentável (mesma cautela que um 4xx) em vez de assumir 5xx.
      if (!(status >= 500) || tentativa === MAX_TENTATIVAS) {
        return { ok: false, motivo: `http_${status}`, statusHttp: status, latenciaMs: Date.now() - inicio, tentativas };
      }
    } else {
      // Falha de rede/timeout — só retenta se ainda houver tentativa disponível.
      if (tentativa === MAX_TENTATIVAS) {
        const timeoutOcorreu = ultimoResultado.erro instanceof Error && ultimoResultado.erro.name === "AbortError";
        return {
          ok: false,
          motivo: timeoutOcorreu ? "timeout" : "network_error",
          latenciaMs: Date.now() - inicio,
          tentativas,
        };
      }
    }

    // Jitter curto (100–300ms) antes da próxima tentativa.
    await sleep(100 + Math.floor(Math.random() * 200));
  }

  // Inalcançável na prática (o loop sempre retorna dentro de si), mas mantém
  // o compilador feliz e evita `undefined` implícito.
  return { ok: false, motivo: "erro_desconhecido", latenciaMs: Date.now() - inicio, tentativas };
}