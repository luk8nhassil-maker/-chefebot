import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { reconectarOuCriar } from "@/lib/evolutionConnect";
import { registrarResultadoVerificacao, acaoRecomendada } from "@/lib/whatsappProviderState";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";

async function checkAuth(req: NextRequest): Promise<{ status: 401 | 403 } | { status: 200 }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200 };
}

// POST /api/whatsapp/connect — Fase 4, ação 2 (ação PADRÃO do painel):
// nunca faz logout/delete. Se a instância existe, só conecta; se não
// existe, cria, configura webhook e conecta. Sempre com retry limitado
// pro QR. Para reconstrução destrutiva, ver POST /api/whatsapp/rebuild.
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  const config = obterConfigEvolution();
  if (!config) {
    await registrarResultadoVerificacao("provider_not_configured", { etapaFalha: "config" });
    return NextResponse.json(
      { ok: false, estado: "provider_not_configured", error: "EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados.", acaoRecomendada: acaoRecomendada("provider_not_configured") },
      { status: 503 }
    );
  }

  const resultado = await reconectarOuCriar(config);
  await registrarResultadoVerificacao(resultado.estado, { etapaFalha: resultado.ok ? null : resultado.step });

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, estado: resultado.estado, error: resultado.error, step: resultado.step, acaoRecomendada: acaoRecomendada(resultado.estado) },
      { status: 502 }
    );
  }

  if (resultado.estado === "connected") {
    await salvarStatusConexao("connected");
    return NextResponse.json({ ok: true, estado: "connected", acaoRecomendada: acaoRecomendada("connected") });
  }

  await salvarStatusConexao("connecting");
  return NextResponse.json({
    ok: true,
    estado: resultado.estado,
    qrcode: resultado.qrcode,
    acaoRecomendada: acaoRecomendada(resultado.estado),
  });
}
