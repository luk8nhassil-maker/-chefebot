import { NextRequest, NextResponse } from "next/server";
import { validarTokenCardapio, mascararPhone, mascararTelefoneExibicao } from "@/lib/cardapioToken";

// Resolve o token `?t=` do link do cardápio enviado pelo WhatsApp.
// NUNCA devolve o phone completo ao navegador — apenas os 4 últimos dígitos
// para a confirmação leve no checkout ("vinculado ao WhatsApp final 1234").
// O vínculo real do pedido é resolvido server-side no POST /api/pedido-app.
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("t");
    const resolvido = await validarTokenCardapio(token);
    if (!resolvido) {
      return NextResponse.json({ ok: false });
    }
    // phoneMascarado: formato de exibição "(45) 9••••-0691" para a confirmação
    // na aba Pontos — nunca o número completo (só DDD + 9 inicial + 4 finais).
    return NextResponse.json({
      ok: true,
      origem: "whatsapp",
      phoneFinal: mascararPhone(resolvido.phone),
      phoneMascarado: mascararTelefoneExibicao(resolvido.phone),
    });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
