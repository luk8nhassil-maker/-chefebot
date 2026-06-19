/**
 * botSkills.ts — Camada central de conhecimento do ChefeBot
 *
 * Propósito: registrar regras de entendimento humano de forma organizada.
 * Novas intenções/frases devem ser adicionadas aqui, nunca espalhadas no bot.ts.
 *
 * Esta camada é SOMENTE LEITURA em relação ao fluxo principal:
 * não altera sessão, não dispara respostas — só classifica intenções.
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

const FRASES_DELIVERY = [
  "entregar", "entrega", "delivery", "manda entregar", "manda em casa",
  "minha casa", "em casa", "no meu endereco", "vou querer delivery",
  "manda ai", "manda pra mim",
];

const FRASES_RETIRADA = [
  "retirar", "retirada", "buscar", "pegar", "retiro",
  "vou buscar", "passo pra pegar", "vou la pegar", "busco ai",
  "na loja", "passa la", "vou la",
];

const FRASES_CONSUMO_LOCAL = [
  "consumo no local", "consumir no local", "comer ai", "comer aqui",
  "comer na pizzaria", "vou comer ai", "vou comer la", "vou comer aqui",
  "comer no local", "consumo local", "consumir", "aqui mesmo",
  "na mesa", "mesa", "local",
];

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
