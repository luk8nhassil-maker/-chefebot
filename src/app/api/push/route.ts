import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
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

export async function POST(req: NextRequest) {
  try {
    initWebPush();
    const body = await req.json();
    const { action, subscription, title, message } = body;

    if (action === "subscribe") {
      await redis.set(`push:${subscription.endpoint.slice(-20)}`, JSON.stringify(subscription));
      return NextResponse.json({ ok: true });
    }

    if (action === "notify") {
      const keys = await redis.keys("push:*");
      const results = await Promise.allSettled(
        keys.map(async (key) => {
          const sub = await redis.get(key);
          if (!sub) return;
          await webpush.sendNotification(
            typeof sub === "string" ? JSON.parse(sub) : sub as any,
            JSON.stringify({ title: title || "Novo pedido! 🍕", body: message || "Tem pedido novo na fila." })
          );
        })
      );
      return NextResponse.json({ ok: true, sent: results.filter(r => r.status === "fulfilled").length });
    }

    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
