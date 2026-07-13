import { obterConfigEvolution } from "./evolutionApi";

// Envio cru de texto pela Evolution API (sendText) — extraído do `enviarMensagem`
// do webhook (src/app/api/whatsapp/route.ts) para ser reaproveitado por
// consumidores fora do fluxo de conversa do bot (ex.: notificação pós-conciliação
// do Pix Mercado Pago, Nível 6.6A). Não injeta token de cardápio nem calcula
// delay "digitando" — isso continua responsabilidade de quem monta a mensagem.
// Erros de rede (fetch lançando) propagam para quem chamou, igual ao
// comportamento original do webhook; erros HTTP (resposta não-ok) viram
// { ok: false } sem lançar, também igual ao original (que nunca checava
// res.ok).
export type ResultadoEnvioWhatsApp = { ok: true } | { ok: false; motivo: string };

export async function enviarTextoWhatsApp(
  phone: string,
  text: string,
  opts?: { delay?: number; presence?: "composing" }
): Promise<ResultadoEnvioWhatsApp> {
  const config = obterConfigEvolution();
  if (!config) return { ok: false, motivo: "provider_not_configured" };

  const url = `${config.baseUrl}/message/sendText/${config.instanceName}`;
  const body: Record<string, unknown> = { number: phone, text };
  if (opts?.delay !== undefined) {
    body.delay = opts.delay;
    body.options = { delay: opts.delay, presence: opts.presence ?? "composing" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, motivo: `http_${res.status}` };
  return { ok: true };
}
