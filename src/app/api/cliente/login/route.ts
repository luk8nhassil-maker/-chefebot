import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { gerarOtp, podeReenviarOtp } from "@/lib/clienteAuth";
import { sanitizeTelefoneCliente } from "@/lib/clientes";
import { validarTokenCardapio } from "@/lib/cardapioToken";
import { obterConfigEvolution } from "@/lib/evolutionApi";

function sanitizePhoneEnvio(telefone: string): string {
  const digits = telefone.replace(/\D/g, "");
  return digits.startsWith("55") && digits.length >= 12 ? digits : "55" + digits;
}

async function enviarOtpPorWhatsapp(telefone: string, codigo: string): Promise<void> {
  const texto = `Seu código para entrar no ChefeBot é: *${codigo}*\n\nVale por 5 minutos.`;
  const config = obterConfigEvolution();
  if (!config) {
    // Provider não configurado (ou mal configurado): não envia o OTP.
    // Nunca registra telefone ou código no log — apenas uma mensagem
    // genérica. Nunca tenta um host hardcoded antigo.
    console.log("[ChefeBot] Provider de WhatsApp não configurado — OTP não enviado.");
    return;
  }
  try {
    await fetch(`${config.baseUrl}/message/sendText/${config.instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.apiKey },
      body: JSON.stringify({ number: sanitizePhoneEnvio(telefone), text: texto }),
    });
  } catch (err) {
    console.error("[ChefeBot] Erro ao enviar OTP por WhatsApp:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Fluxo de número reconhecido (link do WhatsApp): o destino do OTP é
    // SEMPRE o phone resolvido do token no servidor — qualquer `telefone`
    // presente no body é ignorado nesse modo, para que um cliente não consiga
    // trocar o destino pelo DevTools. Token inválido/expirado devolve um erro
    // genérico com `vinculoInvalido` para o front voltar ao fluxo manual.
    const waToken = typeof body?.waToken === "string" && body.waToken ? body.waToken : null;
    let telefone: string;
    if (waToken) {
      const resolvido = await validarTokenCardapio(waToken);
      if (!resolvido) {
        return NextResponse.json(
          { ok: false, error: "Não conseguimos confirmar seu WhatsApp. Digite seu número.", vinculoInvalido: true },
          { status: 401 }
        );
      }
      telefone = sanitizeTelefoneCliente(resolvido.phone);
    } else {
      telefone = sanitizeTelefoneCliente(body?.telefone || "");
    }
    if (telefone.length < 10) {
      return NextResponse.json({ ok: false, error: "Telefone inválido" }, { status: 400 });
    }

    const podeEnviar = await podeReenviarOtp(telefone);
    if (!podeEnviar) {
      return NextResponse.json({ ok: false, error: "Aguarde antes de pedir um novo código" }, { status: 429 });
    }

    const codigo = await gerarOtp(telefone);
    await enviarOtpPorWhatsapp(telefone, codigo);

    // Código de suporte da tentativa (traceId): aleatório, curto, sem PII —
    // correlaciona telemetria/logs de UMA tentativa sem expor nada.
    // Prefixo alfabético garante que o identificador de suporte nunca forme
    // uma sequência de 6 dígitos confundível com o OTP nos logs.
    const traceId = `P3-X${randomUUID().replace(/[^A-Z0-9]/gi, "").slice(0, 5).toUpperCase()}`;
    console.log(`[ChefeBot] perfil3-telemetria evt=otp_requested ok=- motivo=- v=srv trace=${traceId}`);
    return NextResponse.json({ ok: true, traceId });
  } catch (error) {
    console.error("[ChefeBot] Erro no login do cliente:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
