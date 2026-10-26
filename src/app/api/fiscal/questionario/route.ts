import { NextRequest, NextResponse } from "next/server";
import { autenticarRequisicao, exigirRole } from "@/lib/apiAuth";
import { emPreviewVercel } from "@/lib/previewSafety";
import { QuestionarioInvalido, validarRespostas } from "@/lib/fiscal/questionario";
import { carregarQuestionario, salvarQuestionario, respostasPublicas, criarConvite, revogarConvite, existeConvite } from "@/lib/fiscal/questionario.server";
import { haImportacaoPendente, importarDadosConferidos } from "@/lib/fiscal/importacaoNotaFiscal.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export function mesmaOrigem(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host && new URL(origin).protocol === "https:" ||
    new URL(origin).host === "localhost" && host === "localhost" && new URL(origin).protocol === "http:"; }
  catch { return false; }
}
export async function corpoSeguro(req: NextRequest): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 8192) throw new QuestionarioInvalido("Formulário muito grande.");
  const raw = await req.text();
  if (raw.length > 8192) throw new QuestionarioInvalido("Formulário muito grande.");
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new QuestionarioInvalido("Formulário inválido."); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new QuestionarioInvalido("Formulário inválido.");
  return body as Record<string, unknown>;
}
async function dono(req: NextRequest) {
  const user = await autenticarRequisicao(req);
  return { user, error: exigirRole(user, ["admin"]) };
}
function falha() {
  return NextResponse.json({ ok: false, error: "Cadastro fiscal indisponível." }, { status: 503, headers: HEADERS });
}

export async function GET(req: NextRequest) {
  const { user, error } = await dono(req);
  if (error) return error;
  if (emPreviewVercel()) return NextResponse.json({ ok: false, error: "Preview bloqueado." }, { status: 403, headers: HEADERS });
  try {
    const doc = await carregarQuestionario(user!.username);
    const conviteAtivo = await existeConvite(user!.username);
    return NextResponse.json({ ok: true, ...respostasPublicas(doc), conviteAtivo,
      importacaoDisponivel: haImportacaoPendente(user!.username, doc.respostas),
    }, { headers: HEADERS });
  } catch { return falha(); }
}

export async function POST(req: NextRequest) {
  const { user, error } = await dono(req);
  if (error) return error;
  if (emPreviewVercel()) return NextResponse.json({ ok: false, error: "Preview bloqueado." }, { status: 403, headers: HEADERS });
  if (!mesmaOrigem(req)) return NextResponse.json({ ok: false, error: "Origem não autorizada." }, { status: 403, headers: HEADERS });
  try {
    const body = await corpoSeguro(req);
    if (Object.keys(body).some(k => k !== "acao")) throw new QuestionarioInvalido("Ação inválida.");
    if (body.acao === "importar_dados_da_nota") {
      const resultado = await importarDadosConferidos(user!.username);
      if (resultado.status === "divergente" || resultado.status === "conflito_concorrencia")
        return NextResponse.json({ ok: false,
          error: "Há dados diferentes já salvos. Confira o cadastro antes de importar.",
        }, { status: 409, headers: HEADERS });
      return NextResponse.json({ ok: true, ...resultado,
        ...(resultado.status === "importado" ? respostasPublicas(resultado.cadastro) : {}),
      }, { headers: HEADERS });
    }
    if (body.acao === "criar") {
      const info = await criarConvite(user!.username);
      return NextResponse.json({ ok: true, ...info }, { headers: HEADERS });
    }
    if (body.acao === "revogar") {
      await revogarConvite(user!.username);
      return NextResponse.json({ ok: true }, { headers: HEADERS });
    }
    throw new QuestionarioInvalido("Ação inválida.");
  } catch (error) {
    if (error instanceof QuestionarioInvalido)
      return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: HEADERS });
    return falha();
  }
}

export async function PUT(req: NextRequest) {
  const { user, error } = await dono(req);
  if (error) return error;
  if (emPreviewVercel()) return NextResponse.json({ ok: false, error: "Preview bloqueado." }, { status: 403, headers: HEADERS });
  if (!mesmaOrigem(req)) return NextResponse.json({ ok: false, error: "Origem não autorizada." }, { status: 403, headers: HEADERS });
  try {
    const body = await corpoSeguro(req);
    if (Object.keys(body).some(k => !["versao", "respostas"].includes(k)) ||
        !Number.isSafeInteger(body.versao) || (body.versao as number) < 0)
      throw new QuestionarioInvalido("Versão inválida.");
    const respostas = validarRespostas(body.respostas);
    const doc = await salvarQuestionario(user!.username, body.versao as number, respostas);
    if (!doc) return NextResponse.json({ ok: false, error: "Outra pessoa salvou alterações. Atualize a página antes de continuar." }, { status: 409, headers: HEADERS });
    return NextResponse.json({ ok: true, ...respostasPublicas(doc) }, { headers: HEADERS });
  } catch(error) {
    if (error instanceof QuestionarioInvalido)
      return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: HEADERS });
    return falha();
  }
}
