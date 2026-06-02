import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, createToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const user = validateCredentials(username, password);
  if (!user) {
    return NextResponse.json({ error: "Usuário ou senha incorretos." }, { status: 401 });
  }

  const token = await createToken(user);

  const res = NextResponse.json({ name: user.name, role: user.role });

  const cookieOpts = {
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };

  // httpOnly JWT — used by middleware for access control
  res.cookies.set("auth-token", token, { ...cookieOpts, httpOnly: true });

  // Readable by JS — used by client components to show name/role in the UI
  res.cookies.set(
    "auth-user",
    encodeURIComponent(JSON.stringify({ name: user.name, role: user.role })),
    { ...cookieOpts, httpOnly: false }
  );

  return res;
}
