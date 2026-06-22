// ============================================================================
// SKILL LOCAL DE RECOMENDAÇÃO HUMANIZADA
// ----------------------------------------------------------------------------
// Responde intenções de recomendação/indecisão sem chamar a API. Funciona como
// curto-circuito dentro do resolverFallbackInteligente: se a mensagem é "o que
// você me sugere?", "não sei o que pedir", "quero algo barato", etc., devolve
// uma resposta local humanizada e conduz o cliente para uma das categorias.
//
// Regras de segurança (invariantes obrigatórios):
// - Só age em step "category" ou "add_more".
// - Nunca menciona valor, R$, desconto ou promoção.
// - Nunca confirma pedido nem adiciona item ao carrinho.
// - Nunca altera session — só devolve texto.
// ============================================================================

import type { BotSession } from "./bot";

function normalizar(texto: string): string {
  return (texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const STEPS_VALIDOS: BotSession["step"][] = ["category", "add_more"];

// ─── Grupos de intenção ───────────────────────────────────────────────────────

const SUGESTAO = [
  "o que voce sugere", "o que voces sugere", "me sugere", "voce sugere",
  "qual voce indica", "voce indica", "me indica", "o que me indica",
  "o que indica", "me recomenda", "voce recomenda", "o que recomenda",
  "o que devo pedir", "o que voce pede",
];

const INDECISAO = [
  "nao sei o que pedir", "nao sei escolher", "to em duvida", "estou em duvida",
  "em duvida", "fico em duvida", "sem ideia", "nao sei por onde comecar",
  "nao sei o que quero",
];

const BARATO = [
  "algo barato", "coisa barata", "mais barato", "mais em conta",
  "economico", "economizar", "mais economico", "preco bom", "preco acessivel",
  "custo beneficio", "custo-beneficio",
];

const POPULAR = [
  "qual mais pedido", "o que sai mais", "mais vendido", "mais popular",
  "algo bom", "coisa boa", "o melhor", "o que e bom", "o que e gostoso",
  "o mais gostoso", "top aqui", "o que tem de bom", "o que tem de melhor",
];

const FOME = [
  "com fome", "to com fome", "morrendo de fome", "bateu a fome", "bateu aquela fome",
  "comer bem", "quero comer", "bora comer",
  "surpreende", "me surpreende", "surpreende ai",
];

function contemAlguma(n: string, lista: string[]): boolean {
  return lista.some(p => n.includes(p));
}

// Seleciona template de forma determinística baseada no tamanho do texto,
// garantindo variação entre frases diferentes sem aleatoriedade não testável.
function pick<T>(arr: T[], texto: string): T {
  return arr[texto.length % arr.length];
}

export type IntencaoRecomendacao = "sugestao" | "indecisao" | "barato" | "popular" | "fome";

export function detectarIntencaoRecomendacao(texto: string): IntencaoRecomendacao | null {
  const n = normalizar(texto);
  if (contemAlguma(n, SUGESTAO)) return "sugestao";
  if (contemAlguma(n, INDECISAO)) return "indecisao";
  if (contemAlguma(n, BARATO)) return "barato";
  if (contemAlguma(n, POPULAR)) return "popular";
  if (contemAlguma(n, FOME)) return "fome";
  return null;
}

// ─── Templates de resposta ────────────────────────────────────────────────────

const RESPOSTAS_SUGESTAO = [
  "Nossa pizza é pra lá de boa! 🍕 Mas temos também lanches, bebidas e sucos. O que te chama mais?",
  "Indicaria uma boa pizza pra começar 😊 Mas temos lanche, bebida e suco também. O que prefere?",
  "Por aqui a pizza faz muito sucesso! Quer ir de pizza, lanche, bebida ou suco?",
];

const RESPOSTAS_INDECISAO = [
  "Sem problema! 😊 Temos pizza, lanches, bebidas e sucos. Qual categoria te anima?",
  "Fica tranquila! 😄 Pizza, lanche, bebida ou suco — o que você tiver mais vontade?",
  "Acontece! 😊 Pizza, lanche, bebida ou suco — por onde quer começar?",
];

const RESPOSTAS_BARATO = [
  "Nossos lanches são bem em conta e muito saborosos! 😊 Quer ver os lanches, ou prefere pizza, bebida ou suco?",
  "Boa escolha! Lanches são ótima pedida pra economizar 🙌 Quer lanche, pizza, bebida ou suco?",
  "Mini-Pizza e X-Burguer são muito pedidos e bem em conta! Quer ver os lanches ou prefere pizza, bebida ou suco?",
];

const RESPOSTAS_POPULAR = [
  "Pizza Calabresa e Frango Catupiry são as mais pedidas aqui! 🍕 Quer pizza, lanche, bebida ou suco?",
  "Nossa pizza de Calabresa é campeã de pedidos! 🍕 Quer pizza, lanche, bebida ou suco?",
  "Pizza é sempre a mais pedida, mas nossos lanches também fazem sucesso! 😋 O que prefere?",
];

const RESPOSTAS_FOME = [
  "Boa! 😄 Pizza, lanche, bebida ou suco — me fala o que você tá a fim e já te ajudo!",
  "Pra matar a fome de vez, pizza é sempre certeiro! 🍕 Quer pizza, lanche, bebida ou suco?",
  "Então vem de pizza! 🍕 Ou se preferir, temos lanches, bebidas e sucos também. O que chama mais?",
];

const RESPOSTAS_ADD_MORE = [
  "Para acompanhar, uma bebida ou suco cai muito bem! 😊 Quer bebida, suco, ou mais pizza ou lanche?",
  "Que tal uma bebida pra acompanhar? 😄 Temos refrigerante, suco e mais. O que adiciona?",
  "Para fechar com chave de ouro, que tal uma bebida ou suco? 😊 Ou quer mais algum item?",
];

// Gera uma recomendação local. Retorna null se estiver fora do escopo (step
// inválido ou intenção não reconhecida) — o chamador segue para o brain/IA.
export function gerarRecomendacaoLocal(session: BotSession, texto: string): string | null {
  if (!STEPS_VALIDOS.includes(session.step)) return null;

  const intencao = detectarIntencaoRecomendacao(texto);
  if (!intencao) return null;

  if (session.step === "add_more") {
    return pick(RESPOSTAS_ADD_MORE, texto);
  }

  switch (intencao) {
    case "sugestao":  return pick(RESPOSTAS_SUGESTAO, texto);
    case "indecisao": return pick(RESPOSTAS_INDECISAO, texto);
    case "barato":    return pick(RESPOSTAS_BARATO, texto);
    case "popular":   return pick(RESPOSTAS_POPULAR, texto);
    case "fome":      return pick(RESPOSTAS_FOME, texto);
  }
}
