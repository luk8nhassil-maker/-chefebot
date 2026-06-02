import { NextRequest, NextResponse } from "next/server";
import { processMessage, createInitialSession, BotSession } from "@/lib/bot";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message, session } = body as {
    message: string;
    session: BotSession | null;
    phone: string;
  };

  const currentSession = session ?? createInitialSession();
  const result = processMessage(message, currentSession);

  return NextResponse.json(result);
}
