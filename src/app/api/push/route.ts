import { NextRequest, NextResponse } from "next/server";
import webpush, { type PushSubscription } from "web-push";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function initWebPush() {
  webpush.setVapidDetails(
    "mailto:admin@chefebot.app",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPushSubscription(value: unknown): value is PushSubscription {
  if (!isRecord(value) || typeof value.endpoint !== "string" || !isRecord(value.keys)) return false;
  return typeof value.keys.p256dh === "string" && typeof value.keys.auth === "string";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest) {
  try {
    initWebPush();
    const body: unknown = await req.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "action inválida" }, { status: 400 });
    }
    const { action, subscription, title, message } = body;

    if (action === "subscribe") {
      if (!isPushSubscription(subscription)) {
        throw new TypeError("subscription inválida");
      }
      await redis.set(`push:${subscription.endpoint.slice(-20)}`, JSON.stringify(subscription));
      return NextResponse.json({ ok: true });
    }

    if (action === "notify") {
      const keys = await redis.keys("push:*");
      const results = await Promise.allSettled(
        keys.map(async (key) => {
          const sub: unknown = await redis.get(key);
          if (!sub) return;
          const parsed: unknown = typeof sub === "string" ? JSON.parse(sub) : sub;
          if (!isPushSubscription(parsed)) throw new TypeError("subscription inválida");
          await webpush.sendNotification(
            parsed,
            JSON.stringify({
              title: typeof title === "string" && title ? title : "Novo pedido! 🍕",
              body: typeof message === "string" && message ? message : "Tem pedido novo na fila.",
            })
          );
        })
      );
      return NextResponse.json({ ok: true, sent: results.filter(r => r.status === "fulfilled").length });
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
