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