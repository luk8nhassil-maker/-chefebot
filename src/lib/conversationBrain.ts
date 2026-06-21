// ============================================================================
// GUARDIÃO DE VENDA (Sales Guardian)
// ----------------------------------------------------------------------------
// Central de inteligência que observa a conversa do começo ao fim para evitar
// abandono, confusão ou perda da venda. NÃO substitui o fluxo determinístico do
// bot: ele continua sendo a fonte da verdade para preço, item, carrinho, taxa,
// bairro, pagamento, Pix e confirmação.
//
// Toda conversa está em um de três caminhos:
//   • CAMINHO_CERTO → cliente avançando normalmente → segue o fluxo, sem IA.
//   • BECO          → cliente perdido/confuso/travado → IA reorganiza e faz UMA
//                     pergunta simples que recoloca a conversa no trilho.
//   • SAIDA         → cliente com sinal de desistência/demora → IA tenta recuperar
//                     a venda de forma natural, curta e sem insistir.
//
// A IA só é chamada em BECO, SAIDA ou retomada pós-handoff ambígua. A resposta da
// IA SEMPRE passa por validarRespostaIA() antes de ir para a cliente.
// ============================================================================

import {
  type BotSession,
  type MensagemRelevante,
  proximaPerguntaPorEstado,
  retomarFluxoAposHandoff,
} from "./bot";

export type ConversationPath = "CAMINHO_CERTO" | "BECO" | "SAIDA";

export type RecommendedAction =
  | "FOLLOW_NORMAL_FLOW"
  | "ASK_CLARIFYING_QUESTION"
  | "RECOVER_SALE"
  | "RESUME_AFTER_HANDOFF"
  | "ESCALATE_TO_HUMAN";

export interface BrainDecision {
  path: ConversationPath;
  shouldUseAI: boolean;
  reason: string;
  recommendedAction: RecommendedAction;
  // Resposta segura, determinística (fonte da verdade). É o fallback usado quando
  // a IA está indisponível ou quando a resposta da IA é reprovada na validação.
  safeReply?: string;
  // Sessão sugerida pela camada de retomada (já fora de "escalado"). O chamador
  // decide se aplica (caminho pós-handoff) ou se mantém a sessão do fluxo rígido.
  session?: BotSession;
  // Contexto pronto para a IA (somente quando shouldUseAI === true).
  promptContexto?: string;
}

export interface BrainInput {
  session: BotSession;
  mensagemAtual: string;
  ultimasMensagens?: MensagemRelevante[];
  emAtendimentoHumano?: boolean;
  voltouDoHandoff?: boolean;
  ultimaInteracaoTs?: number;
  agoraTs?: number;
  // O fluxo rígido se perdeu nesta mensagem (resposta de confusão do bot). Mesmo
  // sem palavra de confusão, "responder algo fora do esperado" é um BECO.
  fluxoPerdido?: boolean;
}

function normalizar(texto: string): string {
  return (texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Sinais de DESISTÊNCIA / demora / cancelamento → risco de perder a venda.
const PALAVRAS_SAIDA = [
  "deixa pra la", "deixa pra lá", "deixa quieto", "deixa pra depois", "deixa assim",
  "vou ver", "vou ver depois", "depois eu peco", "depois eu peço", "depois eu vejo",
  "depois eu faco", "depois eu faço", "mais tarde", "outra hora", "vou pensar",
  "vou pensar melhor", "to demorando", "ta demorando", "tá demorando", "demorou",
  "demora muito", "muito demorado", "ta muito demorado", "cancela", "cancelar",
  "desisti", "desistir", "vou pedir em outro", "outro canto", "outro lugar",
  "em outro lugar", "concorrente", "nao quero mais", "não quero mais", "esquece",
];

// Sinais de CONFUSÃO / cliente travado / perdido.
const PALAVRAS_BECO = [
  "nao entendi", "não entendi", "nao entendo", "não entendo", "nao to entendendo",
  "nao to entendendo", "não tô entendendo", "como assim", "e agora", "e agora?",
  "ta confuso", "tá confuso", "to confuso", "tô confuso", "confuso", "to perdido",
  "tô perdido", "perdido", "nao sei", "não sei", "nao sei o que", "nao faz sentido",
  "não faz sentido", "complicado", "to boiando", "tô boiando", "nao saquei",
  "que isso", "nao entendi nada", "fiquei perdido", "me perdi", "nao captei",
];

const STEPS_CRITICOS: BotSession["step"][] = [
  "delivery_type", "neighborhood", "address", "payment", "troco", "confirm", "aguardando_pix",
];

// Demora considerada longa após etapa crítica (risco de abandono): 15 minutos.
const DEMORA_LONGA_MS = 15 * 60 * 1000;

function contemAlguma(n: string, lista: string[]): string | null {
  for (const p of lista) {
    const pn = normalizar(p);
    if (n === pn || n.includes(pn)) return p;
  }
  return null;
}

// Classificador determinístico simples do caminho da conversa.
export function classificarCaminho(
  mensagem: string,
  session: BotSession,
  opts: { ultimaInteracaoTs?: number; agoraTs?: number; ultimasMensagens?: MensagemRelevante[] } = {},
): { path: ConversationPath; reason: string } {
  const n = normalizar(mensagem);

  // SAIDA tem prioridade: perder a venda é o pior desfecho.
  const saida = contemAlguma(n, PALAVRAS_SAIDA);
  if (saida) return { path: "SAIDA", reason: `desistencia:${saida}` };

  // Demora longa após etapa crítica → risco de abandono.
  if (typeof opts.ultimaInteracaoTs === "number" && typeof opts.agoraTs === "number") {
    const gap = opts.agoraTs - opts.ultimaInteracaoTs;
    if (gap >= DEMORA_LONGA_MS && STEPS_CRITICOS.includes(session.step)) {
      return { path: "SAIDA", reason: "demora_longa_etapa_critica" };
    }
  }

  // BECO: palavras de confusão.
  const beco = contemAlguma(n, PALAVRAS_BECO);
  if (beco) return { path: "BECO", reason: `confusao:${beco}` };

  return { path: "CAMINHO_CERTO", reason: "fluxo_normal" };
}

// Pedido completo o suficiente para confirmar (checagem leve de segurança; a
// validação de taxa/preço continua no fluxo rígido do bot).
function ehPedidoCompleto(s: BotSession): boolean {
  if (!s.cart || s.cart.length === 0) return false;
  if (!s.deliveryType) return false;
  if (s.deliveryType === "delivery" && (!s.neighborhood || !s.bairroConfirmado || !s.address)) return false;
  if (!s.paymentMethod) return false;
  return true;
}

function descreverFaltas(s: BotSession): string[] {
  const faltas: string[] = [];
  if (!s.cart || s.cart.length === 0) faltas.push("itens do pedido");
  if (!s.deliveryType) faltas.push("forma de recebimento (entrega/retirada/consumo no local)");
  if (s.deliveryType === "delivery" && (!s.neighborhood || !s.bairroConfirmado)) faltas.push("bairro");
  if (s.deliveryType === "delivery" && !s.address) faltas.push("endereço");
  if (!s.paymentMethod) faltas.push("forma de pagamento");
  return faltas;
}

function construirPrompt(
  path: ConversationPath,
  session: BotSession,
  mensagem: string,
  ultimas: MensagemRelevante[],
  prox: { session: BotSession; messages: string[] },
  input: BrainInput,
): string {
  const situacao = path === "SAIDA"
    ? "A cliente demonstrou sinal de desistência ou demora — tente recuperar a venda de forma gentil, sem insistir."
    : input.voltouDoHandoff
    ? "A conversa estava com um atendente humano e acabou de voltar para o bot."
    : "A cliente está confusa ou travada — reorganize e faça uma pergunta simples que recoloque a conversa no trilho.";

  const itens = session.cart && session.cart.length > 0
    ? session.cart.map(i => `${i.name}${i.size ? " " + i.size : ""}${i.flavor ? " " + i.flavor : ""}`).join("; ")
    : "(carrinho vazio)";

  const histLinhas = (ultimas || []).map(m => {
    const autor = m.autor === "cliente" ? "Cliente" : m.autor === "atendente" ? "Atendente humano" : "Bot";
    return `- ${autor}: ${m.texto}`;
  }).join("\n") || "- (sem histórico recente)";

  const faltas = descreverFaltas(session);

  return [
    `Situação: ${situacao}`,
    `Carrinho atual: ${itens}`,
    `Etapa atual do pedido: ${prox.session.step}`,
    `Bairro: ${session.neighborhood ?? "não informado"}`,
    `Pagamento: ${session.paymentMethod ?? "não informado"}`,
    `Pedido completo? ${ehPedidoCompleto(session) ? "sim" : "não"}`,
    `O que ainda falta: ${faltas.length ? faltas.join(", ") : "nada — o pedido pode ser confirmado"}`,
    ``,
    `Duas últimas mensagens relevantes:`,
    histLinhas,
    ``,
    `Nova mensagem da cliente: "${mensagem}"`,
    ``,
    `Próxima pergunta sugerida pelo fluxo (fonte da verdade): "${prox.messages[0]}"`,
  ].join("\n");
}

// Decisão central do Guardião de Venda. Função PURA: classifica o caminho e indica
// se a IA deve ser usada, qual ação tomar e qual a resposta segura de fallback.
// A chamada à IA e o envio ficam a cargo do webhook (camada de I/O).
export function analisarConversaParaRetomada(input: BrainInput): BrainDecision {
  const session = input.session;
  const mensagem = input.mensagemAtual ?? "";
  const ultimas = input.ultimasMensagens ?? [];

  // Em atendimento humano ativo: o Guardião observa, mas não age (deixa o humano).
  if (input.emAtendimentoHumano) {
    return {
      path: "CAMINHO_CERTO",
      shouldUseAI: false,
      reason: "em_atendimento_humano",
      recommendedAction: "ESCALATE_TO_HUMAN",
    };
  }

  const classif = classificarCaminho(mensagem, session, {
    ultimaInteracaoTs: input.ultimaInteracaoTs,
    agoraTs: input.agoraTs,
    ultimasMensagens: ultimas,
  });

  // Se o fluxo rígido se perdeu nesta mensagem ("algo fora do esperado"), tratamos
  // como BECO mesmo sem palavra de confusão — exceto se já houver sinal de SAIDA.
  let path = classif.path;
  let reason = classif.reason;
  if (path === "CAMINHO_CERTO" && input.fluxoPerdido === true) {
    path = "BECO";
    reason = "fluxo_perdido";
  }

  // SAIDA → tentar recuperar a venda (IA), com fallback determinístico.
  if (path === "SAIDA") {
    const prox = proximaPerguntaPorEstado(session);
    return {
      path: "SAIDA",
      shouldUseAI: true,
      reason,
      recommendedAction: "RECOVER_SALE",
      safeReply: prox.messages[0],
      session: prox.session,
      promptContexto: construirPrompt("SAIDA", session, mensagem, ultimas, prox, input),
    };
  }

  // Retomada pós-handoff → delega à retomada inteligente do bot (fonte da verdade
  // do que falta). A IA só entra se a retomada considerar a conversa ambígua.
  if (input.voltouDoHandoff) {
    const ret = retomarFluxoAposHandoff({
      session,
      novaMensagem: mensagem,
      ultimasMensagens: ultimas,
      intervencaoHumanaRecente: true,
    });
    const usaIA = ret.tipo === "ia";
    return {
      path: usaIA ? "BECO" : "CAMINHO_CERTO",
      shouldUseAI: usaIA,
      reason: usaIA ? "retomada_ambigua" : "retomada_fluxo_rigido",
      recommendedAction: "RESUME_AFTER_HANDOFF",
      safeReply: ret.messages[0],
      session: ret.session,
      promptContexto: ret.promptContexto,
    };
  }

  // BECO → pergunta de reorganização (IA), com fallback determinístico.
  if (path === "BECO") {
    const prox = proximaPerguntaPorEstado(session);
    return {
      path: "BECO",
      shouldUseAI: true,
      reason,
      recommendedAction: "ASK_CLARIFYING_QUESTION",
      safeReply: prox.messages[0],
      session: prox.session,
      promptContexto: construirPrompt("BECO", session, mensagem, ultimas, prox, input),
    };
  }

  // CAMINHO_CERTO → o fluxo rígido segue normalmente, sem IA.
  return {
    path: "CAMINHO_CERTO",
    shouldUseAI: false,
    reason,
    recommendedAction: "FOLLOW_NORMAL_FLOW",
  };
}

// Indica se o bot ficou "perdido" (resposta de confusão) — usado pelo webhook para
// acionar o Guardião apenas como FALLBACK, sem nunca sobrescrever respostas que o
// fluxo rígido resolveu.
export function botParecePerdido(messages: string[]): boolean {
  return (messages || []).some(m => {
    const n = normalizar(m);
    return [
      "nao entendi", "nao achei", "nao peguei", "nao tem isso",
      "essa nao ta na lista", "acho que nao tem isso", "nao saquei",
    ].some(p => n.includes(p));
  });
}

// Valida a resposta da IA ANTES de enviar: a IA não pode inventar preço/valor nem
// confirmar/fechar um pedido incompleto. Retorna false → o chamador usa o fallback
// determinístico (safeReply / resposta do fluxo rígido).
export function validarRespostaIA(reply: string | null | undefined, session: BotSession): boolean {
  if (!reply) return false;
  const txt = reply.trim();
  if (txt.length === 0 || txt.length > 600) return false;
  const n = normalizar(txt);

  // 1. Não pode citar preço/taxa/valor em reais (preço só vem do fluxo rígido).
  if (/r\$\s*\d/.test(n) || /\d+\s*(reais|real)\b/.test(n)) return false;

  // 2. Não pode confirmar/fechar um pedido incompleto.
  if (!ehPedidoCompleto(session)) {
    const confirmacao = [
      "pedido confirmado", "pedido fechado", "pedido finalizado", "confirmado com sucesso",
      "saiu para entrega", "saiu pra entrega", "esta a caminho", "ja esta a caminho",
      "pix confirmado", "pagamento confirmado", "pedido feito", "ja vai sair",
      "foi pra cozinha", "foi para a cozinha", "enviado para a cozinha",
    ];
    if (confirmacao.some(c => n.includes(normalizar(c)))) return false;
  }

  return true;
}
