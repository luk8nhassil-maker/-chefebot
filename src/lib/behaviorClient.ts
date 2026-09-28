"use client";

import { fetchCliente } from "./clienteSessaoFront";
import type { BehaviorContext, ClientBehaviorEventType } from "./behaviorAnalytics";

const SESSION_KEY = "cf_behavior_session_v1";
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
    const atual = sessionStorage.getItem(SESSION_KEY);
    if (atual && /^[0-9a-f-]{36}$/i.test(atual)) return atual;
    const novo = uuid();
    sessionStorage.setItem(SESSION_KEY, novo);
    return novo;
  } catch {
    return null;
  }
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

  queue.push({
    eventId: uuid(),
    sessionId,
    type,
    occurredAtMs: Date.now(),
    ...(context ? { context } : {}),
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
  const onExit = () => {
    trackBehavior("page_exit", { source });
    void flushBehaviorEvents();
  };
  window.addEventListener("pagehide", onExit);
  return () => window.removeEventListener("pagehide", onExit);
}
