import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { obterConfigEvolution } from "@/lib/evolutionApi";
import { reconstruirInstancia } from "@/lib/evolutionConnect";
import { registrarResultadoVerificacao, acaoRecomendada } from "@/lib/whatsappProviderState";
import { registrarAuditoriaReconstrucao } from "@/lib/whatsappAudit";
import { podeReconstruir, registrarTentativaReconstrucao } from "@/lib/whatsappRebuildRateLimit";
import { salvarStatusConexao } from "@/lib/conexaoWhatsapp";

const FRASE_CONFIRMACAO = "RECRIAR CHEFEBOT";

async function checkAuth(req: NextRequest): Promise<{ status: 401 } | { status: 403 } | { status: 200; usuario: string; papel: string }> {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return { status: 401 };
  const payload = await verifyToken(token);
  if (!payload) return { status: 401 };
  if (!["admin", "dev"].includes(payload.role as string)) return { status: 403 };
  return { status: 200, usuario: payload.username as string, papel: payload.role as string };
}

// POST /api/whatsapp/rebuild — Fase 4, ação 3 (EMERGÊNCIA, destrutiva):
// logout + delete + create. Exige admin/dev, confirmação textual exata
// ("RECRIAR CHEFEBOT") e body explícito { mode: "rebuild" }. Rate limit de
// 2 execuções a cada 15 minutos. Toda tentativa (sucesso ou falha) é
// registrada em auditoria. Host indisponível ou credencial inválida detém
// o fluxo ANTES de qualquer delete (ver reconstruirInstancia).
export async function POST(req: NextRequest) {
  const auth = await checkAuth(req);
  if (auth.status === 401) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (auth.status === 403) return NextResponse.json({ error: "Sem permissao" }, { status: 403 });

  let body: { mode?: string; confirmacao?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Corpo inválido" }, { status: 400 });
  }

  if (body.mode !== "rebuild") {
    return NextResponse.json({ ok: false, error: 'Corpo deve incluir "mode": "rebuild"' }, { status: 400 });
  }
  if (body.confirmacao !== FRASE_CONFIRMACAO) {
    return NextResponse.json({ ok: false, error: `Confirmação inválida — digite exatamente "${FRASE_CONFIRMACAO}"` }, { status: 400 });
  }

  const limite = await podeReconstruir();
  if (!limite.permitido) {
    return NextResponse.json(
      { ok: false, error: "Limite de reconstruções atingido (máx. 2 a cada 15 minutos). Aguarde antes de tentar de novo." },
      { status: 429 }
    );
  }

  const config = obterConfigEvolution();
  if (!config) {
    await registrarAuditoriaReconstrucao({ usuario: auth.usuario, papel: auth.papel, criadoEm: new Date().toISOString(), resultado: "falha", etapaFalha: "config" });
    return NextResponse.json(
      { ok: false, estado: "provider_not_configured", error: "EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados." },
      { status: 503 }
    );
  }

  await registrarTentativaReconstrucao();

  const resultado = await reconstruirInstancia(config);
  await registrarResultadoVerificacao(resultado.estado, { etapaFalha: resultado.ok ? null : resultado.step });
  await registrarAuditoriaReconstrucao({
    usuario: auth.usuario,
    papel: auth.papel,
    criadoEm: new Date().toISOString(),
    resultado: resultado.ok ? "sucesso" : "falha",
    etapaFalha: resultado.ok ? null : resultado.step,
  });

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, estado: resultado.estado, error: resultado.error, step: resultado.step, acaoRecomendada: acaoRecomendada(resultado.estado) },
      { status: 502 }
    );
  }

  await salvarStatusConexao("connecting");
  return NextResponse.json({
    ok: true,
    estado: resultado.estado,
    qrcode: resultado.qrcode,
    acaoRecomendada: acaoRecomendada(resultado.estado),
  });
}
