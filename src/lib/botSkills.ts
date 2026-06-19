/**
 * botSkills.ts — Camada central de conhecimento do ChefeBot
 *
 * Propósito: registrar regras de entendimento humano de forma organizada.
 * Novas intenções/frases devem ser adicionadas aqui, nunca espalhadas no bot.ts.
 *
 * Esta camada é SOMENTE LEITURA em relação ao fluxo principal:
 * não altera sessão, não dispara respostas — só classifica intenções.
 *
 * SKILL ATIVA: detectarTipoRecebimento() — fonte única de verdade para
 * delivery / retirada / consumo no local. Usada pelo bot.ts em dois pontos:
 *   • detectaTipoEntregaCompleto() (pedido completo numa mensagem)
 *   • case "delivery_type" (step de escolha de recebimento)
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type Intencao =
  | "cardapio"
  | "iniciar_pedido"
  | "delivery"
  | "retirada"
  | "consumo_local"
  | "escalar"
  | "pagamento_pix"
  | "pagamento_dinheiro"
  | "pagamento_cartao"
  | "informar_bairro"
  | "informar_endereco"
  | "adicionar_bebida"
  | "adicionar_pizza"
  | "finalizar_pedido"
  | "pedido_completo"
  | "desconhecida";

export interface DadosDetectados {
  tamanho?: string;
  sabores?: string[];
  borda?: string;
  recebimento?: "delivery" | "retirada" | "consumo_local";
  pagamento?: string;
  bairro?: string;
  endereco?: string;
}

export interface ResultadoIntencao {
  intent: Intencao;
  confidence: "alta" | "media" | "baixa";
  dadosDetectados?: DadosDetectados;
}

// ---------------------------------------------------------------------------
// Contexto de detecção (step atual do bot, para desambiguação)
// ---------------------------------------------------------------------------

export interface ContextoIntencao {
  step?: string;
}

// ---------------------------------------------------------------------------
// Normalização interna (independente do bot.ts)
// ---------------------------------------------------------------------------

function n(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Base de conhecimento: frases por intenção
// ---------------------------------------------------------------------------

const FRASES_CARDAPIO = [
  "cardapio", "menu", "ver sabor", "ver opcoes", "o que tem",
  "o que voces tem", "quais sao os sabores", "tem o que", "manda o cardapio",
  "quero o cardapio", "mostra o cardapio", "que pizza tem", "que sabores",
];

const FRASES_INICIAR_PEDIDO = [
  "quero pedir", "quero uma pizza", "queria pedir", "vou querer",
  "pode anotar", "anota ai", "faz um pedido", "quero fazer um pedido",
  "manda uma pizza", "traz uma pizza",
];

// ---------------------------------------------------------------------------
// SKILL: Tipo de recebimento — fonte única de verdade
// Adicionar novos sinônimos aqui, nunca nos arquivos de fluxo.
// ---------------------------------------------------------------------------

// Palavras que exigem match de palavra inteira (evitam falsos positivos)
const KEYWORDS_RECEBIMENTO_WORD: { type: "dine_in" | "delivery" | "pickup"; word: string }[] = [
  { type: "dine_in",  word: "local" },
  { type: "dine_in",  word: "mesa"  },
];

// Substrings simples, por ordem de prioridade (dine_in antes de delivery/pickup)
const KEYWORDS_RECEBIMENTO: { type: "dine_in" | "delivery" | "pickup"; kw: string }[] = [
  // --- consumo no local ---
  { type: "dine_in", kw: "consumo no local"  },
  { type: "dine_in", kw: "consumir no local" },
  { type: "dine_in", kw: "comer ai"          },
  { type: "dine_in", kw: "comer aqui"        },
  { type: "dine_in", kw: "comer na pizzaria" },
  { type: "dine_in", kw: "vou comer"         },
  { type: "dine_in", kw: "comer no local"    },
  { type: "dine_in", kw: "consumo local"     },
  { type: "dine_in", kw: "consumir"          },
  { type: "dine_in", kw: "aqui mesmo"        },
  { type: "dine_in", kw: "na mesa"           },
  // --- delivery ---
  { type: "delivery", kw: "entrega"           },
  { type: "delivery", kw: "delivery"          },
  { type: "delivery", kw: "entregar"          },
  { type: "delivery", kw: "minha casa"        },
  { type: "delivery", kw: "em casa"           },
  { type: "delivery", kw: "manda ai"          },
  { type: "delivery", kw: "manda entregar"    },
  { type: "delivery", kw: "manda em casa"     },
  { type: "delivery", kw: "no meu endereco"   },
  // --- retirada ---
  { type: "pickup",  kw: "retirar"            },
  { type: "pickup",  kw: "retirada"           },
  { type: "pickup",  kw: "buscar"             },
  { type: "pickup",  kw: "busco ai"           },
  { type: "pickup",  kw: "pegar"              },
  { type: "pickup",  kw: "retiro"             },
  { type: "pickup",  kw: "na loja"            },
  { type: "pickup",  kw: "vou buscar"         },
  { type: "pickup",  kw: "passo pra pegar"    },
];

export interface ResultadoRecebimento {
  type: "delivery" | "pickup" | "dine_in";
  confidence: "alta" | "media";
  matchedBy: string;
}

/**
 * Detecta o tipo de recebimento numa mensagem.
 * Aceita texto cru ou já normalizado (normalização é idempotente).
 * Retorna null se nenhum padrão conhecido for reconhecido.
 */
export function detectarTipoRecebimento(mensagem: string): ResultadoRecebimento | null {
  const norm = n(mensagem);
  // word-boundary primeiro (evitam "local" dentro de outras palavras)
  for (const { type, word } of KEYWORDS_RECEBIMENTO_WORD) {
    if (new RegExp(`\\b${word}\\b`).test(norm)) {
      return { type, confidence: "alta", matchedBy: word };
    }
  }
  for (const { type, kw } of KEYWORDS_RECEBIMENTO) {
    if (norm.includes(kw)) return { type, confidence: "alta", matchedBy: kw };
  }
  return null;
}

// Aliases internos para compatibilidade com detectaRecebimentoInterno
const FRASES_CONSUMO_LOCAL = KEYWORDS_RECEBIMENTO
  .filter(k => k.type === "dine_in").map(k => k.kw);
const FRASES_DELIVERY = KEYWORDS_RECEBIMENTO
  .filter(k => k.type === "delivery").map(k => k.kw);
const FRASES_RETIRADA = KEYWORDS_RECEBIMENTO
  .filter(k => k.type === "pickup").map(k => k.kw);

const FRASES_ESCALAR = [
  "falar com atendente", "falar com humano", "atendente", "atendimento humano",
  "falar com pessoa", "quero falar com alguem", "me transfere", "gerente",
  "responsavel", "dono", "reclamacao", "reclamar",
];

const FRASES_FINALIZAR = [
  "pode fechar", "finaliza", "fecha o pedido", "finalizar", "encerrar",
  "so isso", "ta bom assim", "e so", "pode confirmar", "confirma",
  "fechou", "ta certo", "pode mandar",
];

const FRASES_ADICIONAR_BEBIDA = [
  "bebida", "refrigerante", "suco", "agua", "cerveja", "guarana",
  "coca", "pepsi", "vitamina", "coca-cola",
];

const FRASES_ADICIONAR_PIZZA = [
  "mais uma pizza", "outra pizza", "segunda pizza", "mais pizza",
  "adicionar pizza", "quero outra", "mais uma",
];

const PALAVRAS_PIX = ["pix", "transferencia", "transfer"];
const PALAVRAS_DINHEIRO = ["dinheiro", "especie", "cash", "a vista"];
const PALAVRAS_CARTAO = ["cartao", "credito", "debito", "maquina"];

const TAMANHOS: Record<string, string> = {
  "pequena": "P", "pequen": "P",
  "media": "M", "medio": "M",
  "grande": "G", "grand": "G",
  "familia": "F", "famil": "F",
};

const BORDAS_SEM = ["sem borda", "sem", "nao quero borda", "nenhuma borda"];

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function incluiAlguma(texto: string, frases: string[]): boolean {
  return frases.some(f => texto.includes(f));
}

function detectaTamanhoInterno(texto: string): string | undefined {
  for (const [chave, valor] of Object.entries(TAMANHOS)) {
    if (texto.includes(chave)) return valor;
  }
  return undefined;
}

function detectaPagamentoInterno(texto: string): string | undefined {
  if (PALAVRAS_PIX.some(p => texto.includes(p))) return "Pix";
  if (PALAVRAS_DINHEIRO.some(p => texto.includes(p))) return "Dinheiro";
  if (PALAVRAS_CARTAO.some(p => texto.includes(p))) return "Cartão";
  return undefined;
}

function detectaRecebimentoInterno(texto: string): DadosDetectados["recebimento"] | undefined {
  if (incluiAlguma(texto, FRASES_CONSUMO_LOCAL)) return "consumo_local";
  if (incluiAlguma(texto, FRASES_DELIVERY)) return "delivery";
  if (incluiAlguma(texto, FRASES_RETIRADA)) return "retirada";
  return undefined;
}

function detectaEnderecoInterno(texto: string): string | undefined {
  const m = texto.match(/\b(?:rua|avenida|av\.|travessa|alameda|estrada|quadra)\s+[\wÀ-ú\s,\d]+/i);
  return m ? m[0].trim().slice(0, 100) : undefined;
}

// ---------------------------------------------------------------------------
// Função principal exportada
// ---------------------------------------------------------------------------

export function detectarIntencaoDoCliente(
  mensagem: string,
  contexto?: ContextoIntencao
): ResultadoIntencao {
  const norm = n(mensagem);
  const ctx = contexto?.step ?? "";

  // --- Escalar (alta prioridade) ---
  if (incluiAlguma(norm, FRASES_ESCALAR)) {
    return { intent: "escalar", confidence: "alta" };
  }

  // --- Finalizar pedido ---
  if (incluiAlguma(norm, FRASES_FINALIZAR)) {
    return { intent: "finalizar_pedido", confidence: "alta" };
  }

  // --- Cardápio ---
  if (incluiAlguma(norm, FRASES_CARDAPIO)) {
    return { intent: "cardapio", confidence: "alta" };
  }

  // --- Pagamento ---
  const pagamento = detectaPagamentoInterno(norm);
  if (pagamento && (ctx === "payment" || ctx === "")) {
    const map: Record<string, Intencao> = {
      "Pix": "pagamento_pix",
      "Dinheiro": "pagamento_dinheiro",
      "Cartão": "pagamento_cartao",
    };
    return { intent: map[pagamento], confidence: "alta", dadosDetectados: { pagamento } };
  }

  // --- Consumo no local ---
  if (incluiAlguma(norm, FRASES_CONSUMO_LOCAL)) {
    return {
      intent: "consumo_local",
      confidence: "alta",
      dadosDetectados: { recebimento: "consumo_local" },
    };
  }

  // --- Delivery ---
  if (incluiAlguma(norm, FRASES_DELIVERY)) {
    return {
      intent: "delivery",
      confidence: "alta",
      dadosDetectados: { recebimento: "delivery" },
    };
  }

  // --- Retirada ---
  if (incluiAlguma(norm, FRASES_RETIRADA)) {
    return {
      intent: "retirada",
      confidence: "alta",
      dadosDetectados: { recebimento: "retirada" },
    };
  }

  // --- Adicionar bebida ---
  if (incluiAlguma(norm, FRASES_ADICIONAR_BEBIDA) && ctx === "add_more") {
    return { intent: "adicionar_bebida", confidence: "alta" };
  }

  // --- Adicionar pizza ---
  if (incluiAlguma(norm, FRASES_ADICIONAR_PIZZA)) {
    return { intent: "adicionar_pizza", confidence: "alta" };
  }

  // --- Iniciar pedido ---
  if (incluiAlguma(norm, FRASES_INICIAR_PEDIDO)) {
    return { intent: "iniciar_pedido", confidence: "alta" };
  }

  // --- Pedido completo (tamanho + recebimento + pagamento detectados juntos) ---
  const tamanho = detectaTamanhoInterno(norm);
  const recebimento = detectaRecebimentoInterno(norm);
  const pagamentoPedido = detectaPagamentoInterno(norm);
  const temBorda = !incluiAlguma(norm, BORDAS_SEM);
  const endereco = detectaEnderecoInterno(mensagem);

  const camposDetectados = [tamanho, recebimento, pagamentoPedido].filter(Boolean).length;
  if (camposDetectados >= 2) {
    return {
      intent: "pedido_completo",
      confidence: camposDetectados === 3 ? "alta" : "media",
      dadosDetectados: {
        ...(tamanho ? { tamanho } : {}),
        ...(recebimento ? { recebimento } : {}),
        ...(pagamentoPedido ? { pagamento: pagamentoPedido } : {}),
        ...(!temBorda ? { borda: "sem borda" } : {}),
        ...(endereco ? { endereco } : {}),
      },
    };
  }

  // --- Informar endereço ---
  if (endereco && ctx === "address") {
    return {
      intent: "informar_endereco",
      confidence: "alta",
      dadosDetectados: { endereco },
    };
  }

  return { intent: "desconhecida", confidence: "baixa" };
}

// ---------------------------------------------------------------------------
// SKILL: Forma de pagamento — fonte única de verdade
// Adicionar novos sinônimos aqui, nunca nos arquivos de fluxo.
// ---------------------------------------------------------------------------

// Substrings simples por método (ordem importa apenas dentro de cada grupo)
const KEYWORDS_PIX: string[] = [
  "pix", "transfer", "transferencia", "chave pix", "manda o pix",
  "qual a chave", "vou pagar no pix", "pago no pix",
];

const KEYWORDS_DINHEIRO: string[] = [
  "dinheiro", "especie", "cash", "a vista", "pago em dinheiro",
  "vou pagar em dinheiro", "pago na entrega em dinheiro",
];

const KEYWORDS_CARTAO: string[] = [
  "cartao", "credito", "debito", "maquininha", "maquina",
  "pago no cartao", "cartao na entrega",
];

// Palavras-chave para word-boundary (evitam falsos positivos em substrings)
const KEYWORDS_PIX_WORD: string[] = ["pix"];

export type TipoPagamento = "pix" | "cash" | "card" | "mixed" | null;
export type MetodoPagamento = "pix" | "cash" | "card";

export interface ResultadoPagamento {
  type: TipoPagamento;
  confidence: "high" | "medium" | "low";
  matchedBy?: string;
  needsChange?: boolean;
  changeFor?: number;
  mixedMethods?: MetodoPagamento[];
}

function detectaMetodo(norm: string): { method: MetodoPagamento; matchedBy: string } | null {
  // PIX com word-boundary (evita "fênix" → "fenix" que contém "nix", não "pix")
  for (const kw of KEYWORDS_PIX_WORD) {
    if (new RegExp(`\\b${kw}\\b`).test(norm)) return { method: "pix", matchedBy: kw };
  }
  // PIX por substring (frases compostas como "vou pagar no pix" — "pix" já cobre, mas mantém frases explícitas)
  for (const kw of KEYWORDS_PIX) {
    if (kw !== "pix" && norm.includes(kw)) return { method: "pix", matchedBy: kw };
  }
  for (const kw of KEYWORDS_DINHEIRO) {
    if (norm.includes(kw)) return { method: "cash", matchedBy: kw };
  }
  for (const kw of KEYWORDS_CARTAO) {
    if (norm.includes(kw)) return { method: "card", matchedBy: kw };
  }
  return null;
}

function detectaTroco(norm: string): { needsChange: boolean; changeFor?: number } {
  if (norm.includes("sem troco") || norm.includes("nao precisa de troco")) {
    return { needsChange: false };
  }
  const trocoMatch = norm.match(/troco\s+(?:de\s+|para\s+|pra\s+|p\/?\s*)?(\d+(?:[.,]\d+)?)/);
  if (trocoMatch) {
    return { needsChange: true, changeFor: parseFloat(trocoMatch[1].replace(",", ".")) };
  }
  if (norm.includes("troco")) return { needsChange: true };
  return { needsChange: false };
}

/**
 * Detecta forma de pagamento numa mensagem.
 * Aceita texto cru ou já normalizado (normalização é idempotente).
 *
 * Pagamento misto é DETECTADO mas o processamento de split de valores
 * permanece em bot.ts (detectaPagamentoHibrido), por envolver cálculos
 * de total que dependem do carrinho — fora do escopo desta skill.
 */
export function detectarFormaPagamento(mensagem: string): ResultadoPagamento {
  const norm = n(mensagem);

  // Verifica todos os métodos presentes na mensagem
  const metodosPresentes: { method: MetodoPagamento; matchedBy: string }[] = [];

  // PIX word-boundary
  for (const kw of KEYWORDS_PIX_WORD) {
    if (new RegExp(`\\b${kw}\\b`).test(norm)) {
      metodosPresentes.push({ method: "pix", matchedBy: kw });
      break;
    }
  }
  // PIX frases compostas
  if (!metodosPresentes.some(m => m.method === "pix")) {
    for (const kw of KEYWORDS_PIX) {
      if (kw !== "pix" && norm.includes(kw)) {
        metodosPresentes.push({ method: "pix", matchedBy: kw });
        break;
      }
    }
  }
  for (const kw of KEYWORDS_DINHEIRO) {
    if (norm.includes(kw)) { metodosPresentes.push({ method: "cash", matchedBy: kw }); break; }
  }
  for (const kw of KEYWORDS_CARTAO) {
    if (norm.includes(kw)) { metodosPresentes.push({ method: "card", matchedBy: kw }); break; }
  }

  const troco = detectaTroco(norm);

  // Pagamento misto: 2+ métodos detectados
  if (metodosPresentes.length >= 2) {
    return {
      type: "mixed",
      confidence: "high",
      matchedBy: metodosPresentes.map(m => m.matchedBy).join(" + "),
      mixedMethods: metodosPresentes.map(m => m.method),
      ...troco,
    };
  }

  if (metodosPresentes.length === 1) {
    const { method, matchedBy } = metodosPresentes[0];
    return {
      type: method,
      confidence: "high",
      matchedBy,
      // troco só faz sentido em dinheiro, mas detectamos sempre (fluxo decide o que usar)
      ...(troco.needsChange ? troco : {}),
    };
  }

  // "troco" sem método explícito → implica dinheiro
  if (troco.needsChange) {
    return {
      type: "cash",
      confidence: "medium",
      matchedBy: "troco",
      ...troco,
    };
  }

  return { type: null, confidence: "low" };
}

/** Converte o tipo da skill (pix/cash/card) para o label usado no bot ("Pix"/"Dinheiro"/"Cartão") */
export function tipoPagamentoParaLabel(type: MetodoPagamento): "Pix" | "Dinheiro" | "Cartão" {
  if (type === "pix")  return "Pix";
  if (type === "cash") return "Dinheiro";
  return "Cartão";
}
