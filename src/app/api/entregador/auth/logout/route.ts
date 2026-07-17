import { NextResponse } from "next/server";
import {
  ENTREGADOR_COOKIE,
  cookieEntregadorOptions,
} from "@/lib/entregadorAuth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ENTREGADOR_COOKIE, "", cookieEntregadorOptions(0));
  return response;
}
