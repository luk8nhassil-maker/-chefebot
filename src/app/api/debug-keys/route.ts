import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
export async function GET() {
  const keys = await redis.keys("*");
  return NextResponse.json({ keys });
}