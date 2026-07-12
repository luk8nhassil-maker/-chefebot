import {
  extrairQrBase64,
  ehErroPlataformaIndisponivel,
  mensagemErroEvolution,
  type EvolutionConfig,
  type EstadoProviderWhatsapp,
} from "@/lib/evolutionApi";

const CONNECT_MAX_TENTATIVAS = 10;
const CONNECT_INTERVALO_MS = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResultadoAcao =
  | { ok: true; estado: EstadoProviderWhatsapp; qrcode?: { base64: string; code: string | null; pairingCode: string | null } }
  | { ok: false; estado: EstadoProviderWhatsapp; error: string; step: string };

/**
 * Só lê o estado atual — GET /instance/connectionState/{instance}. Nunca
 * altera nada na Evolution API. Usado por /verify e pelo cron de saúde.
 */
export async function verificarInstancia(config: EvolutionConfig): Promise<ResultadoAcao> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/instance/connectionState/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
  } catch {
    return { ok: false, estado: "provider_down", error: "Não foi possível conectar à Evolution API.", step: "verify" };
  }
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 || res.status === 403) {
    return { ok: false, estado: "provider_unauthorized", error: mensagemErroEvolution(res.status, data), step: "verify" };
  }
  if (ehErroPlataformaIndisponivel(res.status, data)) {
    return { ok: false, estado: "provider_down", error: mensagemErroEvolution(res.status, data), step: "verify" };
  }
  if (res.status === 404) {
    return { ok: false, estado: "instance_missing", error: mensagemErroEvolution(res.status, data), step: "verify" };
  }
  if (!res.ok) {
    return { ok: false, estado: "unknown", error: mensagemErroEvolution(res.status, data), step: "verify" };
  }

  const state = (data as { instance?: { state?: string } })?.instance?.state;
  if (state === "open") return { ok: true, estado: "connected" };
  if (state === "connecting") return { ok: true, estado: "connecting" };
  if (state === "close" || state === "closed") return { ok: true, estado: "instance_disconnected" };
  return { ok: true, estado: "unknown" };
}

/**
 * Tenta obter o QR chamando /instance/connect/{instance}, com retry
 * limitado: a instância recém-criada pode levar um instante para ficar
 * pronta para gerar QR. Para no primeiro QR encontrado; nunca tenta de novo
 * em 401/403 (erro de credencial); tenta de novo em 404/409 transitório ou
 * resposta sem QR ainda.
 */
async function conectarComRetry(config: EvolutionConfig, logPrefix: string): Promise<ResultadoAcao> {
  let ultimoStatus = 0;
  let ultimoData: unknown = {};

  for (let tentativa = 1; tentativa <= CONNECT_MAX_TENTATIVAS; tentativa++) {
    const connRes = await fetch(`${config.baseUrl}/instance/connect/${config.instanceName}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const qrData = await connRes.json().catch(() => ({}));
    const base64 = extrairQrBase64(qrData);
    console.log(
      logPrefix,
      "connect tentativa",
      tentativa,
      "status:",
      connRes.status,
      "has base64:",
      !!base64,
      "keys:",
      Object.keys(qrData || {}).join(",")
    );

    if (base64) {
      return {
        ok: true,
        estado: "qr_required",
        qrcode: {
          base64,
          code: (qrData as Record<string, unknown>)?.code as string | undefined ?? null,
          pairingCode: (qrData as Record<string, unknown>)?.pairingCode as string | undefined ?? null,
        },
      };
    }

    ultimoStatus = connRes.status;
    ultimoData = qrData;

    if (connRes.status === 401 || connRes.status === 403) break;
    if (tentativa < CONNECT_MAX_TENTATIVAS) await sleep(CONNECT_INTERVALO_MS);
  }

  if (ultimoStatus === 401 || ultimoStatus === 403) {
    return { ok: false, estado: "provider_unauthorized", error: mensagemErroEvolution(ultimoStatus, ultimoData), step: "connect" };
  }
  if (ehErroPlataformaIndisponivel(ultimoStatus, ultimoData)) {
    return { ok: false, estado: "provider_down", error: mensagemErroEvolution(ultimoStatus, ultimoData), step: "connect" };
  }
  return { ok: false, estado: "unknown", error: mensagemErroEvolution(ultimoStatus, ultimoData), step: "connect" };
}

async function configurarWebhook(config: EvolutionConfig, logPrefix: string): Promise<void> {
  if (!config.webhookUrl) {
    console.log(logPrefix, "webhook: EVOLUTION_WEBHOOK_URL não configurada, pulando");
    return;
  }
  const webhookRes = await fetch(`${config.baseUrl}/webhook/set/${config.instanceName}`, {
    method: "POST",
    headers: { apikey: config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: config.webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE", "CALL"],
      },
    }),
    cache: "no-store",
  }).catch(() => null);
  console.log(logPrefix, "webhook:", webhookRes?.status ?? "network-error");
}

/**
 * Ação padrão do painel (Fase 4 #2): NUNCA faz logout/delete. Se a instância
 * já existe (conectada, conectando ou desconectada), só chama connect. Se
 * não existe, cria, configura o webhook, e então conecta com retry.
 */
export async function reconectarOuCriar(config: EvolutionConfig): Promise<ResultadoAcao> {
  const verificacao = await verificarInstancia(config);

  if (verificacao.ok && verificacao.estado === "connected") {
    return { ok: true, estado: "connected" };
  }

  if (!verificacao.ok && verificacao.estado !== "instance_missing") {
    // provider_down / provider_unauthorized / unknown — não adianta tentar criar/conectar.
    return verificacao;
  }

  if (!verificacao.ok && verificacao.estado === "instance_missing") {
    // Cria a instância (primeira vez, ou depois de uma reconstrução anterior).
    const createRes = await fetch(`${config.baseUrl}/instance/create`, {
      method: "POST",
      headers: { apikey: config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ instanceName: config.instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
      cache: "no-store",
    });
    const createData = await createRes.json().catch(() => ({}));
    console.log("[CONNECT] create:", createRes.status, JSON.stringify(createData).slice(0, 200));

    const base64DoCreate = createRes.ok ? extrairQrBase64(createData) : null;

    if (!createRes.ok) {
      const jaExiste = (createRes.status === 403 || createRes.status === 409) && !ehErroPlataformaIndisponivel(createRes.status, createData);
      if (!jaExiste) {
        if (createRes.status === 401 || createRes.status === 403) {
          return { ok: false, estado: "provider_unauthorized", error: mensagemErroEvolution(createRes.status, createData), step: "create" };
        }
        if (ehErroPlataformaIndisponivel(createRes.status, createData)) {
          return { ok: false, estado: "provider_down", error: mensagemErroEvolution(createRes.status, createData), step: "create" };
        }
        return { ok: false, estado: "unknown", error: mensagemErroEvolution(createRes.status, createData), step: "create" };
      }
      console.log("[CONNECT] create: instância já existe, seguindo para conectar na existente");
    }

    await configurarWebhook(config, "[CONNECT]");

    if (base64DoCreate) {
      return {
        ok: true,
        estado: "qr_required",
        qrcode: { base64: base64DoCreate, code: (createData as Record<string, unknown>)?.code as string | undefined ?? null, pairingCode: null },
      };
    }
  }

  // Instância existe mas não está conectada (ou acabou de ser criada sem QR
  // já vindo no create) — conecta com retry, sem nunca passar por delete.
  return conectarComRetry(config, "[CONNECT]");
}

/**
 * Ação de emergência (Fase 4 #3): logout + delete + create + webhook +
 * connect. Só deve ser chamada depois de autenticação, confirmação textual
 * exata e rate limit já verificados na rota — esta função não valida nada
 * disso, só executa a sequência destrutiva.
 */
export async function reconstruirInstancia(config: EvolutionConfig): Promise<ResultadoAcao> {
  const logoutRes = await fetch(`${config.baseUrl}/instance/logout/${config.instanceName}`, {
    method: "DELETE",
    headers: { apikey: config.apiKey },
    cache: "no-store",
  }).catch(() => null);
  console.log("[REBUILD] logout:", logoutRes?.status ?? "network-error");

  const deleteRes = await fetch(`${config.baseUrl}/instance/delete/${config.instanceName}`, {
    method: "DELETE",
    headers: { apikey: config.apiKey },
    cache: "no-store",
  }).catch(() => null);
  const deleteData = await deleteRes?.json().catch(() => ({}));
  console.log("[REBUILD] delete:", deleteRes?.status ?? "network-error", JSON.stringify(deleteData ?? {}).slice(0, 200));

  if (deleteRes && (deleteRes.status === 401 || deleteRes.status === 403)) {
    return { ok: false, estado: "provider_unauthorized", error: mensagemErroEvolution(deleteRes.status, deleteData), step: "delete" };
  }
  if (deleteRes && ehErroPlataformaIndisponivel(deleteRes.status, deleteData)) {
    return { ok: false, estado: "provider_down", error: mensagemErroEvolution(deleteRes.status, deleteData), step: "delete" };
  }

  const createRes = await fetch(`${config.baseUrl}/instance/create`, {
    method: "POST",
    headers: { apikey: config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ instanceName: config.instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
    cache: "no-store",
  });
  const createData = await createRes.json().catch(() => ({}));
  console.log("[REBUILD] create:", createRes.status, JSON.stringify(createData).slice(0, 200));

  const base64DoCreate = createRes.ok ? extrairQrBase64(createData) : null;

  if (!createRes.ok) {
    const jaExiste = (createRes.status === 403 || createRes.status === 409) && !ehErroPlataformaIndisponivel(createRes.status, createData);
    if (!jaExiste) {
      if (createRes.status === 401 || createRes.status === 403) {
        return { ok: false, estado: "provider_unauthorized", error: mensagemErroEvolution(createRes.status, createData), step: "create" };
      }
      if (ehErroPlataformaIndisponivel(createRes.status, createData)) {
        return { ok: false, estado: "provider_down", error: mensagemErroEvolution(createRes.status, createData), step: "create" };
      }
      return { ok: false, estado: "unknown", error: mensagemErroEvolution(createRes.status, createData), step: "create" };
    }
  }

  await configurarWebhook(config, "[REBUILD]");

  if (base64DoCreate) {
    return {
      ok: true,
      estado: "qr_required",
      qrcode: { base64: base64DoCreate, code: (createData as Record<string, unknown>)?.code as string | undefined ?? null, pairingCode: null },
    };
  }

  return conectarComRetry(config, "[REBUILD]");
}
