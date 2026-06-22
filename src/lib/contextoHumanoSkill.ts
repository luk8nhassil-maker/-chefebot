// ============================================================================
// SKILL DE CONTEXTO HUMANO LOCAL
// ----------------------------------------------------------------------------
// Responde mensagens leves e fora do fluxo (humor, cansaço, indecisão ampla,
// retomada) de forma humana e curta, sem chamar a API e sem travar o pedido.
// Sempre conduz para pizza, lanche, bebida ou suco.
//
// Regras de segurança (invariantes obrigatórios):
// - Só age em steps: "category", "add_more" e "name".
// - NUNCA responde a reclamações, problemas de saúde, pagamento ou ameaças.
// - Nunca menciona R$, preço, desconto ou promoção.
// - Nunca confirma pedido nem adiciona item ao carrinho.
// - Nunca altera session — só devolve texto.
// ============================================================================

import type { BotSession } from "./bot";

function normalizar(texto: string): string {
  return (texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const STEPS_VALIDOS: BotSession["step"][] = ["category", "add_more", "name"];

// ─── Bloqueio de segurança ─────────────────────────────────────────────────────
// Qualquer sinal sensível → skill retorna null. Esses casos seguem para o fluxo
// atual / Guardião / IA / atendimento humano — nunca para resposta de venda.
const BLOCKLIST = [
  "reclamacao", "reclamo",
  "demorou", "demoro", "atraso", "atrasou",
  "pedido errado", "veio errado", "coisa errada",
  "alergia", "alergico", "alergica", "alergias",
  "passei mal", "intoxicacao", "intoxicado", "intoxicada",
  "dor de barriga", "vomitei", "vomito", "enjoo",
  "paguei", "cobrou errado", "pix errado", "estorno", "cobranca errada",
  "processo", "policia", "denunciar", "procon",
];

function contemBlocada(n: string): boolean {
  return BLOCKLIST.some(p => n.includes(normalizar(p)));
}

// ─── Grupos de detecção ───────────────────────────────────────────────────────
export type GrupoContextoHumano = "humor" | "emocao" | "indecisao" | "retomada";

// A) Humor / brincadeira / curiosidade sobre o bot
const HUMOR_TERMOS = [
  "me conta uma piada", "conta uma piada", "fala uma piada", "conta piada",
  "voce e humano", "voce e robo", "voce e um robo", "voce e bot",
  "ta falando com robo", "to falando com robo",
  "qual seu nome", "como voce se chama",
  "voce dorme", "voce come", "voce sente fome",
  "voce gosta",
];
function ehHumor(n: string): boolean {
  if (/k{3,}/.test(n)) return true;
  if (/(ha){2,}|(he){2,}|rsrs|lol\b/.test(n)) return true;
  return HUMOR_TERMOS.some(t => n.includes(normalizar(t)));
}

// B) Emoção / cansaço / fome
const EMOCAO_TERMOS = [
  "to cansado", "to cansada", "estou cansado", "estou cansada",
  "dia cansativo", "dia puxado", "dia longo",
  "hoje foi um dia", "foi um dia",
  "semana pesada", "to exausto", "to exausta",
  "to com fome", "morrendo de fome", "bateu a fome",
  "quero comer bem", "quero comer algo",
];
function ehEmocao(n: string): boolean {
  return EMOCAO_TERMOS.some(t => n.includes(normalizar(t)));
}

// C) Indecisão ampla (além do que recomendacaoSkill já cobre)
const INDECISAO_TERMOS = [
  "to sem ideia", "sem ideia nenhuma",
  "tanto faz", "tanto faz pra mim", "qualquer coisa serve",
  "me surpreende", "surpreende ai", "surpreende voce",
  "nao faco ideia", "nao faço ideia",
  "escolhe pra mim", "escolhe voce", "voce escolhe",
];
function ehIndecisao(n: string): boolean {
  return INDECISAO_TERMOS.some(t => n.includes(normalizar(t)));
}

// D) Retomada leve / encorajamento
const RETOMADA_TERMOS = [
  "bora", "vamos la", "bora la",
  "me salva",
  "pode comecar", "vamos comecar",
  "to pronto", "to pronta",
  "pode mandar", "to na sua",
];
function ehRetomada(n: string): boolean {
  return RETOMADA_TERMOS.some(t => n === normalizar(t) || n.includes(normalizar(t)));
}

// Detecta o grupo de contexto humano. Retorna null se:
// - mensagem na blocklist de segurança
// - número puro (opção de menu)
// - intenção clara de pedido (produto + ação)
// - palavra de pagamento
// - nenhum grupo reconhecido
export function detectarContextoHumano(texto: string): GrupoContextoHumano | null {
  const n = normalizar(texto);
  if (!n) return null;

  // Blocklist tem prioridade absoluta
  if (contemBlocada(n)) return null;

  // Número puro → opção de menu, não é contexto humano
  if (/^\d+$/.test(n)) return null;

  // Pagamento explícito
  if (/\bpix\b|pagamento|dinheiro|\bcartao\b/.test(n)) return null;

  // Intenção de pedido com ação + produto: "quero pizza", "manda uma bebida"
  if (/quero|manda|pode ser|vou querer|pede/.test(n) && /pizza|lanche|bebida|suco/.test(n)) return null;

  if (ehHumor(n)) return "humor";
  if (ehEmocao(n)) return "emocao";
  if (ehIndecisao(n)) return "indecisao";
  if (ehRetomada(n)) return "retomada";

  return null;
}

// ─── Templates de resposta ────────────────────────────────────────────────────

// Seleciona template deterministicamente pelo tamanho do texto (sem aleatoriedade
// não testável), garantindo variação entre frases diferentes.
function pick<T>(arr: T[], texto: string): T {
  return arr[texto.length % arr.length];
}

const RESPOSTAS_CATEGORY: Record<GrupoContextoHumano, string[]> = {
  humor: [
    "Haha! 😄 Minha especialidade são pizzas, não piadas. Quer pizza, lanche, bebida ou suco?",
    "Boa! 😄 Sou fã número 1 de pizza — mas quem decide é você. Pizza, lanche, bebida ou suco?",
    "Kkkk! 😄 Deixa eu te ajudar no que sou bom: um pedido incrível. Quer pizza, lanche, bebida ou suco?",
  ],
  emocao: [
    "Eita, dia puxado! 😊 Uma boa pizza resolve isso. Quer pizza, lanche, bebida ou suco?",
    "Entendo! 😊 A solução perfeita pra esses dias é um bom pedido. Pizza, lanche, bebida ou suco?",
    "Comida boa ajuda muito nesses momentos! 🍕 Quer pizza, lanche, bebida ou suco?",
  ],
  indecisao: [
    "Sem problema! 😊 Me fala o que você tá com mais vontade: pizza, lanche, bebida ou suco?",
    "Fica tranquila! 😄 Que tal começar pela pizza? Ou prefere lanche, bebida ou suco?",
    "Às vezes a melhor escolha é uma boa pizza! 🍕 Quer que eu te mostre o cardápio? Pizza, lanche, bebida ou suco?",
  ],
  retomada: [
    "Bora! 😊 Me diz o que vai ser: pizza, lanche, bebida ou suco?",
    "Aqui estou! 🍕 Quer pizza, lanche, bebida ou suco?",
    "Prontíssimo! 😄 Pizza, lanche, bebida ou suco — o que vai ser?",
  ],
};

const RESPOSTAS_ADD_MORE: Record<GrupoContextoHumano, string[]> = {
  humor: [
    "Haha! 😄 Quer adicionar mais alguma coisa? Bebida, suco, outro lanche ou mais pizza?",
    "Boa! 😄 Bora fechar com chave de ouro — uma bebida ou suco pra acompanhar?",
    "Kkkk! 😄 Vai querer mais alguma coisa? Bebida, suco, lanche ou outra pizza?",
  ],
  emocao: [
    "Ih, dia pesado! 😊 Uma bebida gelada pra acompanhar? Bebida, suco ou mais alguma coisa?",
    "Entendo! 😊 Pra completar o pedido — vai querer bebida, suco ou mais alguma coisa?",
    "Uma bebida ajuda muito nesses momentos! 😄 Bebida, suco, lanche ou mais pizza?",
  ],
  indecisao: [
    "Sem problema! 😊 Quer adicionar bebida, suco, outro lanche ou mais pizza?",
    "Fica tranquila! 😄 Uma bebida pra acompanhar? Ou prefere fechar o pedido?",
    "Que tal uma bebida gelada pra acompanhar? 😊 Bebida, suco, lanche ou mais pizza?",
  ],
  retomada: [
    "Bora! 😊 Vai adicionar mais alguma coisa? Bebida, suco, lanche ou mais pizza?",
    "Aqui estou! 🍕 Bebida, suco, lanche ou mais pizza — o que adiciona?",
    "Tamo junto! 😄 Bebida, suco, lanche ou mais pizza — o que adiciona?",
  ],
};

// Gera resposta local. Retorna null se estiver fora do escopo (step inválido
// ou intenção não reconhecida / blocklist) — o chamador segue para a IA.
export function gerarRespostaContextoHumano(session: BotSession, texto: string): string | null {
  if (!STEPS_VALIDOS.includes(session.step)) return null;

  const grupo = detectarContextoHumano(texto);
  if (!grupo) return null;

  const pool = session.step === "add_more"
    ? RESPOSTAS_ADD_MORE[grupo]
    : RESPOSTAS_CATEGORY[grupo];

  return pick(pool, texto);
}
