"use client";

import { fetchCliente } from "./clienteSessaoFront";
import type { BehaviorContext, ClientBehaviorEventType } from "./behaviorAnalyticsTypes";

const SESSION_KEY = "cf_behavior_session_v1";
const SESSION_LAST_ACTIVITY_KEY = "cf_behavior_session_last_v1";
const SESSION_APP_OPEN_KEY = "cf_behavior_app_open_v1";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const QUEUE_MAX = 20;
const FLUSH_DELAY_MS = 1200;

type QueuedEvent = {
  eventId: string;
  sessionId: string;
  type: ClientBehaviorEventType;
  occurredAtMs: number;
  context?: BehaviorContext;
};

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function enabledOnClient(): boolean {
  return process.env.NEXT_PUBLIC_BEHAVIOR_ANALYTICS_ENABLED === "true";
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback RFC4122-like apenas para navegadores antigos; não carrega PII.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getBehaviorSessionId(): string | null {
  if (!enabledOnClient() || typeof window === "undefined") return null;
  try {
    const agora = Date.now();
    const atual = sessionStorage.getItem(SESSION_KEY);
    const ultimaAtividade = Number(sessionStorage.getItem(SESSION_LAST_ACTIVITY_KEY) ?? "0");
    const atualValido = !!atual && /^[0-9a-f-]{36}$/i.test(atual);
    const aindaAtiva = atualValido && Number.isFinite(ultimaAtividade) && ultimaAtividade > 0
      && agora - ultimaAtividade <= SESSION_IDLE_MS;

    if (atualValido && aindaAtiva) {
      sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(agora));
      return atual;
    }

    const novo = uuid();
    sessionStorage.setItem(SESSION_KEY, novo);
    sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(agora));
    sessionStorage.removeItem(SESSION_APP_OPEN_KEY);
    return novo;
  } catch {
    return null;
  }
}

function ambienteDaSessao(): Partial<BehaviorContext> {
  if (typeof window === "undefined") return {};

  const largura = window.innerWidth || 0;
  const deviceClass: NonNullable<BehaviorContext["deviceClass"]> =
    largura <= 640 ? "mobile" : largura <= 1024 ? "tablet" : "desktop";
  const viewportClass: NonNullable<BehaviorContext["viewportClass"]> =
    largura <= 640 ? "compact" : largura <= 1180 ? "medium" : "wide";

  let displayMode: NonNullable<BehaviorContext["displayMode"]> = "browser";
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) displayMode = "standalone";
  } catch {}

  let referrerKind: NonNullable<BehaviorContext["referrerKind"]> = "direct";
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("t")) {
      referrerKind = "whatsapp_link";
    } else if (document.referrer) {
      const ref = new URL(document.referrer);
      referrerKind = ref.origin === window.location.origin ? "internal" : "external";
    }
  } catch {
    referrerKind = "unknown";
  }

  return { deviceClass, viewportClass, displayMode, referrerKind };
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushBehaviorEvents();
  }, FLUSH_DELAY_MS);
}

export function trackBehavior(type: ClientBehaviorEventType, context?: BehaviorContext): void {
  if (!enabledOnClient()) return;
  const sessionId = getBehaviorSessionId();
  if (!sessionId) return;

  if (type === "app_open") {
    try {
      if (sessionStorage.getItem(SESSION_APP_OPEN_KEY) === sessionId) return;
      sessionStorage.setItem(SESSION_APP_OPEN_KEY, sessionId);
    } catch {}
  }

  const contextoFinal: BehaviorContext | undefined =
    type === "app_open"
      ? { ...ambienteDaSessao(), ...(context ?? {}) }
      : context;

  queue.push({
    eventId: uuid(),
    sessionId,
    type,
    occurredAtMs: Date.now(),
    ...(contextoFinal ? { context: contextoFinal } : {}),
  });

  if (queue.length >= QUEUE_MAX) {
    void flushBehaviorEvents();
  } else {
    scheduleFlush();
  }
}

export async function flushBehaviorEvents(): Promise<void> {
  if (!enabledOnClient() || flushing || queue.length === 0) return;
  flushing = true;
  const lote = queue.splice(0, QUEUE_MAX);
  try {
    const res = await fetchCliente("/api/comportamento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: lote }),
      keepalive: true,
    });
    if (!res.ok && res.status !== 404) {
      // Falha transitória: recoloca no início sem crescer indefinidamente.
      queue = [...lote, ...queue].slice(0, QUEUE_MAX * 3);
    }
  } catch {
    queue = [...lote, ...queue].slice(0, QUEUE_MAX * 3);
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

export function installBehaviorPageExitTracking(source: BehaviorContext["source"]): () => void {
  if (!enabledOnClient() || typeof window === "undefined") return () => {};

  let acumuladoAtivoMs = 0;
  let iniciouAtivoEm = document.visibilityState === "visible" ? Date.now() : null;

  const fecharTrechoAtivo = () => {
    if (iniciouAtivoEm === null) return;
    acumuladoAtivoMs += Math.max(0, Date.now() - iniciouAtivoEm);
    iniciouAtivoEm = null;
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      if (iniciouAtivoEm === null) iniciouAtivoEm = Date.now();
    } else {
      fecharTrechoAtivo();
    }
  };

  const onExit = () => {
    fecharTrechoAtivo();
    trackBehavior("page_exit", {
      source,
      engagementMs: Math.min(acumuladoAtivoMs, 24 * 60 * 60 * 1000),
    });
    void flushBehaviorEvents();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onExit);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onExit);
  };
}
