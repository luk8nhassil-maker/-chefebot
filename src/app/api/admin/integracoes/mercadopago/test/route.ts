import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import {
  decryptMercadoPagoToken,
  getMercadoPagoIntegrationConfig,
  saveMercadoPagoIntegrationConfig,
  toMercadoPagoPublicConfig,
} from "@/lib/mercadoPagoIntegracao";

async function requireAdminOrDev(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { ok: false as const, status: 401 };

  const user = await verifyToken(token);
  if (!user) return { ok: false as const, status: 401 };
  if (user.role !== "admin" && user.role !== "dev") return { ok: false as const, status: 403 };

  return { ok: true as const, user };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminOrDev(req);
  if (!auth.ok) return NextResponse.json({ error: "Nao autorizado" }, { status: auth.status });

  const config = await getMercadoPagoIntegrationConfig();
  const accessToken = decryptMercadoPagoToken(config?.accessTokenEncrypted);
  const testedAt = new Date().toISOString();

  if (!config || !accessToken) {
    const updated = {
      ...config,
      provider: "mercadopago" as const,
      enabled: Boolean(config?.enabled),
      lastTestAt: testedAt,
      lastTestOk: false,
      lastTestMessage: "Token Mercado Pago nao configurado.",
      updatedAt: config?.updatedAt || testedAt,
    };
    await saveMercadoPagoIntegrationConfig(updated);
    return NextResponse.json({ ok: false, config: toMercadoPagoPublicConfig(updated) }, { status: 400 });
  }

  let ok = false;
  let message = "Conexao recusada pelo Mercado Pago.";

  try {
    const response = await fetch("https://api.mercadopago.com/users/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    ok = response.ok;
    message = response.ok ? "Conexao Mercado Pago validada." : "Token Mercado Pago invalido ou sem permissao.";
  } catch {
    ok = false;
    message = "Nao foi possivel testar a conexao Mercado Pago.";
  }

  const updated = {
    ...config,
    lastTestAt: testedAt,
    lastTestOk: ok,
    lastTestMessage: message,
    updatedAt: new Date().toISOString(),
    updatedBy: auth.user.username,
  };
  await saveMercadoPagoIntegrationConfig(updated);

  return NextResponse.json({ ok, config: toMercadoPagoPublicConfig(updated) }, { status: ok ? 200 : 400 });
}
