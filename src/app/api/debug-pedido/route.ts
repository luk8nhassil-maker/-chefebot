import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function GET(req: NextRequest) {
  const pedidos = await redis.get<any[]>("pedidos") || [];
  const ultimo = pedidos[pedidos.length - 1];
  return NextResponse.json({
    pagamento: ultimo?.pagamento,
    pixConfirmado: ultimo?.pixConfirmado,
    escalonado: ultimo?.escalonado,
    status: ultimo?.status
  });
}
