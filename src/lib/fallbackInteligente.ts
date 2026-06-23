// ============================================================================
// FALLBACK INTELIGENTE UNIVERSAL
// ----------------------------------------------------------------------------
// Antes de enviar QUALQUER resposta "seca" de fallback ("Ops, não achei essa
// opção", "não entendi", "opção inválida", etc.), o sistema raciocina sobre a
// mensagem e devolve uma resposta natural, acolhedora e orientada ao próximo
// passo — via Guardião/IA quando possível, ou via fallback determinístico
// HUMANIZADO quando a IA não está disponível.
//
// Regras de segurança (herdadas do Guardião): a IA só humaniza/reorganiza, nunca
// inventa item, preço, taxa, promoção, bairro ou pagamento, nem confirma pedido
// incompleto. Esta camada NÃO altera session/carrinho/total — só troca o TEXTO
// de saída. Funciona igual em /api/whatsapp e /api/bot.
// ============================================================================

import type { BotSession, MensagemRelevante } from "./bot";
import { analisarConversaParaRetomada, validarRespostaIA, type ConversationPath } from "./conversationBrain";
import { gerarRespostaGuardiao } from "./claude";
import { gerarRecomendacaoLocal } from "./recomendacaoSkill";
import { gerarRespostaContextoHumano } from "./contextoHumanoSkill";

function normalizar(texto: string): string {
  return (texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Frases "secas" que NÃO devem ir cruas para a cliente.
const FRASES_FALLBACK_SECO = [
  "nao entendi", "nao achei", "nao peguei", "nao tem isso", "essa nao ta na lista",
  "acho que nao tem isso", "nao saquei", "opcao valida", "opcao invalida",
  "escolha uma opcao", "escolhe uma", "nao encontrei", "nao consegui identificar",
  "dessas opcoes", "as disponiveis sao", "essa opcao",
];

// Detecta se uma resposta que o bot iria enviar é um fallback seco/genérico.
export function pareceFallbackSeco(messages: string[]): boolean {
  return (messages || []).some(m => {
    const n = normalizar(m);
    if (/^ops[\s,!]/.test(n)) return true; // "Ops, ..." — abertura típica de erro
    return FRASES_FALLBACK_SECO.some(p => n.includes(p));
  });
}

// Prioridade pós-pedido: sinaliza ao painel Tempo Real que o cliente voltou a
// falar após finalizar um pedido. Nunca ativa manual=true — isso fica para o
// clique explícito em "Atender". Função pura (sem efeitos colaterais).
export function deveMarcarPrioridadePosPedido(step: string | undefined, mensagemEhSaudacao: boolean): boolean {
  return step === 'done' && !mensagemEhSaudacao;
}

// Handoff automático por confusão consecutiva.
// Conta quantas vezes SEGUIDAS o bot ficou perdido (fallback seco, via
// pareceFallbackSeco). Na 2ª confusão consecutiva sinaliza o handoff para humano
// (o webhook marca manual=true → painel mostra "Atender"). Resposta válida
// (sem fallback) zera o contador, evitando falso positivo. Função pura.
export function avaliarHandoffPorConfusao(
  contadorAnterior: number,
  perdidoEsteTurno: boolean,
): { novoContador: number; ativarManual: boolean } {
  if (!perdidoEsteTurno) return { novoContador: 0, ativarManual: false };
  const novo = (contadorAnterior || 0) + 1;
  if (novo >= 2) return { novoContador: 0, ativarManual: true };
  return { novoContador: novo, ativarManual: false };
}

// Saudações e mensagens sociais que jamais podem virar "opção inválida".
const SAUDACOES = ["bom dia", "boa tarde", "boa noite", "oi", "oie", "ola", "opa", "eai", "e ai", "iae", "hey", "hello", "alo", "boa"];
const SOCIAIS = ["tudo bem", "tudo bom", "como vai", "como voce esta", "como esta", "beleza", "blz", "de boa", "suave", "tranquilo"];

export function ehMensagemSocial(texto: string): boolean {
  const n = normalizar(texto).replace(/[?!.…]+$/g, "").trim();
  if (!n) return false;
  const todas = [...SAUDACOES, ...SOCIAIS];
  return todas.some(s => n === s || n.startsWith(s + " ") || n.endsWith(" " + s));
}

function saudacaoApropriada(texto: string): string {
  const n = normalizar(texto);
  if (n.includes("bom dia")) return "Bom dia";
  if (n.includes("boa tarde")) return "Boa tarde";
  if (n.includes("boa noite")) return "Boa noite";
  const h = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

// Próximo passo curto segundo o ESTADO (nunca inventa item/preço/taxa/bairro).
function proximoPassoCurto(session: BotSession): string {
  if (!session.cart || session.cart.length === 0) {
    return "você quer pizza, lanche, bebida ou suco?";
  }
  if (!session.deliveryType) return "é pra entrega, retirada ou consumo no local?";
  if (session.deliveryType === "delivery" && !session.bairroConfirmado) return "qual é o seu bairro?";
  if (session.deliveryType === "delivery" && !session.address) return "qual é o endereço de entrega?";
  if (!session.paymentMethod) return "como você prefere pagar: Pix, dinheiro ou cartão?";
  return "posso confirmar o seu pedido?";
}

// Fallback determinístico HUMANIZADO — usado quando a IA não está disponível ou
// devolve algo inseguro. Nunca repete o texto seco.
export function fallbackDeterministicoMelhorado(session: BotSession, mensagem: string): string {
  if (ehMensagemSocial(mensagem)) {
    return `${saudacaoApropriada(mensagem)}! 😊 Me diz só uma coisa: ${proximoPassoCurto(session)}`;
  }
  return `Sem problema 😊 pra eu te ajudar certinho, você quer fazer um pedido, ver o cardápio ou falar com atendente?`;
}

export interface FallbackInput {
  mensagemAtual: string;
  session: BotSession;
  mensagensFallback: string[];
  ultimasMensagens?: MensagemRelevante[];
  jaEscalou?: boolean;
  // Injetável para testes; por padrão usa a IA do Guardião.
  chamarIA?: (promptContexto: string) => Promise<string | null>;
}

export interface FallbackResultado {
  messages: string[];
  usouIA: boolean;
  intervencao: "ia" | "fallback_melhorado" | "nenhuma";
  path?: ConversationPath;
  promptContexto?: string;
}

// Resolve a resposta final: se o que seria enviado é um fallback seco, troca por
// uma resposta natural (IA validada) ou pelo fallback determinístico humanizado.
// NUNCA toca na sessão — só devolve as mensagens a enviar.
export async function resolverFallbackInteligente(input: FallbackInput): Promise<FallbackResultado> {
  const { mensagemAtual, session, mensagensFallback } = input;

  // Não intervém em escalonamento nem quando a resposta já é boa (não-seca).
  if (input.jaEscalou || !pareceFallbackSeco(mensagensFallback)) {
    return { messages: mensagensFallback, usouIA: false, intervencao: "nenhuma" };
  }

  // Curto-circuito local: intenções de recomendação não precisam de API.
  const recomendacao = gerarRecomendacaoLocal(session, mensagemAtual);
  if (recomendacao) {
    return { messages: [recomendacao], usouIA: false, intervencao: "fallback_melhorado" };
  }

  // Curto-circuito local: mensagens de contexto humano (humor, cansaço, indecisão
  // ampla, retomada leve) respondidas localmente — zero chamada de API.
  const contextoHumano = gerarRespostaContextoHumano(session, mensagemAtual);
  if (contextoHumano) {
    return { messages: [contextoHumano], usouIA: false, intervencao: "fallback_melhorado" };
  }

  // Decide o caminho (BECO/SAIDA) e monta o contexto seguro para a IA.
  const decisao = analisarConversaParaRetomada({
    session,
    mensagemAtual,
    ultimasMensagens: input.ultimasMensagens,
    fluxoPerdido: true,
  });

  const chamar = input.chamarIA ?? gerarRespostaGuardiao;
  if (decisao.shouldUseAI && decisao.promptContexto) {
    try {
      const ia = await chamar(decisao.promptContexto);
      if (ia && validarRespostaIA(ia, session)) {
        return { messages: [ia], usouIA: true, intervencao: "ia", path: decisao.path, promptContexto: decisao.promptContexto };
      }
    } catch {
      // cai no fallback determinístico humanizado
    }
  }

  return {
    messages: [fallbackDeterministicoMelhorado(session, mensagemAtual)],
    usouIA: false,
    intervencao: "fallback_melhorado",
    path: decisao.path,
    promptContexto: decisao.promptContexto,
  };
}
