import { NextRequest, NextResponse } from "next/server";

// Telemetria TEMPORÁRIA do fluxo Perfil 3.0 — existe só para diagnosticar em
// produção qual etapa/bundle o aparelho real executa. Sem PII por construção:
// aceita apenas slugs de uma allowlist fixa, um booleano e um marcador de
// versão curto; qualquer outro dado do body é ignorado. Nunca registra OTP,
// telefone, tokens, cookies, clienteId ou nome. Remover após a validação
// humana do Perfil 3.0 ser concluída.

const EVENTOS_PERMITIDOS = new Set([
  "otp_requested",
  "otp_verified",
  "session_created",
  "session_in_memory",
  "session_storage_ok",
  "session_storage_failed",
  "name_step_opened",
  "name_saved",
  "profile_request_status",
  "fidelity_request_status",
  "points_step_opened",
  "unexpected_return_to_confirm",
  // eventos da geração anterior (bundle antigo ainda pode emitir)
  "opaque_session_received",
  "opaque_session_storage_ok",
  "opaque_session_storage_failed",
  "cookie_session_ok",
  "bearer_session_ok",
  "profile_loaded",
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
  "estado_sessao_401",
  "erro_inesperado",
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
    // trace: código de suporte da tentativa (formato estrito, sem PII) e
    // status: código HTTP numérico de uma requisição observada pelo front.
    const trace = typeof body?.trace === "string" && /^P3-[A-Z0-9]{6}$/.test(body.trace) ? body.trace : "-";
    const status = Number.isInteger(body?.status) && body.status >= 100 && body.status <= 599 ? String(body.status) : "-";
    console.log(`[ChefeBot] perfil3-telemetria evt=${evt} ok=${ok} motivo=${motivo} v=${v} trace=${trace} status=${status}`);
  } catch {}
  return new NextResponse(null, { status: 204 });
}
