import { NextResponse } from "next/server";
import { assinaturaBloqueiaOperacao } from "@/lib/assinaturaChefeBot.server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const blocked = await assinaturaBloqueiaOperacao();
    return NextResponse.json(
      { blocked },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    // O subsistema financeiro nunca pode derrubar uma operação saudável.
    return NextResponse.json(
      { blocked: false },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
