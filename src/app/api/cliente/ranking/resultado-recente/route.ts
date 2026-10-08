import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { obterRegraJogoSecretoRanking } from "@/lib/consentimentoRanking";
import { listarTemporadas } from "@/lib/temporadas";
import {
  garantirResultadoTemporada,
  projetarResultadoTemporada,
} from "@/lib/temporadaResultado";
import { janelaRevelacaoAtiva } from "@/lib/rankingJogoSecreto";
import { obterResgatePremio } from "@/lib/temporadaPremioResgate";

export const dynamic = "force-dynamic";
const TENANT_ID = "default";

function resposta(body: unknown, init?: ResponseInit) {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "private, no-store, max-age=0");
  return res;
}

export async function GET(req: NextRequest) {
  const sessao = await lerSessaoCliente(req);
  if (!sessao) return resposta({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(sessao.clienteId);
  if (!cliente) return resposta({ error: "Nao autorizado" }, { status: 401 });

  const viewerId = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  const regraViewer = await obterRegraJogoSecretoRanking(viewerId).catch(() => null);
  if (!regraViewer?.participa || !regraViewer.aceitaRevelacao30d) {
    return resposta({ resultado: null, motivo: "regra_jogo_inativa" });
  }

  try {
    const temporadas = await listarTemporadas(TENANT_ID);
    const encerradas = temporadas
      .filter((item) => item.estado === "encerrada" && item.encerradaEm && janelaRevelacaoAtiva(item.encerradaEm))
      .sort((a, b) => Date.parse(b.encerradaEm ?? "") - Date.parse(a.encerradaEm ?? ""));

    const ultima = encerradas[0];
    if (!ultima) return resposta({ resultado: null });

    const bruto = await garantirResultadoTemporada(TENANT_ID, ultima.temporadaId);
    if (!bruto || !janelaRevelacaoAtiva(bruto.encerradaEm)) {
      return resposta({ resultado: null });
    }

    const resultado = await projetarResultadoTemporada(bruto);
    const participantesArquivados = Array.isArray(bruto.participantesTopo) ? bruto.participantesTopo : [];
    const vencedor = participantesArquivados.find((item) => item.clienteId === viewerId) ?? null;
    const quantidadePremiados = bruto.premioQuantidadePremiados ?? null;
    const souVencedor = Boolean(
      bruto.vencedorDeclarado &&
      vencedor &&
      quantidadePremiados !== null &&
      vencedor.posicao <= quantidadePremiados,
    );
    const resgate = souVencedor
      ? await obterResgatePremio(TENANT_ID, resultado.temporadaId, viewerId).catch(() => null)
      : null;
    return resposta({
      resultado: {
        temporadaId: resultado.temporadaId,
        encerradaEm: resultado.encerradaEm,
        revelacaoAte: resultado.revelacaoAte,
        premioDescricao: resultado.premioDescricao,
        premio: {
          descricao: resultado.premioDescricao,
          quantidadePremiados,
          posicao: vencedor?.posicao ?? null,
          souVencedor,
          podeResgatar: souVencedor && !resgate,
          status: resgate?.status ?? null,
          codigoPublico: resgate?.codigoPublico ?? null,
        },
        participantesTopo: resultado.participantesTopo
          .filter((item) => item.identidade.participaCampanha)
          .slice(0, 20)
          .map((item) => ({
            posicao: item.posicao,
            score: item.score,
            identidade: {
              participaCampanha: item.identidade.participaCampanha,
              nomePublico: item.identidade.nomePublico,
              fotoPerfilUrl: item.identidade.fotoPerfilUrl,
              codinomeSecreto: item.identidade.codinomeSecreto,
              revelado: item.identidade.revelado,
            },
          })),
      },
    });
  } catch {
    return resposta({ resultado: null, error: "resultado_indisponivel" }, { status: 503 });
  }
}
