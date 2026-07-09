import { NextRequest, NextResponse } from "next/server";
import { gerarOtp, podeReenviarOtp } from "@/lib/clienteAuth";
import { sanitizeTelefoneCliente } from "@/lib/clientes";

const _evUrl = process.env.EVOLUTION_API_URL ?? "evolution-api-production-8f99.up.railway.app";
const EVOLUTION_API_URL = _evUrl.startsWith("http") ? _evUrl : `https://${_evUrl}`;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = "chefebot";

function sanitizePhoneEnvio(telefone: string): string {
  const digits = telefone.replace(/\D/g, "");
  return digits.startsWith("55") && digits.length >= 12 ? digits : "55" + digits;
}

async function enviarOtpPorWhatsapp(telefone: string, codigo: string): Promise<void> {
  const texto = `Seu código para entrar no ChefeBot é: *${codigo}*\n\nVale por 5 minutos.`;
  if (!EVOLUTION_API_KEY) {
    // Sem credenciais configuradas: fallback seguro de dev/teste — nunca
    // retornar o codigo na resposta HTTP, apenas registrar no log do servidor.
    console.log(`[ChefeBot][dev] OTP para ${telefone}: ${codigo}`);
    return;
  }
  try {
    await fetch(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ number: sanitizePhoneEnvio(telefone), text: texto }),
    });
  } catch (err) {
    console.error("[ChefeBot] Erro ao enviar OTP por WhatsApp:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const telefone = sanitizeTelefoneCliente(body?.telefone || "");
    if (telefone.length < 10) {
      return NextResponse.json({ ok: false, error: "Telefone inválido" }, { status: 400 });
    }

    const podeEnviar = await podeReenviarOtp(telefone);
    if (!podeEnviar) {
      return NextResponse.json({ ok: false, error: "Aguarde antes de pedir um novo código" }, { status: 429 });
    }

    const codigo = await gerarOtp(telefone);
    await enviarOtpPorWhatsapp(telefone, codigo);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ChefeBot] Erro no login do cliente:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
