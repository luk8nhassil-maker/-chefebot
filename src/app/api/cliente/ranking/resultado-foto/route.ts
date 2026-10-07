import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import {
  obterRegraJogoSecretoRanking,
} from "@/lib/consentimentoRanking";
import { obterResultadoTemporada } from "@/lib/temporadaResultado";
import { janelaRevelacaoAtiva } from "@/lib/rankingJogoSecreto";
import { lerFotoPerfilBlob, ErroFotoPerfilStorage } from "@/lib/perfilFotoStorage";

export const dynamic = "force-dynamic";
const TENANT_ID = "default";

function erro(status: number, codigo: string) {
  const res = NextResponse.json({ error: codigo }, { status });
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  const sessao = await lerSessaoCliente(req);
  if (!sessao) return erro(401, "Nao autorizado");

  const viewer = await buscarClientePorId(sessao.clienteId);
  if (!viewer) return erro(401, "Nao autorizado");
  const viewerId = derivarClienteIdPorTelefone(viewer.telefone) ?? viewer.clienteId;
  const regraViewer = await obterRegraJogoSecretoRanking(viewerId).catch(() => null);
  if (!regraViewer?.participa || !regraViewer.aceitaRevelacao30d) {
    return erro(403, "regra_jogo_inativa");
  }

  const temporadaId = req.nextUrl.searchParams.get("temporadaId")?.trim() ?? "";
  const posicao = Number(req.nextUrl.searchParams.get("posicao") ?? 0);
  if (!temporadaId || !Number.isInteger(posicao) || posicao < 1) {
    return erro(400, "parametros_invalidos");
  }

  const resultado = await obterResultadoTemporada(TENANT_ID, temporadaId);
  if (!resultado || !janelaRevelacaoAtiva(resultado.encerradaEm)) {
    return erro(404, "revelacao_indisponivel");
  }

  const alvo = resultado.participantesTopo.find((item) => item.posicao === posicao);
  if (!alvo) return erro(404, "perfil_indisponivel");

  const regraAlvo = await obterRegraJogoSecretoRanking(alvo.clienteId).catch(() => null);
  if (!regraAlvo?.participa || !regraAlvo.aceitaRevelacao30d) {
    return erro(404, "perfil_indisponivel");
  }

  const clienteAlvo = await buscarClientePorId(alvo.clienteId);
  if (!clienteAlvo?.fotoPerfilPathname) return erro(404, "foto_indisponivel");

  try {
    const blob = await lerFotoPerfilBlob(clienteAlvo.fotoPerfilPathname);
    const headers = new Headers();
    headers.set("Content-Type", clienteAlvo.fotoPerfilContentType ?? blob.headers.get("content-type") ?? "image/webp");
    headers.set("Cache-Control", "private, max-age=300, must-revalidate");
    const etag = blob.headers.get("etag");
    if (etag) headers.set("ETag", etag);
    return new Response(blob.body, { status: 200, headers });
  } catch (e) {
    if (e instanceof ErroFotoPerfilStorage) return erro(502, e.codigo);
    return erro(502, "storage_indisponivel");
  }
}
