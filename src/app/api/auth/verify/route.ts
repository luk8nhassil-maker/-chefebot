import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return NextResponse.json({ valid: false }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ valid: false }, { status: 401 });
  return NextResponse.json({ valid: true, role: payload.role });
}