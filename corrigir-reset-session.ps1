$content = @'
import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone } = body;

    if (!phone) {
      return NextResponse.json({ error: "phone obrigatorio" }, { status: 400 });
    }

    await redis.del(`session:${phone}`);
    await redis.del(`manual:${phone}`);
    await redis.del(`fechado:${phone}`);

    return NextResponse.json({ ok: true, phone, message: "Sessao resetada com sucesso" });
  } catch (error) {
    console.error("Reset session error:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
'@

Set-Content -Path "src/app/api/reset-session/route.ts" -Value $content -Encoding UTF8
Write-Host "Endpoint reset-session corrigido com sucesso!"
