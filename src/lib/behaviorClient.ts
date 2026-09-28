import {
  classifyPublicBehaviorPage,
  type BehaviorDeviceClass,
  type BehaviorDisplayMode,
  type BehaviorEventData,
  type BehaviorPage,
  type BehaviorSource,
  type PublicBehaviorEventType,
} from "./behaviorEvents";

const SESSION_KEY = "chefebot_behavior_session_v1";
const APP_OPEN_SENT_KEY = "chefebot_behavior_app_open_sent_v1";
const ENDPOINT = "/api/comportamento/evento";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getBehaviorSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const next = uuidV4();
    sessionStorage.setItem(SESSION_KEY, next);
    sessionStorage.removeItem(APP_OPEN_SENT_KEY);
    return next;
  } catch {
    return null;
  }
}

export function resetBehaviorSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(APP_OPEN_SENT_KEY);
  } catch {}
  return getBehaviorSessionId();
}

export function behaviorAppOpenAlreadySent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(APP_OPEN_SENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markBehaviorAppOpenSent(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(APP_OPEN_SENT_KEY, "1");
  } catch {}
}

export function classifyBehaviorSource(): BehaviorSource {
  if (typeof window === "undefined" || typeof document === "undefined") return "direct";
  const referrer = document.referrer;
  if (!referrer) return "direct";
  try {
    const url = new URL(referrer);
    if (url.origin === window.location.origin) return "internal";
    const host = url.hostname.toLowerCase();
    if (host.includes("whatsapp") || host === "wa.me") return "whatsapp";
    if (host.includes("google.") || host.includes("bing.") || host.includes("duckduckgo.")) return "search";
    if (
      host.includes("instagram.") ||
      host.includes("facebook.") ||
      host.includes("tiktok.") ||
      host.includes("threads.")
    ) return "social";
    return "other";
  } catch {
    return "other";
  }
}

export function detectBehaviorDeviceClass(): BehaviorDeviceClass {
  if (typeof window === "undefined") return "desktop";
  if (window.innerWidth <= 640) return "mobile";
  if (window.innerWidth <= 1024) return "tablet";
  return "desktop";
}

export function detectBehaviorDisplayMode(): BehaviorDisplayMode {
  if (typeof window === "undefined") return "browser";
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone ? "standalone" : "browser";
}

export function currentBehaviorPage(): BehaviorPage | null {
  if (typeof window === "undefined") return null;
  return classifyPublicBehaviorPage(window.location.pathname);
}

function buildPayload(
  type: PublicBehaviorEventType,
  data: BehaviorEventData,
  sessionId: string,
) {
  return {
    eventId: uuidV4(),
    sessionId,
    type,
    data,
  };
}

async function sendPayload(
  payload: ReturnType<typeof buildPayload>,
  retryOnSessionConflict: boolean,
): Promise<void> {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(payload),
    });

    if (
      retryOnSessionConflict &&
      response.status === 409 &&
      response.headers.get("x-chefebot-behavior-reset-session") === "1"
    ) {
      const sessionId = resetBehaviorSession();
      if (!sessionId) return;
      await sendPayload(
        buildPayload(payload.type as PublicBehaviorEventType, payload.data as BehaviorEventData, sessionId),
        false,
      );
    }
  } catch {
    // Observabilidade nunca quebra a UX.
  }
}

export function trackBehavior(
  type: PublicBehaviorEventType,
  data: BehaviorEventData = {},
): void {
  if (typeof window === "undefined") return;
  const sessionId = getBehaviorSessionId();
  if (!sessionId) return;

  const page = data.page ?? currentBehaviorPage() ?? undefined;
  const enriched: BehaviorEventData = {
    ...data,
    ...(page ? { page } : {}),
  };

  void sendPayload(buildPayload(type, enriched, sessionId), true);
}

export function trackBehaviorBeacon(
  type: PublicBehaviorEventType,
  data: BehaviorEventData = {},
): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  const sessionId = getBehaviorSessionId();
  if (!sessionId) return;
  const page = data.page ?? currentBehaviorPage() ?? undefined;
  const payload = buildPayload(type, { ...data, ...(page ? { page } : {}) }, sessionId);

  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    }
  } catch {}
  void sendPayload(payload, false);
}
