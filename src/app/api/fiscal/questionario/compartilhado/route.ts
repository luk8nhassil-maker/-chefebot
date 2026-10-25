import { NextRequest, NextResponse } from "next/server";
import { emPreviewVercel } from "@/lib/previewSafety";
import { validarRespostas, QuestionarioInvalido } from "@/lib/fiscal/questionario";
import { donoPorConvite, carregarQuestionario, salvarQuestionario, respostasPublicas } from "@/lib/fiscal/questionario.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function mesmaOrigem(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (parsed.protocol === "https:" || (parsed.protocol === "http:" && host === "localhost"));
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (emPreviewVercel()) return NextResponse.json({ ok: false, error: "Preview bloqueado." }, { status: 403, headers: HEADERS });
  if (!mesmaOrigem(req)) return NextResponse.json({ ok: false, error: "Origem não autorizada." }, { status: 403, headers: HEADERS });
  try {
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > 8192) throw new QuestionarioInvalido("Formulário muito grande.");
    const raw = await req.text();
    if (raw.length > 8192) throw new QuestionarioInvalido("Formulário muito grande.");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new QuestionarioInvalido("Formulário inválido."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new QuestionarioInvalido("Formulário inválido.");
    const body = parsed as Record<string, unknown>;
    if (Object.keys(body).some(k => !["token", "acao", "respostas", "versao"].includes(k)))
      throw new QuestionarioInvalido("Campo não permitido.");
    const owner = await donoPorConvite(body.token);
    if (!owner) return NextResponse.json({ ok: false, error: "Convite inválido, expirado ou revogado." }, { status: 403, headers: HEADERS });
    if (body.acao === "ler") {
      if ("respostas" in body || "versao" in body) throw new QuestionarioInvalido("Campos não permitidos.");
      return NextResponse.json({ ok: true, ...respostasPublicas(await carregarQuestionario(owner)) }, { headers: HEADERS });
    }
    if (body.acao === "salvar") {
      if (!Number.isSafeInteger(body.versao) || (body.versao as number) < 0)
        throw new QuestionarioInvalido("Versão inválida.");
      const respostas = validarRespostas(body.respostas);
      // Revalidar o convite imediatamente antes de gravar para mitigar revogação concorrente.
      if ((await donoPorConvite(body.token)) !== owner)
        return NextResponse.json({ ok: false, error: "Convite revogado." }, { status: 403, headers: HEADERS });
      const doc = await salvarQuestionario(owner, body.versao as number, respostas);
      if (!doc) return NextResponse.json({ ok: false, error: "O dono salvou alterações. Atualize a página e confira antes de continuar." }, { status: 409, headers: HEADERS });
      return NextResponse.json({ ok: true, ...respostasPublicas(doc) }, { headers: HEADERS });
    }
    throw new QuestionarioInvalido("Ação inválida.");
  } catch (error) {
    if (error instanceof QuestionarioInvalido)
      return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: HEADERS });
    return NextResponse.json({ ok: false, error: "Serviço temporariamente indisponível." }, { status: 503, headers: HEADERS });
  }
}
