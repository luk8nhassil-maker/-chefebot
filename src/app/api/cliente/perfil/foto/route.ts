import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId, registrarFotoPerfilCliente } from "@/lib/clientes";
import { concederBonusMissaoFotoRanking } from "@/lib/rankingMissaoFotoPerfil";
import {
  ErroFotoPerfilStorage,
  lerFotoPerfilBlob,
  salvarFotoPerfilBlob,
  validarFotoPerfil,
} from "@/lib/perfilFotoStorage";

export const dynamic = "force-dynamic";

const FOTO_REQUEST_MAX_BYTES = 900 * 1024;

function statusErro(erro: ErroFotoPerfilStorage): number {
  if (erro.codigo === "arquivo_invalido" || erro.codigo === "tipo_nao_permitido" || erro.codigo === "conteudo_invalido") return 400;
  if (erro.codigo === "arquivo_muito_grande") return 413;
  if (erro.codigo === "storage_nao_configurado") return 503;
  return 502;
}

export async function GET(req: NextRequest) {
  const sessao = await lerSessaoCliente(req);
  if (!sessao) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const cliente = await buscarClientePorId(sessao.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  if (!cliente.fotoPerfilPathname) return NextResponse.json({ error: "Foto nao cadastrada" }, { status: 404 });

  try {
    const blob = await lerFotoPerfilBlob(cliente.fotoPerfilPathname);
    const headers = new Headers();
    headers.set("Content-Type", cliente.fotoPerfilContentType ?? blob.headers.get("content-type") ?? "image/webp");
    headers.set("Cache-Control", "private, max-age=3600, must-revalidate");
    const etag = blob.headers.get("etag");
    if (etag) headers.set("ETag", etag);
    return new Response(blob.body, { status: 200, headers });
  } catch (erro) {
    if (erro instanceof ErroFotoPerfilStorage) {
      return NextResponse.json({ error: erro.codigo }, { status: statusErro(erro) });
    }
    return NextResponse.json({ error: "storage_indisponivel" }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const tamanhoDeclarado = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(tamanhoDeclarado) && tamanhoDeclarado > FOTO_REQUEST_MAX_BYTES) {
    return NextResponse.json({ error: "arquivo_muito_grande" }, { status: 413 });
  }

  const sessao = await lerSessaoCliente(req);
  if (!sessao) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  const cliente = await buscarClientePorId(sessao.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  let arquivo: File | null = null;
  try {
    const form = await req.formData();
    const valor = form.get("foto");
    arquivo = valor instanceof File ? valor : null;
  } catch {}
  if (!arquivo) return NextResponse.json({ error: "arquivo_invalido" }, { status: 400 });

  try {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const contentType = validarFotoPerfil(arquivo.type, bytes);
    const blob = await salvarFotoPerfilBlob({ clienteId: cliente.clienteId, bytes, contentType });
    const atualizado = await registrarFotoPerfilCliente(cliente.telefone, {
      pathname: blob.pathname,
      contentType,
    });

    let rankingBonus: Awaited<ReturnType<typeof concederBonusMissaoFotoRanking>> | null = null;
    let rankingBonusPendente = false;
    try {
      rankingBonus = await concederBonusMissaoFotoRanking({
        tenantId: "default",
        cliente: atualizado,
      });
    } catch {
      // A foto já foi salva. Uma falha temporária no bônus não apaga a foto
      // nem declara pontos que não foram confirmados. Um novo upload permite
      // retentar a concessão enquanto o marco permanente ainda não existir.
      rankingBonusPendente = true;
    }

    return NextResponse.json({
      ok: true,
      missaoFotoPerfilConcluida: true,
      fotoPerfilAtualizadaEm: atualizado.fotoPerfilAtualizadaEm,
      fotoUrl: `/api/cliente/perfil/foto?v=${encodeURIComponent(atualizado.fotoPerfilAtualizadaEm ?? "")}`,
      rankingBonus,
      rankingBonusPendente,
    });
  } catch (erro) {
    if (erro instanceof ErroFotoPerfilStorage) {
      return NextResponse.json({ ok: false, error: erro.codigo }, { status: statusErro(erro) });
    }
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
