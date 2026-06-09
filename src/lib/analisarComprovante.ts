import Anthropic from "@anthropic-ai/sdk";

type ResultadoAnalise = {
  valido: boolean;
  valorEncontrado: number | null;
  chavePix: string | null;
  mensagem: string;
};

export async function analisarComprovantePix(
  imagemBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
  totalEsperado: number,
  chavePix: string,
  nomeTitular: string
): Promise<ResultadoAnalise> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `Analise este comprovante de transferência Pix e extraia as seguintes informações:
1. Valor transferido (número apenas, ex: 52.00)
2. Chave Pix ou conta de destino

Dados esperados:
- Valor esperado: R$ ${totalEsperado.toFixed(2)}
- Chave Pix da pizzaria: ${chavePix}
- Nome do titular: ${nomeTitular}

Responda APENAS em JSON neste formato exato, sem explicações:
{"valor": 52.00, "chave": "chave encontrada ou null", "valido": true/false}

Considere "valido: true" se:
- O valor bate com o esperado (tolerância de R$ 0,01)
- A chave Pix ou nome do titular aparece no comprovante

Se não conseguir ler o comprovante, responda: {"valor": null, "chave": null, "valido": false}`;

    const content: any[] = [];

    if (mediaType === "application/pdf") {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: imagemBase64,
        },
      });
    } else {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: imagemBase64,
        },
      });
    }

    content.push({ type: "text", text: prompt });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content }],
    });

    const texto = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = texto.replace(/```json|```/g, "").trim();
    const resultado = JSON.parse(clean);

    return {
      valido: resultado.valido === true,
      valorEncontrado: resultado.valor ?? null,
      chavePix: resultado.chave ?? null,
      mensagem: resultado.valido
        ? `Pix de R$ ${resultado.valor} confirmado! ✅`
        : `Comprovante inválido — valor ou chave não conferem.`,
    };
  } catch (err) {
    return {
      valido: false,
      valorEncontrado: null,
      chavePix: null,
      mensagem: "Não consegui ler o comprovante.",
    };
  }
}