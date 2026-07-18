import { NextRequest, NextResponse } from "next/server";

// Telemetria TEMPORÁRIA do fluxo Perfil 3.0 — existe só para diagnosticar em
// produção qual etapa/bundle o aparelho real executa. Sem PII por construção:
// aceita apenas slugs de uma allowlist fixa, um booleano e um marcador de
// versão curto; qualquer outro dado do body é ignorado. Nunca registra OTP,
// telefone, tokens, cookies, clienteId ou nome. Remover após a validação
// humana do Perfil 3.0 ser concluída.

const EVENTOS_PERMITIDOS = new Set([
  "otp_verified",
  "opaque_session_received",
  "opaque_session_storage_ok",
  "opaque_session_storage_failed",
  "cookie_session_ok",
  "bearer_session_ok",
  "profile_loaded",
  "name_step_opened",
  "fallback_navigation",
  "fallback_to_confirm_screen",
  "arrival_activation",
]);

const MOTIVOS_PERMITIDOS = new Set([
  "sem_sessao_no_body",
  "bearer_falhou",
  "cookie_falhou",
  "sem_ticket",
  "chegada_sem_sessao",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const evt = typeof body?.evt === "string" && EVENTOS_PERMITIDOS.has(body.evt) ? body.evt : null;
    if (!evt) return new NextResponse(null, { status: 204 });
    const ok = body?.ok === true ? "1" : body?.ok === false ? "0" : "-";
    const motivo = typeof body?.motivo === "string" && MOTIVOS_PERMITIDOS.has(body.motivo) ? body.motivo : "-";
    // v: marcador curto da versão do bundle que executou (ex.: "p3h3").
    const v = typeof body?.v === "string" && /^[a-z0-9]{1,8}$/.test(body.v) ? body.v : "antigo";
    console.log(`[ChefeBot] perfil3-telemetria evt=${evt} ok=${ok} motivo=${motivo} v=${v}`);
  } catch {}
  return new NextResponse(null, { status: 204 });
}
