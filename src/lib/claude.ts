import { redis } from "./redis";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

type PadraoAprendido = {
  original: string;
  interpretado: string;
  vezes: number;
  criadoEm: string;
};

export async function buscarPadraoAprendido(texto: string): Promise<string | null> {
  const chave = texto.toLowerCase().trim();
  const padroes = await redis.get<Record<string, PadraoAprendido>>("padroes_aprendidos") || {};
  const padrao = padroes[chave];
  if (padrao) {
    padrao.vezes += 1;
    await redis.set("padroes_aprendidos", padroes);
    return padrao.interpretado;
  }
  return null;
}

export async function salvarPadraoAprendido(original: string, interpretado: string): Promise<void> {
  const chave = original.toLowerCase().trim();
  const padroes = await redis.get<Record<string, PadraoAprendido>>("padroes_aprendidos") || {};
  padroes[chave] = {
    original: chave,
    interpretado,
    vezes: 1,
    criadoEm: new Date().toISOString(),
  };
  await redis.set("padroes_aprendidos", padroes);
}

export async function interpretarComClaude(
  mensagem: string,
  contexto: string,
  opcoes: string[]
): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const prompt = `Você é um assistente que ajuda a interpretar mensagens de clientes de uma pizzaria no WhatsApp.

O cliente está em um fluxo de pedido. O contexto atual é: "${contexto}"

As opções válidas para este momento são:
${opcoes.map((o, i) => `${i + 1}. ${o}`).join("\n")}

O cliente enviou a mensagem: "${mensagem}"

Identifique qual opção o cliente quer escolher. Responda APENAS com o texto exato de uma das opções acima, sem explicações. Se não for possível identificar, responda com: NENHUMA`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const resposta = data?.content?.[0]?.text?.trim();
    if (!resposta || resposta === "NENHUMA") return null;
    await salvarPadraoAprendido(mensagem, resposta);
    return resposta;
  } catch (err) {
    console.error("[Claude] Erro ao interpretar:", err);
    return null;
  }
}

// Camada de interpretação do "Guardião de Venda". Recebe um contexto já montado
// pelo fluxo (situação, carrinho, etapa, o que falta, duas últimas mensagens e a
// próxima pergunta da fonte da verdade) e devolve UMA resposta natural e curta que
// destrava a conversa / retoma o pedido / tenta recuperar a venda. NÃO substitui o
// fluxo do bot e NÃO inventa item, bairro, pagamento, taxa, Pix ou confirmação —
// só formula a próxima resposta, fazendo no máximo uma pergunta por vez.
export async function gerarRespostaGuardiao(promptContexto: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const prompt = `Você é o atendente virtual de uma pizzaria no WhatsApp. Sua tarefa é destravar uma conversa que ficou ambígua, confusa, interrompida (por exemplo após um atendente humano) ou em risco de abandono, e levar a cliente de volta para o próximo passo do pedido, sem recomeçar do zero.

CONTEXTO DA CONVERSA:
${promptContexto}

REGRAS OBRIGATÓRIAS:
- Responda de forma natural, curta e objetiva, focada no próximo passo do pedido.
- Faça NO MÁXIMO UMA pergunta.
- NÃO invente item, bairro, forma de pagamento, taxa de entrega, Pix nem confirmação que a cliente não tenha dito.
- NÃO cite preços nem valores em reais — preço, taxa e total só vêm do fluxo do bot.
- NÃO confirme nem finalize um pedido que ainda esteja incompleto.
- Respeite o ponto do fluxo: se falta bairro, pergunte o bairro; se falta forma de recebimento, pergunte se é entrega, retirada ou consumo no local; se falta pagamento, pergunte o pagamento; se está aguardando Pix, siga aguardando o comprovante; se o pedido está completo, peça a confirmação.
- Se a cliente mostrou intenção de desistir, tente recuperar a venda de forma gentil, sem parecer insistente.
- Use no máximo 2 frases curtas e tom amigável de WhatsApp (português do Brasil).

Escreva APENAS a mensagem que o bot deve enviar para a cliente agora.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const resposta = data?.content?.[0]?.text?.trim();
    return resposta && resposta.length > 0 ? resposta : null;
  } catch (err) {
    console.error("[Claude] Erro ao reorganizar retomada pós-handoff:", err);
    return null;
  }
}

export async function interpretarMensagem(
  mensagem: string,
  contexto: string,
  opcoes: string[]
): Promise<string | null> {
  const aprendido = await buscarPadraoAprendido(mensagem);
  if (aprendido && opcoes.some(o => o.toLowerCase().includes(aprendido.toLowerCase()))) {
    return aprendido;
  }
  return await interpretarComClaude(mensagem, contexto, opcoes);
}