import Anthropic from "@anthropic-ai/sdk";
import { normalizarCodigoAutenticacaoPix, normalizarE2EIdPix } from "./pixComprovanteEvidencia";

type ResultadoAnalise = {
  valido: boolean;
  valorEncontrado: number | null;
  chavePix: string | null;
  e2eId: string | null;
  codigoAutenticacao: string | null;
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
- E2E ID Pix ou código de autenticação/transação, se estiver visível (não obrigatório)
REGRAS DE VALIDAÇÃO — responda "valido: true" SOMENTE se TODAS forem atendidas:
1. Valor bate com o esperado (tolerância de R$ 0,01)
2. Nome do destinatário contém palavras do nome "${nomeTitular}" (comparação flexível, ignorar maiúsculas/minúsculas, aceitar nome parcial) OU CNPJ/chave contém "${chavePix}"
3. A data do comprovante é HOJE (${dataHoje})
4. O comprovante indica que o Pix foi ENVIADO/CONCLUÍDO com sucesso (não agendado, não pendente, não cancelado, não em análise)

Se qualquer uma dessas regras falhar, responda "valido: false".

Responda APENAS em JSON sem explicações:
{"valor": 52.00, "chave": "chave encontrada ou null", "e2eId": "E2E encontrado ou null", "codigoAutenticacao": "codigo encontrado ou null", "valido": true/false, "motivo": "aprovado / valor errado / data errada / horario anterior ao pedido / nome errado / pix nao concluido"}

Se não conseguir ler: {"valor": null, "chave": null, "e2eId": null, "codigoAutenticacao": null, "valido": false, "motivo": "ilegivel"}`;

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
    let mensagemInvalido = "Hmm, não consegui confirmar esse comprovante. 😕 Pode tentar enviar de novo?";
    if (motivo.includes("data")) mensagemInvalido = "Eita! 😅 Esse comprovante parece ser de outro dia. Para confirmar seu pedido precisa ser o comprovante de hoje mesmo, tá? Faz o Pix agora e manda o comprovante fresquinho! 🍕";
    else if (motivo.includes("horario")) mensagemInvalido = "Opa! 🤔 Esse comprovante é de antes do seu pedido. Precisa ser o Pix feito agora, depois que você confirmou o pedido. Faz o pagamento e manda o comprovante, pode ser? 😊";
    else if (motivo.includes("agendado") || motivo.includes("nao concluido")) mensagemInvalido = "Xiii, parece que esse Pix foi agendado ou ainda não foi concluído. 😬 A gente precisa do pagamento confirmado na hora! Faz o Pix normal (não agendado) e manda o comprovante. 👍";
    else if (motivo.includes("valor")) mensagemInvalido = "Hmm, o valor do comprovante não bate com o do seu pedido. 🧐 Confere se pagou o valor certinho e manda o comprovante correto, por favor!";
    else if (motivo.includes("nome")) mensagemInvalido = "Não consegui identificar o destinatário nesse comprovante. 😕 Certifica que o Pix foi para a chave correta e manda o comprovante de novo!";
    else if (motivo.includes("ilegivel")) mensagemInvalido = "Não consegui ler esse comprovante direito. 😅 Tenta mandar uma foto mais nítida ou o PDF completo do comprovante!";

    return {
      valido: resultado.valido === true,
      valorEncontrado: resultado.valor ?? null,
      chavePix: resultado.chave ?? null,
      e2eId: normalizarE2EIdPix(resultado.e2eId ?? resultado.e2e ?? resultado.endToEndId) ?? null,
      codigoAutenticacao: normalizarCodigoAutenticacaoPix(resultado.codigoAutenticacao ?? resultado.codigo ?? resultado.codigoTransacao) ?? null,
      mensagem: resultado.valido
        ? `Pix de R$ ${resultado.valor} confirmado! ✅`
        : mensagemInvalido,
    };
  } catch (err) {
    return {
      valido: false,
      valorEncontrado: null,
      chavePix: null,
      e2eId: null,
      codigoAutenticacao: null,
      mensagem: "Não consegui ler o comprovante.",
    };
  }
}
