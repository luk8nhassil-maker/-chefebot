import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { normalizarCodigoAutenticacaoPix, normalizarE2EIdPix } from "./pixComprovanteEvidencia";

type ResultadoAnalise = {
  valido: boolean;
  valorEncontrado: number | null;
  chavePix: string | null;
  beneficiario: string | null;
  e2eId: string | null;
  codigoAutenticacao: string | null;
  dataPagamento: string | null;
  horaPagamento: string | null;
  dataHoraPagamento: string | null;
  motivo: string | null;
  mensagem: string;
};

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function textoOpcional(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

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
- Horario de referencia do pedido: ${horarioReferencia}
- Data e horario do pagamento Pix, se estiverem visiveis (horario nao obrigatorio)
- E2E ID Pix ou código de autenticação/transação, se estiver visível (não obrigatório)
REGRAS DE VALIDAÇÃO — responda "valido: true" SOMENTE se TODAS forem atendidas:
1. Valor bate com o esperado (tolerância de R$ 0,01)
2. Nome do destinatário contém palavras do nome "${nomeTitular}" (comparação flexível, ignorar maiúsculas/minúsculas, aceitar nome parcial) OU a chave/CNPJ do comprovante equivale a "${chavePix}" — compare apenas os dígitos, ignorando formatação como +55, parênteses, espaços, hífens e pontos
3. A data do comprovante é HOJE (${dataHoje})
4. O comprovante indica que o Pix foi ENVIADO/CONCLUÍDO com sucesso (não agendado, não pendente, não cancelado, não em análise)

5. Se data e horario do pagamento estiverem claros, o pagamento nao pode ser anterior ao horario de referencia do pedido por mais de 8 minutos. Se apenas a data estiver visivel ou o horario estiver ilegivel, nao reprove somente por falta de horario.

Se qualquer uma dessas regras falhar, responda "valido: false".

Responda APENAS em JSON sem explicações:
{"valor": 52.00, "chave": "chave Pix do destinatario encontrada (telefone/CPF/CNPJ/email/aleatoria) ou null", "beneficiario": "nome do destinatario/recebedor encontrado ou null", "e2eId": "E2E encontrado ou null", "codigoAutenticacao": "codigo encontrado ou null", "dataPagamento": "DD/MM/AAAA ou null", "horaPagamento": "HH:mm ou null", "dataHoraPagamento": "data e hora completa ou null", "valido": true/false, "motivo": "aprovado / valor errado / data errada / horario anterior ao pedido / nome errado / pix nao concluido"}

Se não conseguir ler: {"valor": null, "chave": null, "beneficiario": null, "e2eId": null, "codigoAutenticacao": null, "dataPagamento": null, "horaPagamento": null, "dataHoraPagamento": null, "valido": false, "motivo": "ilegivel"}`;

    const content: ContentBlockParam[] = [];

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
      max_tokens: 260,
      messages: [{ role: "user", content }],
    });

    const texto = response.content[0].type === "text" ? response.content[0].text : "";
    const clean = texto.replace(/```json|```/g, "").trim();
    const resultadoBruto: unknown = JSON.parse(clean);
    const resultado = ehObjeto(resultadoBruto) ? resultadoBruto : {};

    const motivo = textoOpcional(resultado.motivo) ?? "";
    const valor = typeof resultado.valor === "number" ? resultado.valor : null;
    const valido = resultado.valido === true;
    let mensagemInvalido = "Hmm, não consegui confirmar esse comprovante. 😕 Pode tentar enviar de novo?";
    if (motivo.includes("data")) mensagemInvalido = "Eita! 😅 Esse comprovante parece ser de outro dia. Para confirmar seu pedido precisa ser o comprovante de hoje mesmo, tá? Faz o Pix agora e manda o comprovante fresquinho! 🍕";
    else if (motivo.includes("horario")) mensagemInvalido = "Opa! 🤔 Esse comprovante é de antes do seu pedido. Precisa ser o Pix feito agora, depois que você confirmou o pedido. Faz o pagamento e manda o comprovante, pode ser? 😊";
    else if (motivo.includes("agendado") || motivo.includes("nao concluido")) mensagemInvalido = "Xiii, parece que esse Pix foi agendado ou ainda não foi concluído. 😬 A gente precisa do pagamento confirmado na hora! Faz o Pix normal (não agendado) e manda o comprovante. 👍";
    else if (motivo.includes("valor")) mensagemInvalido = "Hmm, o valor do comprovante não bate com o do seu pedido. 🧐 Confere se pagou o valor certinho e manda o comprovante correto, por favor!";
    else if (motivo.includes("nome")) mensagemInvalido = "Não consegui identificar o destinatário nesse comprovante. 😕 Certifica que o Pix foi para a chave correta e manda o comprovante de novo!";
    else if (motivo.includes("ilegivel")) mensagemInvalido = "Não consegui ler esse comprovante direito. 😅 Tenta mandar uma foto mais nítida ou o PDF completo do comprovante!";

    return {
      valido,
      valorEncontrado: valor,
      chavePix: textoOpcional(resultado.chave),
      beneficiario: textoOpcional(resultado.beneficiario) ?? textoOpcional(resultado.destinatario),
      e2eId: normalizarE2EIdPix(
        textoOpcional(resultado.e2eId) ?? textoOpcional(resultado.e2e) ?? textoOpcional(resultado.endToEndId),
      ) ?? null,
      codigoAutenticacao: normalizarCodigoAutenticacaoPix(
        textoOpcional(resultado.codigoAutenticacao) ?? textoOpcional(resultado.codigo) ?? textoOpcional(resultado.codigoTransacao),
      ) ?? null,
      dataPagamento: textoOpcional(resultado.dataPagamento),
      horaPagamento: textoOpcional(resultado.horaPagamento) ?? textoOpcional(resultado.horarioPagamento),
      dataHoraPagamento: textoOpcional(resultado.dataHoraPagamento),
      motivo: motivo || null,
      mensagem: valido
        ? `Pix de R$ ${valor} confirmado! ✅`
        : mensagemInvalido,
    };
  } catch {
    return {
      valido: false,
      valorEncontrado: null,
      chavePix: null,
      beneficiario: null,
      e2eId: null,
      codigoAutenticacao: null,
      dataPagamento: null,
      horaPagamento: null,
      dataHoraPagamento: null,
      motivo: "erro_leitura",
      mensagem: "Não consegui ler o comprovante.",
    };
  }
}
