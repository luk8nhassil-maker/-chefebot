import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { verificarInstancia } from "@/lib/evolutionConnect";
import { registrarResultadoVerificacao, acaoRecomendada } from "@/lib/whatsappProviderState";

async function checkAuth(req: NextRequest): Promise<{ status: 401 } | { status: 403 } | { status: 200 }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200 };
}

// GET /api/whatsapp/verify — Fase 4, ação 1: só lê o estado (host, auth,
// instância). Nunca altera nada — segura para chamar quantas vezes quiser,
// inclusive pelo cron de monitoramento (ver /api/cron/whatsapp-health).
export async function GET(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  const config = obterConfigEvolution();
  if (!config) {
    const estadoPersistido = await registrarResultadoVerificacao("provider_not_configured", { etapaFalha: "config" });
    return NextResponse.json({
      ok: false,
      error: "EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados.",
      acaoRecomendada: acaoRecomendada("provider_not_configured"),
      ...estadoPersistido,
    });
  }

  const resultado = await verificarInstancia(config);
  const estadoPersistido = await registrarResultadoVerificacao(resultado.estado, {
    etapaFalha: resultado.ok ? null : resultado.step,
  });

  return NextResponse.json({
    ok: resultado.ok,
    estado: resultado.estado,
    ...(resultado.ok ? {} : { error: resultado.error }),
    acaoRecomendada: acaoRecomendada(resultado.estado),
    ultimaVerificacao: estadoPersistido.ultimaVerificacao,
    ultimaConexaoValida: estadoPersistido.ultimaConexaoValida,
    ultimaMensagemRecebida: estadoPersistido.ultimaMensagemRecebida,
    falhasConsecutivas: estadoPersistido.falhasConsecutivas,
  });
}

