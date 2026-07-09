import { NextResponse } from "next/server";
import { CLIENTE_COOKIE } from "@/lib/clienteAuth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CLIENTE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
