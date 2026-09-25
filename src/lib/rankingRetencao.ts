// Funções puras da experiência de retenção do Ranking do Chefe para quem JÁ
// participa (posição, distância para ultrapassar, disputa relativa, alvo
// atual e mensagens derivadas). Sem I/O, sem Redis, sem regra comercial
// inventada — só matemática sobre dados que o chamador já buscou.
//
// Escopo: sempre o ranking ENTRE PARTICIPANTES ("vale prêmio"), nunca o geral
// — é a única posição que importa para quem já autorizou aparecer e disputa
// o prêmio da temporada (ver docs/PRODUTO_RANKING_E_PREMIOS.md).

export type EntradaOrdenada = { posicao: number; score: number; clienteId: string };

export type IdentidadeMinima = { nomePublico: string | null; telefoneMascarado: string | null };

export type ParticipanteDisputa = {
  posicao: number;
  score: number;
  eVoce: boolean;
  nomePublico: string | null;
  telefoneMascarado: string | null;
};

export type DisputaRelativa = {
  acima: ParticipanteDisputa | null;
  voce: ParticipanteDisputa;
  abaixo: ParticipanteDisputa | null;
  sozinho: boolean;
};

export type AlvoRankingAtual =
  | { estado: "sozinho" }
  | { estado: "liderando"; vantagem: number | null }
  | { estado: "alcancar"; alvoPosicao: number; necessario: number; scoreAlvo: number };

export type VariacaoPosicaoSimples = { direcao: "subiu" | "desceu" | "manteve"; casas: number };

/**
 * Quantas estrelas a MAIS o cliente precisa ter do que quem está na posição
 * acima para garantir a ultrapassagem — nunca `scoreAcima - scoreAtual`,
 * porque em empate de score o desempate (quem chegou primeiro) mantém quem
 * já está na frente. Somar 1 garante score estritamente maior, a única
 * condição que muda a ordenação independente do desempate.
 */
export function necessarioParaUltrapassar(scoreAtual: number, scoreAcima: number): number {
  const atual = Number.isFinite(scoreAtual) ? Math.max(0, Math.round(scoreAtual)) : 0;
  const acima = Number.isFinite(scoreAcima) ? Math.max(0, Math.round(scoreAcima)) : 0;
  return Math.max(0, acima - atual + 1);
}

/**
 * Alvo atual dentro do ranking de participantes. `totalParticipantes <= 1`
 * é o único participante (nada a disputar ainda). Posição 1 (ou sem entrada
 * acima) é liderança — nunca inventa um adversário fictício acima do líder.
 */
export function calcularAlvoRankingAtual(params: {
  posicaoAtual: number;
  scoreAtual: number;
  totalParticipantes: number;
  entradaAcima: { posicao: number; score: number } | null;
  entradaAbaixo: { posicao: number; score: number } | null;
}): AlvoRankingAtual {
  const { posicaoAtual, scoreAtual, totalParticipantes, entradaAcima, entradaAbaixo } = params;
  if (totalParticipantes <= 1) return { estado: "sozinho" };
  if (posicaoAtual <= 1 || !entradaAcima) {
    const vantagem = entradaAbaixo
      ? Math.max(0, Math.round(scoreAtual) - Math.round(entradaAbaixo.score))
      : null;
    return { estado: "liderando", vantagem };
  }
  return {
    estado: "alcancar",
    alvoPosicao: entradaAcima.posicao,
    necessario: necessarioParaUltrapassar(scoreAtual, entradaAcima.score),
    scoreAlvo: entradaAcima.score,
  };
}

/**
 * "Sua disputa agora": vizinho acima, você e vizinho abaixo dentro do
 * ranking de participantes já ordenado 1..N. `null` quando o próprio cliente
 * não está nessa lista (ainda sem posição entre participantes).
 */
export function montarDisputaRelativa(params: {
  ordenados: EntradaOrdenada[];
  clienteId: string;
  identidades: ReadonlyMap<string, IdentidadeMinima>;
}): DisputaRelativa | null {
  const { ordenados, clienteId, identidades } = params;
  const index = ordenados.findIndex((entrada) => entrada.clienteId === clienteId);
  if (index < 0) return null;

  const projetar = (entrada: EntradaOrdenada | undefined, eVoce: boolean): ParticipanteDisputa | null => {
    if (!entrada) return null;
    const identidade = identidades.get(entrada.clienteId);
    return {
      posicao: entrada.posicao,
      score: entrada.score,
      eVoce,
      nomePublico: identidade?.nomePublico ?? null,
      telefoneMascarado: identidade?.telefoneMascarado ?? null,
    };
  };

  return {
    acima: projetar(ordenados[index - 1], false),
    voce: projetar(ordenados[index], true) as ParticipanteDisputa,
    abaixo: projetar(ordenados[index + 1], false),
    sozinho: ordenados.length <= 1,
  };
}

/** Texto único e neutro para o alvo atual — nunca promete prêmio ou bônus. */
export function mensagemAlvoRanking(alvo: AlvoRankingAtual): string {
  if (alvo.estado === "sozinho") {
    return "Você é o único participante desta temporada até agora.";
  }
  if (alvo.estado === "liderando") {
    if (alvo.vantagem && alvo.vantagem > 0) {
      const unidade = alvo.vantagem === 1 ? "estrela" : "estrelas";
      return `Você está na liderança, ${alvo.vantagem} ${unidade} à frente do #2.`;
    }
    return "Você está na liderança. Continue acumulando estrelas para defender a posição.";
  }
  const verbo = alvo.necessario === 1 ? "Falta" : "Faltam";
  const unidade = alvo.necessario === 1 ? "estrela" : "estrelas";
  return `${verbo} ${alvo.necessario} ${unidade} para alcançar o #${alvo.alvoPosicao}.`;
}

/**
 * Linha curta sobre o movimento real desde o snapshot anterior. `null`
 * quando não há histórico ou a posição se manteve — nunca afirma "manteve"
 * como conquista nem usa linguagem punitiva para quem desceu.
 */
export function mensagemMovimento(variacao: VariacaoPosicaoSimples | null): string | null {
  if (!variacao || variacao.direcao === "manteve") return null;
  const casasTxt = `${variacao.casas} ${variacao.casas === 1 ? "posição" : "posições"}`;
  return variacao.direcao === "subiu"
    ? `Você subiu ${casasTxt} desde ontem.`
    : `A disputa mudou. Você está ${casasTxt} abaixo de ontem.`;
}

export type MovimentoParaCreditoPedido = { pedidoId: string | null; tipo: string; pontos: number };

/**
 * Encontra o crédito confirmado do PEDIDO EXATO que trouxe o cliente de
 * volta à tela (nunca por janela de tempo) — usado para decidir se o
 * feedback pós-pedido pode sair de "pendente" para "creditado". Correção do
 * #445: a versão anterior aceitava qualquer movimento confirmado recente,
 * podendo atribuir ao pedido atual um crédito de indicação, apoio, outro
 * pedido ou ajuste. Agora só reconhece um movimento cujo `pedidoId` bate
 * exatamente com o pedido informado — cada pedido tem um id único no
 * sistema, então não há ambiguidade possível entre contas ou pedidos.
 */
export function detectarCreditoDoPedido(
  extrato: MovimentoParaCreditoPedido[],
  pedidoId: string | null | undefined,
): { pontos: number } | null {
  if (!pedidoId) return null;
  const credito = extrato.find((movimento) => movimento.pedidoId === pedidoId && movimento.tipo === "confirmado");
  return credito ? { pontos: credito.pontos } : null;
}

export type FatoPosicaoDetectado =
  | "subiu_posicao"
  | "entrou_top10"
  | "entrou_top3"
  | "chegou_top1"
  | "recuperou_lideranca"
  | "perdeu_lideranca";

/**
 * Decide quais FATOS de negócio uma variação real de posição representa —
 * pura, sem I/O. O chamador (painel/route.ts) é responsável por registrar
 * cada fato retornado de forma idempotente (rankingGamificacaoFatos.ts).
 * `jaFoiLiderNestaTemporada` distingue "chegou ao #1" (primeira vez) de
 * "recuperou a liderança" (já tinha sido #1 antes, perdeu, voltou) sem
 * precisar guardar todo o histórico de posições da temporada.
 */
export function detectarFatosDePosicao(params: {
  posicaoAnterior: number | null | undefined;
  posicaoAtual: number;
  jaFoiLiderNestaTemporada: boolean;
}): FatoPosicaoDetectado[] {
  const { posicaoAnterior, posicaoAtual, jaFoiLiderNestaTemporada } = params;
  if (posicaoAnterior === null || posicaoAnterior === undefined || posicaoAnterior === posicaoAtual) return [];

  if (posicaoAtual < posicaoAnterior) {
    const fatos: FatoPosicaoDetectado[] = ["subiu_posicao"];
    if (posicaoAtual <= 10 && posicaoAnterior > 10) fatos.push("entrou_top10");
    if (posicaoAtual <= 3 && posicaoAnterior > 3) fatos.push("entrou_top3");
    if (posicaoAtual === 1 && posicaoAnterior !== 1) {
      fatos.push(jaFoiLiderNestaTemporada ? "recuperou_lideranca" : "chegou_top1");
    }
    return fatos;
  }

  if (posicaoAnterior === 1 && posicaoAtual !== 1) return ["perdeu_lideranca"];
  return [];
}

export type ConquistaRanking =
  | { tipo: "top1" }
  | { tipo: "top3" }
  | { tipo: "top10" }
  | { tipo: "subiu"; casas: number }
  | null;

/**
 * Só reconhece uma conquista quando há SUBIDA real e recente (variação
 * "subiu" contra o snapshot anterior) — nunca a partir de estar parado numa
 * boa posição. Sem isso o banner apareceria a cada visita de quem já está no
 * Top 10 há semanas, o que é spam disfarçado de conquista, não um marco.
 */
export function detectarConquistaRanking(params: {
  posicao: number;
  variacao: VariacaoPosicaoSimples | null;
}): ConquistaRanking {
  if (params.variacao?.direcao !== "subiu") return null;
  if (params.posicao === 1) return { tipo: "top1" };
  if (params.posicao <= 3) return { tipo: "top3" };
  if (params.posicao <= 10) return { tipo: "top10" };
  return { tipo: "subiu", casas: params.variacao.casas };
}

/** Texto curto e sem PII de terceiros, pronto para Web Share API / clipboard. */
export function textoConquistaRanking(conquista: ConquistaRanking, posicao: number): string {
  if (!conquista) return `Estou em #${posicao} no Ranking do Chefe ⭐`;
  switch (conquista.tipo) {
    case "top1":
      return "Sou o #1 no Ranking do Chefe! 🏆";
    case "top3":
      return `Estou no Top 3 do Ranking do Chefe: #${posicao} ⭐`;
    case "top10":
      return `Entrei no Top 10 do Ranking do Chefe: #${posicao} ⭐`;
    case "subiu":
      return `Subi ${conquista.casas} ${conquista.casas === 1 ? "posição" : "posições"} no Ranking do Chefe. Agora estou em #${posicao} ⭐`;
  }
}
