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
  nomeTitular: string,
  horarioPedido?: string
): Promise<ResultadoAnalise> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const agora = new Date();
    const dataHoje = agora.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const horaAtual = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const horarioReferencia = horarioPedido || horaAtual;

    const prompt = `Analise este comprovante de transferência Pix e extraia as seguintes informações.

DADOS ESPERADOS:
- Valor: R$ ${totalEsperado.toFixed(2)}
- Chave Pix / CNPJ da pizzaria: ${chavePix}
- Nome do titular que deve receber: ${nomeTitular}
- Data do pedido: ${dataHoje}
- Horário mínimo do comprovante: ${horarioReferencia} (o Pix deve ter sido feito APÓS esse horário)

REGRAS DE VALIDAÇÃO — responda "valido: true" SOMENTE se TODAS forem atendidas:
1. Valor bate com o esperado (tolerância de R$ 0,01)
2. Nome do destinatário contém "${nomeTitular}" OU CNPJ/chave contém "${chavePix}"
3. A data do comprovante é HOJE (${dataHoje})
4. O horário do comprovante é IGUAL OU POSTERIOR a ${horarioReferencia}
5. O comprovante indica que o Pix foi ENVIADO/CONCLUÍDO (não agendado, não pendente, não cancelado)

Se qualquer uma dessas regras falhar, responda "valido: false".

Responda APENAS em JSON sem explicações:
{"valor": 52.00, "chave": "chave encontrada ou null", "valido": true/false, "motivo": "aprovado / valor errado / data errada / horario anterior ao pedido / nome errado / pix nao concluido"}

Se não conseguir ler: {"valor": null, "chave": null, "valido": false, "motivo": "ilegivel"}`;

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

    const motivo = resultado.motivo || "";
    let mensagemInvalido = "Comprovante inválido.";
    if (motivo.includes("data")) mensagemInvalido = "Comprovante com data incorreta — use um comprovante de hoje.";
    else if (motivo.includes("horario")) mensagemInvalido = "Comprovante com horário anterior ao pedido — envie o comprovante do pagamento realizado agora.";
    else if (motivo.includes("agendado") || motivo.includes("nao concluido")) mensagemInvalido = "Pix agendado não é aceito — realize o pagamento agora.";
    else if (motivo.includes("valor")) mensagemInvalido = "Valor do comprovante não confere com o pedido.";
    else if (motivo.includes("nome")) mensagemInvalido = "Destinatário do comprovante não confere.";

    return {
      valido: resultado.valido === true,
      valorEncontrado: resultado.valor ?? null,
      chavePix: resultado.chave ?? null,
      mensagem: resultado.valido
        ? `Pix de R$ ${resultado.valor} confirmado! ✅`
        : mensagemInvalido,
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