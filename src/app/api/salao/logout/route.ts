import { NextResponse } from "next/server";
import { SALAO_COOKIE } from "@/lib/salaoAuth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SALAO_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
