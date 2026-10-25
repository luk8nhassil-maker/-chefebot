import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { autenticarRequisicao, exigirRole } from "@/lib/apiAuth";
import { emPreviewVercel } from "@/lib/previewSafety";
import { redis } from "@/lib/redis";
import {
  CadastroFiscalInvalido, criarRascunhoFiscal, validarCadastroFiscal,
  type CadastroFiscalGuardado,
} from "@/lib/fiscal/cadastroFiscal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * Temporário: um rascunho por identidade de DONO autenticado no ChefeBot.
 * NÃO é tenantId nem autoriza operações WLG. Uma futura migração exige
 * mapear contas de dono para estabelecimentos de maneira verificável.
 */
function chavePorDono(username: string): string {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(username)) throw new Error("identidade_invalida");
  const digest = createHash("sha256").update(username, "utf8").digest("hex");
  return "fiscal:cadastro-dono:v1:" + digest;
}

async function autorizar(req: NextRequest) {
  const user = await autenticarRequisicao(req);
  return { user, erro: exigirRole(user, ["admin"]) };
}

export async function GET(req: NextRequest) {
  const { user, erro } = await autorizar(req);
  if (erro) return erro;
  if (emPreviewVercel()) return NextResponse.json(
    { ok: false, error: "Prévia sem acesso a cadastros reais." },
    { status: 403, headers: HEADERS },
  );
  try {
    const salvo = await redis.get<CadastroFiscalGuardado>(chavePorDono(user!.username));
    if (!salvo) return NextResponse.json(
      { ok: true, situacao: "nao_iniciado", cadastro: null },
      { headers: HEADERS },
    );
    if (salvo.titularConta !== user!.username || salvo.schemaVersion !== 1 ||
        salvo.situacao !== "rascunho_pendente_vinculo")
      throw new Error("dono_incompatível");
    return NextResponse.json(
      { ok: true, situacao: "rascunho_pendente_vinculo", cadastro: salvo },
      { headers: HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cadastro indisponível. Nenhuma operação fiscal foi realizada." },
      { status: 503, headers: HEADERS },
    );
  }
}

/**
 * Proprietário cadastra o próprio rascunho fiscal SEM comunicação com WLG.
 * Sem certificado, CSC, token, senha, envio fiscal ou acesso aos pedidos.
 */
export async function PUT(req: NextRequest) {
  const { user, erro } = await autorizar(req);
  if (erro) return erro;
  if (emPreviewVercel()) return NextResponse.json(
    { ok: false, error: "Prévia: gravação fiscal bloqueada." },
    { status: 403, headers: HEADERS },
  );
  // Defesa CSRF: requisição deve partir da própria origem do painel.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())
    return NextResponse.json({ ok: false, error: "Origem não autorizada." },
      { status: 403, headers: HEADERS });
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > 8192)
    return NextResponse.json({ ok: false, error: "Formulário muito grande." },
      { status: 413, headers: HEADERS });
  let dados;
  try {
    const raw = await req.text();
    if (raw.length > 8192) throw new CadastroFiscalInvalido("Formulário muito grande.");
    dados = validarCadastroFiscal(JSON.parse(raw));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof CadastroFiscalInvalido ? error.message : "Formulário inválido.",
    }, { status: 400, headers: HEADERS });
  }
  try {
    const chave = chavePorDono(user!.username);
    const salvo = await redis.get<CadastroFiscalGuardado>(chave);
    if (salvo && (salvo.titularConta !== user!.username ||
        salvo.schemaVersion !== 1 || salvo.situacao !== "rascunho_pendente_vinculo"))
      return NextResponse.json({
        ok: false, error: "Cadastro vinculado ou incompatível. Alteração bloqueada.",
      }, { status: 409, headers: HEADERS });
    const novo = criarRascunhoFiscal(user!.username, dados, new Date().toISOString());
    await redis.set(chave, novo);
    return NextResponse.json({
      ok: true, situacao: novo.situacao, cadastro: novo,
      aviso: "Cadastro salvo como rascunho. Ainda não está conectado à WLG nem autorizado a emitir.",
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({
      ok: false, error: "Falha ao salvar cadastro. Confira novamente antes de tentar.",
    }, { status: 503, headers: HEADERS });
  }
}
