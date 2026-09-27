import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import {
  ErroFotoPerfil,
  ErroFotoPerfilStorage,
  missaoFotoPerfilConcluida,
  obterFotoPerfilDataUrl,
  salvarFotoPerfilCliente,
} from "@/lib/fotoPerfilCliente";

export const dynamic = "force-dynamic";
const MAX_CORPO_BYTES = 96 * 1024;

function resposta(body: unknown, init?: ResponseInit) {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}

async function resolverCliente(req: NextRequest): Promise<{ clienteId: string } | null> {
  const sessao = await lerSessaoCliente(req);
  if (!sessao) return null;
  const cliente = await buscarClientePorId(sessao.clienteId);
  if (!cliente) return null;
  return { clienteId: derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId };
}

export async function GET(req: NextRequest) {
  const cliente = await resolverCliente(req);
  if (!cliente) return resposta({ error: "Nao autorizado" }, { status: 401 });

  const missaoConcluida = await missaoFotoPerfilConcluida(cliente.clienteId).catch(() => false);
  try {
    const foto = await obterFotoPerfilDataUrl(cliente.clienteId);
    return resposta({ foto, missaoConcluida });
  } catch (erro) {
    if (erro instanceof ErroFotoPerfilStorage) {
      // Falha de mídia nunca desfaz a missão já concluída nem simula logout.
      return resposta({ foto: null, fotoIndisponivel: true, missaoConcluida });
    }
    return resposta({ foto: null, missaoConcluida });
  }
}

export async function PUT(req: NextRequest) {
  const cliente = await resolverCliente(req);
  if (!cliente) return resposta({ error: "Nao autorizado" }, { status: 401 });

  const tamanhoInformado = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(tamanhoInformado) && tamanhoInformado > MAX_CORPO_BYTES) {
    return resposta({ error: "A foto ficou grande demais. Escolha outra imagem." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return resposta({ error: "Corpo invalido" }, { status: 400 });
  }

  try {
    const salvo = await salvarFotoPerfilCliente(cliente.clienteId, body.dataUrl);
    return resposta({
      ok: true,
      foto: {
        dataUrl: typeof body.dataUrl === "string" ? body.dataUrl : null,
        updatedAt: salvo.foto.updatedAt,
      },
      missaoConcluida: true,
    });
  } catch (erro) {
    if (erro instanceof ErroFotoPerfil) {
      const mensagem = erro.codigo === "arquivo_grande"
        ? "A foto ficou grande demais. Escolha outra imagem."
        : "Não conseguimos usar essa imagem. Escolha uma foto JPG, PNG ou WebP.";
      return resposta({ error: mensagem }, { status: 400 });
    }
    if (erro instanceof ErroFotoPerfilStorage) {
      return resposta({
        error: "O armazenamento de fotos está indisponível agora. Seu presente continua garantido; tente novamente mais tarde.",
      }, { status: 503 });
    }
    return resposta({ error: "Erro interno" }, { status: 500 });
  }
}
