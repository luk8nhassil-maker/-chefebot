// Retentativa curta e LIMITADA para leituras no datastore.
//
// Motivação medida no incidente de /pedidos: as leituras do datastore em
// produção falhavam de forma INTERMITENTE — três chamadas seguidas à mesma
// rota deram 500, 500, 200. Uma falha transitória assim derrubava a leitura
// inteira do painel, e o painel ficava sem pedidos.
//
// Regras deliberadas:
// - SOMENTE LEITURA. Nunca envolva uma escrita nisto: repetir uma escrita
//   que talvez tenha sido aplicada é como se cria pedido duplicado. Leitura
//   é idempotente; escrita não é.
// - Teto rígido de tentativas e espera curta. Isto não é retry agressivo:
//   no pior caso são poucas centenas de milissegundos, e o erro original é
//   repropagado intacto quando as tentativas acabam — nada de mascarar
//   falha persistente como sucesso.

export type OpcoesLeituraComRetry = {
  /** Total de tentativas, incluindo a primeira. Padrão 3. */
  tentativas?: number;
  /** Espera base entre tentativas (dobra a cada rodada). Padrão 120ms. */
  esperaBaseMs?: number;
  /** Injetável para teste — nunca use em produção. */
  dormir?: (ms: number) => Promise<void>;
  /** Chamado a cada tentativa falha, para log. Nunca pode lançar. */
  aoFalhar?: (erro: unknown, tentativa: number) => void;
};

const dormirPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Executa `ler` até `tentativas` vezes. Devolve o primeiro sucesso; se todas
 * falharem, relança o ERRO DA ÚLTIMA tentativa — quem chamou continua vendo
 * uma falha real e decide o que fazer com ela.
 */
export async function lerComRetry<T>(
  ler: () => Promise<T>,
  opcoes: OpcoesLeituraComRetry = {}
): Promise<T> {
  const total = Math.max(1, Math.floor(opcoes.tentativas ?? 3));
  const esperaBaseMs = Math.max(0, opcoes.esperaBaseMs ?? 120);
  const dormir = opcoes.dormir ?? dormirPadrao;

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= total; tentativa++) {
    try {
      return await ler();
    } catch (err) {
      ultimoErro = err;
      try { opcoes.aoFalhar?.(err, tentativa) } catch {}
      if (tentativa < total) await dormir(esperaBaseMs * 2 ** (tentativa - 1));
    }
  }
  throw ultimoErro;
}
