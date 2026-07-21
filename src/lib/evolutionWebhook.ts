import type { EvolutionConfig } from "./evolutionApi";

// Configuração idempotente do webhook da instância — nunca destrutiva
// (não afeta sessão/credenciais, só a config de callback). Reaproveitado
// tanto pelo reset explícito quanto pela geração rotineira de QR, para que
// uma instância cujo webhook ficou divergente (URL antiga, eventos
// faltando) se autocorrija sem precisar de reset manual.
const EVENTOS_WEBHOOK = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
  "SEND_MESSAGE",
  "CALL",
];

export type ResultadoGarantirWebhook = { ok: boolean; status?: number };

export async function garantirWebhookEvolution(config: EvolutionConfig): Promise<ResultadoGarantirWebhook> {
  const res = await fetch(`${config.baseUrl}/webhook/set/${config.instanceName}`, {
    method: "POST",
    headers: { apikey: config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: config.webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: EVENTOS_WEBHOOK,
      },
    }),
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status };
}
