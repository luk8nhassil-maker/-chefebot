import {
  avaliarElegibilidadeContatoPesquisa,
  type ContextoSupressaoPesquisa,
  type ResultadoElegibilidadeContatoPesquisa,
} from "./pesquisaPreferenciaContato";
import { listarContatosPesquisaPorTelefone } from "./pesquisaPreferenciaContatosRedis";

/**
 * Ponte server-side entre o histórico persistido de contatos de pesquisa
 * e o gate puro de elegibilidade.
 *
 * Não envia mensagem e não grava nada. Apenas lê o orçamento prospectivo já
 * registrado e aplica as mesmas regras de 14 dias / 3 em 90.
 */
export async function avaliarElegibilidadeContatoPesquisaPorTelefone(params: {
  telefone?: string;
  agoraMs?: number;
  contexto: ContextoSupressaoPesquisa;
}): Promise<ResultadoElegibilidadeContatoPesquisa> {
  const agoraMs = params.agoraMs ?? Date.now();
  const historicoContatos = await listarContatosPesquisaPorTelefone({
    telefone: params.telefone,
    agoraMs,
  });

  return avaliarElegibilidadeContatoPesquisa({
    agoraMs,
    contexto: params.contexto,
    historicoContatos,
  });
}
