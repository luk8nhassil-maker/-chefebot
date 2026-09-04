import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";
import { extrairQrBase64, obterConfigEvolution, type EvolutionConfig } from "@/lib/evolutionApi";
import { garantirWebhookEvolution } from "@/lib/evolutionWebhook";
import { redis } from "@/lib/redis";
import { limparQrAtual, persistirQrAtual } from "@/lib/whatsappQrCache";

export const maxDuration = 30;

type EstadoProvider = {
  ok: boolean;
  status: number;
  state: string | null;
};

type SettingsPreservaveis = {
  rejectCall?: boolean;
  msgCall?: string;
  groupsIgnore?: boolean;
  alwaysOnline?: boolean;
  readMessages?: boolean;
  readStatus?: boolean;
  syncFullHistory?: boolean;
};

type RecoveryPhase = "captured" | "deleted" | "created";

type RecoveryRecord = {
  version: 1;
  instanceName: string;
  integration: "WHATSAPP-BAILEYS";
  settings: SettingsPreservaveis;
  phase: RecoveryPhase;
  capturedAt: string;
};

type InstanceInfo = Record<string, unknown>;

type QrcodeAtual = { base64: string; generatedAt: number; expiresAt: number; generationId: number };

type ResultadoRecuperacao =
  | { ok: true; qrcode: QrcodeAtual; via: "recreated" | "qr_sem_remocao" | "qr_apos_restart" }
  | { ok: false; estado: string; error: string };

const RECOVERY_TTL_SECONDS = 30 * 60;
const LOCK_TTL_SECONDS = 35;

async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200 };
}

function recoveryKey(instanceName: string): string {
  return `whatsapp:trocar-numero:recovery:${instanceName}`;
}

function lockKey(instanceName: string): string {
  return `whatsapp:trocar-numero:lock:${instanceName}`;
}

async function adquirirLock(instanceName: string): Promise<string | null> {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try {
    const ok = await redis.set(lockKey(instanceName), token, { nx: true, ex: LOCK_TTL_SECONDS });
    return ok ? token : null;
  } catch {
    return null;
  }
}

async function liberarLock(instanceName: string, token: string): Promise<void> {
  try {
    const atual = await redis.get<string>(lockKey(instanceName));
    if (atual === token) await redis.del(lockKey(instanceName));
  } catch {
    // TTL curto garante liberação mesmo se o Redis falhar no finally.
  }
}

async function salvarRecovery(record: RecoveryRecord): Promise<boolean> {
  try {
    await redis.set(recoveryKey(record.instanceName), record, { ex: RECOVERY_TTL_SECONDS });
    return true;
  } catch {
    return false;
  }
}

async function lerRecovery(instanceName: string): Promise<RecoveryRecord | null> {
  try {
    const record = await redis.get<RecoveryRecord>(recoveryKey(instanceName));
    if (!record || record.version !== 1 || record.instanceName !== instanceName) return null;
    return record;
  } catch {
    return null;
  }
}

async function limparRecovery(instanceName: string): Promise<void> {
  try {
    await redis.del(recoveryKey(instanceName));
  } catch {
    // Best-effort. O TTL encerra o estado sozinho.
  }
}

async function lerEstado(config: EvolutionConfig): Promise<EstadoProvider> {
  try {
    const res = await fetch(`${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instanceName)}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    const state = res.ok
      ? ((data as { instance?: { state?: unknown } })?.instance?.state ?? null)
      : null;
    return {
      ok: res.ok,
      status: res.status,
      state: typeof state === "string" ? state : null,
    };
  } catch {
    return { ok: false, status: 0, state: null };
  }
}

async function aguardarSairDeOpen(config: EvolutionConfig, tentativas = 6, intervaloMs = 500): Promise<EstadoProvider> {
  let atual = await lerEstado(config);
  if (!atual.ok || atual.state !== "open") return atual;

  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    await new Promise(resolve => setTimeout(resolve, intervaloMs));
    atual = await lerEstado(config);
    if (!atual.ok || atual.state !== "open") return atual;
  }

  return atual;
}

async function solicitarLogout(config: EvolutionConfig): Promise<Response> {
  return fetch(`${config.baseUrl}/instance/logout/${encodeURIComponent(config.instanceName)}`, {
    method: "DELETE",
    headers: { apikey: config.apiKey, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
}

function listaInstancias(data: unknown): InstanceInfo[] {
  if (Array.isArray(data)) return data.filter((item): item is InstanceInfo => !!item && typeof item === "object");
  const obj = data as { instances?: unknown } | null;
  return Array.isArray(obj?.instances)
    ? obj.instances.filter((item): item is InstanceInfo => !!item && typeof item === "object")
    : [];
}

function nomeInstancia(item: InstanceInfo): string | null {
  const nome =
    item.instanceName ??
    item.name ??
    (item.instance && typeof item.instance === "object"
      ? (item.instance as Record<string, unknown>).instanceName
      : null);
  return typeof nome === "string" ? nome : null;
}

function integracaoInstancia(item: InstanceInfo): string | null {
  const integration =
    item.integration ??
    (item.instance && typeof item.instance === "object"
      ? (item.instance as Record<string, unknown>).integration
      : null);
  return typeof integration === "string" ? integration : null;
}

async function buscarInstanciaExata(
  config: EvolutionConfig,
): Promise<{ ok: true; instance: InstanceInfo | null } | { ok: false; status: number }> {
  try {
    const res = await fetch(
      `${config.baseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(config.instanceName)}`,
      { headers: { apikey: config.apiKey }, cache: "no-store" },
    );
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => []);
    const exata = listaInstancias(data).find(item => nomeInstancia(item) === config.instanceName) ?? null;
    return { ok: true, instance: exata };
  } catch {
    return { ok: false, status: 0 };
  }
}

function settingsPreservaveis(data: unknown): { ok: true; settings: SettingsPreservaveis } | { ok: false } {
  if (data == null) return { ok: true, settings: {} };
  if (typeof data !== "object" || Array.isArray(data)) return { ok: false };

  const d = data as Record<string, unknown>;

  // wavoipToken é credencial sensível. Se existir, o reset automático falha
  // fechado em vez de copiar/armazenar segredo por um caminho novo.
  if (typeof d.wavoipToken === "string" && d.wavoipToken.trim()) return { ok: false };

  const settings: SettingsPreservaveis = {};
  if (typeof d.rejectCall === "boolean") settings.rejectCall = d.rejectCall;
  if (typeof d.msgCall === "string") settings.msgCall = d.msgCall;
  if (typeof d.groupsIgnore === "boolean") settings.groupsIgnore = d.groupsIgnore;
  if (typeof d.alwaysOnline === "boolean") settings.alwaysOnline = d.alwaysOnline;
  if (typeof d.readMessages === "boolean") settings.readMessages = d.readMessages;
  if (typeof d.readStatus === "boolean") settings.readStatus = d.readStatus;
  if (typeof d.syncFullHistory === "boolean") settings.syncFullHistory = d.syncFullHistory;
  return { ok: true, settings };
}

async function capturarSettings(
  config: EvolutionConfig,
): Promise<{ ok: true; settings: SettingsPreservaveis } | { ok: false; status: number; sensitive?: boolean }> {
  try {
    const res = await fetch(`${config.baseUrl}/settings/find/${encodeURIComponent(config.instanceName)}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => null);
    const filtrado = settingsPreservaveis(data);
    if (!filtrado.ok) return { ok: false, status: 422, sensitive: true };
    return filtrado;
  } catch {
    return { ok: false, status: 0 };
  }
}

async function restaurarSettings(config: EvolutionConfig, settings: SettingsPreservaveis): Promise<boolean> {
  if (Object.keys(settings).length === 0) return true;
  try {
    const res = await fetch(`${config.baseUrl}/settings/set/${encodeURIComponent(config.instanceName)}`, {
      method: "POST",
      headers: { apikey: config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(settings),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function deletarInstancia(config: EvolutionConfig): Promise<{ removida: boolean; status: number | null }> {
  // O status observado é preservado (nunca descartado) porque é ele que
  // diferencia "a Evolution recusou remover" de "a rede caiu no meio" — sem
  // isso o admin só via uma mensagem genérica e o diagnóstico morria aqui.
  let status: number | null = null;
  try {
    const res = await fetch(`${config.baseUrl}/instance/delete/${encodeURIComponent(config.instanceName)}`, {
      method: "DELETE",
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    status = res.status;

    // Em versões afetadas da Evolution, delete/logout podem responder erro
    // depois de já terem removido a sessão. A confirmação é feita pela lista
    // de instâncias abaixo, nunca só pelo status HTTP.
    if (res.status === 401 || res.status === 403) return { removida: false, status };
  } catch {
    // Ainda verificamos se o provider removeu a instância antes da falha de rede.
  }

  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const lookup = await buscarInstanciaExata(config);
    if (!lookup.ok) return { removida: false, status };
    if (!lookup.instance) return { removida: true, status };
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return { removida: false, status };
}

async function criarInstancia(
  config: EvolutionConfig,
  integration: "WHATSAPP-BAILEYS",
): Promise<{ ok: boolean; status: number; base64: string | null }> {
  try {
    const res = await fetch(`${config.baseUrl}/instance/create`, {
      method: "POST",
      headers: { apikey: config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        instanceName: config.instanceName,
        qrcode: true,
        integration,
      }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    const jaExiste = res.status === 409;
    return {
      ok: res.ok || jaExiste,
      status: res.status,
      base64: extrairQrBase64(data),
    };
  } catch {
    return { ok: false, status: 0, base64: null };
  }
}

async function obterQr(config: EvolutionConfig, base64Inicial: string | null) {
  let base64 = base64Inicial;
  if (!base64) {
    const res = await fetch(`${config.baseUrl}/instance/connect/${encodeURIComponent(config.instanceName)}`, {
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    base64 = extrairQrBase64(data);
  }
  if (!base64) return null;

  const registro = await persistirQrAtual(config.instanceName, base64);
  return {
    base64,
    generatedAt: registro.generatedAt,
    expiresAt: registro.expiresAt,
    generationId: registro.generationId,
  };
}

/**
 * Último recurso NÃO destrutivo quando a Evolution recusa remover a instância.
 *
 * O objetivo real desta rota nunca foi apagar a instância — é entregar um QR
 * novo para parear outro número; remover/recriar é só um meio. Então, antes de
 * desistir, pedimos o QR direto (`/instance/connect`, que nunca apaga nem
 * desconecta nada):
 *
 * - sessão realmente viva → a Evolution responde estado, sem QR: devolvemos
 *   `null` e o erro original é mantido, sem mudar nada;
 * - sessão fantasma ("open" para a API, mas sem vínculo real com o WhatsApp,
 *   que é justamente o caso em que o delete é recusado) → a Evolution devolve
 *   um QR novo, exatamente o resultado desejado, sem apagar coisa alguma.
 *
 * Mesma lógica das correções anteriores deste fluxo: a fonte de verdade é o
 * efeito real observado, nunca o status HTTP da operação intermediária.
 */
async function tentarQrSemRemocao(config: EvolutionConfig): Promise<QrcodeAtual | null> {
  try {
    return await obterQr(config, null);
  } catch {
    return null;
  }
}

/**
 * Reinicia SOMENTE a conexão desta instância na Evolution.
 *
 * Não apaga instância, settings, webhook nem histórico — é o equivalente a
 * desligar e ligar o cabo daquela sessão. Existe porque a Evolution pode ficar
 * com o `connectionStatus` DEFASADO em "open" depois que o WhatsApp derruba o
 * aparelho (motivo 401 = loggedOut): nesse estado ela bloqueia os dois
 * caminhos de conserto ao mesmo tempo — recusa devolver QR ("já estou
 * conectada") e recusa o delete com 400 ("precisa estar desconectada").
 *
 * O restart é o que faz a Evolution largar esse status fantasma: com a
 * credencial já invalidada pelo WhatsApp, a reconexão falha, o estado cai para
 * close/connecting e o QR volta a ser emitido.
 */
async function reiniciarInstancia(config: EvolutionConfig): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(`${config.baseUrl}/instance/restart/${encodeURIComponent(config.instanceName)}`, {
      method: "PUT",
      headers: { apikey: config.apiKey },
      cache: "no-store",
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

async function completarRecovery(
  config: EvolutionConfig,
  record: RecoveryRecord,
): Promise<ResultadoRecuperacao> {
  let atual = record;
  let base64Criacao: string | null = null;

  if (atual.phase === "captured") {
    // Ordem deliberada: a tentativa NÃO destrutiva vem primeiro. Só se chega
    // aqui quando o logout já falhou em tirar a instância de "open", ou seja,
    // a sessão já está num estado que a própria Evolution não resolveu. Se
    // pedir o QR direto já resolve, remover e recriar a instância seria
    // destruir histórico e configuração sem necessidade nenhuma.
    //
    // Uma sessão de fato viva não devolve QR aqui (responde só o estado), e aí
    // o caminho segue exatamente como antes: remoção controlada e recriação.
    const qrDireto = await tentarQrSemRemocao(config);
    if (qrDireto) {
      // Nada foi removido: settings, histórico e webhook da instância seguem
      // intactos. O webhook é confirmado em melhor esforço (mesma política do
      // caminho de logout) e a recuperação pendente é encerrada, porque não
      // há mais etapa destrutiva a retomar num próximo clique.
      await garantirWebhookEvolution(config).catch(() => null);
      await salvarStatusConexao("connecting");
      await limparRecovery(config.instanceName);
      return { ok: true, qrcode: qrDireto, via: "qr_sem_remocao" };
    }

    // Segunda tentativa NÃO destrutiva: reinicia só a conexão e pede o QR de
    // novo. Cobre o impasse do status defasado em "open", em que a Evolution
    // recusa o QR ("já conectada") E recusa o delete com 400 ("precisa estar
    // desconectada") — sem o restart não há saída sem destruir a instância.
    const restart = await reiniciarInstancia(config);
    if (restart.ok) {
      await aguardarSairDeOpen(config, 6, 500);
      const qrPosRestart = await tentarQrSemRemocao(config);
      if (qrPosRestart) {
        await garantirWebhookEvolution(config).catch(() => null);
        await salvarStatusConexao("connecting");
        await limparRecovery(config.instanceName);
        return { ok: true, qrcode: qrPosRestart, via: "qr_apos_restart" };
      }
    }

    const remocao = await deletarInstancia(config);
    if (!remocao.removida) {
      return {
        ok: false,
        estado: "provider_delete_failed",
        error: `A Evolution não conseguiu liberar um QR novo nem remover a sessão travada (delete ${
          remocao.status ?? "sem resposta"
        }, restart ${restart.status ?? "sem resposta"}). Nenhum pedido ou dado do ChefeBot foi alterado.`,
      };
    }
    atual = { ...atual, phase: "deleted" };
    if (!(await salvarRecovery(atual))) {
      return {
        ok: false,
        estado: "recovery_state_unavailable",
        error: "Sessão removida, mas não foi possível registrar o estado seguro de recuperação.",
      };
    }
  }

  if (atual.phase === "deleted") {
    const criada = await criarInstancia(config, atual.integration);
    if (!criada.ok) {
      return {
        ok: false,
        estado: "instance_recreate_failed",
        error: "Sessão antiga removida, mas a Evolution ainda não conseguiu recriar a instância.",
      };
    }
    base64Criacao = criada.base64;
    atual = { ...atual, phase: "created" };
    if (!(await salvarRecovery(atual))) {
      return {
        ok: false,
        estado: "recovery_state_unavailable",
        error: "Instância recriada, mas não foi possível registrar o estado seguro de recuperação.",
      };
    }
  }

  const settingsOk = await restaurarSettings(config, atual.settings);
  const webhookResultado = await garantirWebhookEvolution(config).catch(() => null);
  if (!settingsOk || !webhookResultado?.ok) {
    return {
      ok: false,
      estado: "instance_recreated_config_pending",
      error: "A instância foi recriada, mas a configuração ainda não foi restaurada por completo. Tente novamente.",
    };
  }

  const qr = await obterQr(config, base64Criacao);
  if (!qr) {
    return {
      ok: false,
      estado: "qr_pending",
      error: "A sessão antiga foi removida e a instância recriada, mas o QR ainda não ficou disponível.",
    };
  }

  await salvarStatusConexao("connecting");
  await limparRecovery(config.instanceName);
  return { ok: true, qrcode: qr, via: "recreated" };
}

async function iniciarHardReset(config: EvolutionConfig): Promise<ResultadoRecuperacao> {
  const lookup = await buscarInstanciaExata(config);
  if (!lookup.ok) {
    return {
      ok: false,
      estado: "provider_inventory_unavailable",
      error: "Não foi possível confirmar a instância exata na Evolution. Nada foi removido.",
    };
  }
  if (!lookup.instance) {
    return {
      ok: false,
      estado: "provider_instance_inconsistent",
      error: "A Evolution informa conexão ativa, mas a instância não aparece no inventário. Nada foi removido.",
    };
  }

  const integrationRaw = integracaoInstancia(lookup.instance);
  if (integrationRaw && integrationRaw.toUpperCase() !== "WHATSAPP-BAILEYS") {
    return {
      ok: false,
      estado: "unsupported_integration",
      error: "A instância conectada não é Baileys. O reset automático foi bloqueado para proteger a integração atual.",
    };
  }

  const settings = await capturarSettings(config);
  if (!settings.ok) {
    return {
      ok: false,
      estado: settings.sensitive ? "sensitive_settings_present" : "settings_snapshot_failed",
      error: settings.sensitive
        ? "A instância possui uma configuração sensível que impede reset automático seguro."
        : "Não foi possível preservar as configurações da instância. Nada foi removido.",
    };
  }

  const record: RecoveryRecord = {
    version: 1,
    instanceName: config.instanceName,
    integration: "WHATSAPP-BAILEYS",
    settings: settings.settings,
    phase: "captured",
    capturedAt: new Date().toISOString(),
  };

  if (!(await salvarRecovery(record))) {
    return {
      ok: false,
      estado: "recovery_state_unavailable",
      error: "Não foi possível preparar um rollback seguro. Nada foi removido.",
    };
  }

  return completarRecovery(config, record);
}

/**
 * Troca intencional do número conectado.
 *
 * Caminho normal: tenta logout e confirma o estado real.
 * Fallback de recuperação: se a Evolution permanecer comprovadamente "open",
 * trata o defeito conhecido de sessão Baileys travada removendo SOMENTE a
 * instância do provider e recriando-a com o mesmo nome/configuração antes de
 * gerar o QR. Pedidos, Pix, conversas, catálogo e Redis de negócio não são
 * apagados.
 */
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  const config = obterConfigEvolution();
  if (!config) {
    return NextResponse.json(
      { ok: false, estado: "provider_not_configured", error: "Evolution API não configurada." },
      { status: 503 },
    );
  }

  const lockToken = await adquirirLock(config.instanceName);
  if (!lockToken) {
    return NextResponse.json(
      { ok: false, estado: "busy", error: "Já existe uma troca de número em andamento. Aguarde alguns segundos." },
      { status: 409 },
    );
  }

  try {
    await limparQrAtual(config.instanceName);

    const pendente = await lerRecovery(config.instanceName);
    if (pendente) {
      const retomada = await completarRecovery(config, pendente);
      return NextResponse.json(retomada, { status: retomada.ok ? 200 : 502 });
    }

    let logoutRes: Response;
    try {
      logoutRes = await solicitarLogout(config);
    } catch {
      return NextResponse.json(
        { ok: false, estado: "provider_unreachable", error: "Não foi possível alcançar a Evolution API." },
        { status: 502 },
      );
    }

    if (logoutRes.status === 401 || logoutRes.status === 403) {
      return NextResponse.json(
        { ok: false, estado: "provider_auth_failed", error: "Credencial da Evolution API inválida." },
        { status: 502 },
      );
    }

    const estadoAposLogout = await aguardarSairDeOpen(config, 6, 500);

    if (!estadoAposLogout.ok) {
      return NextResponse.json(
        { ok: false, estado: "provider_state_unavailable", error: "A Evolution não confirmou o estado da conexão. Nada foi removido." },
        { status: 502 },
      );
    }

    if (estadoAposLogout.state !== "open") {
      await salvarStatusConexao("disconnected");
      const webhookResultado = await garantirWebhookEvolution(config).catch(() => null);
      return NextResponse.json({
        ok: true,
        estado: "disconnected",
        qr: "pending",
        webhook: webhookResultado?.ok ? "synced" : "pending",
        recovery: "logout",
      });
    }

    console.warn("[WA_TROCA_NUMERO] logout permaneceu open; iniciando recuperação controlada da instância");
    const recovery = await iniciarHardReset(config);
    if (!recovery.ok) {
      console.error("[WA_TROCA_NUMERO] recuperação controlada falhou:", recovery.estado);
      return NextResponse.json(recovery, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      estado: "qr_required",
      qrcode: recovery.qrcode,
      recovery: recovery.via,
    });
  } catch (e) {
    console.error("[WA_TROCA_NUMERO] erro inesperado:", e instanceof Error ? e.name : "erro desconhecido");
    return NextResponse.json({ ok: false, error: "Falha ao trocar a conexão do WhatsApp." }, { status: 502 });
  } finally {
    await liberarLock(config.instanceName, lockToken);
  }
}
