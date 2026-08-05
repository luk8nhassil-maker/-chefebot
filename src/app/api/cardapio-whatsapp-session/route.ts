import { NextRequest, NextResponse } from "next/server";
import { validarTokenCardapio, mascararPhone, mascararTelefoneExibicao } from "@/lib/cardapioToken";
import { sincronizarCronometroInatividade } from "@/lib/inatividadeConversa";

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
    // Cliente abriu o cardápio digital pelo link — mesmo sinal de "está
    // ativo" que uma resposta no WhatsApp: pausa o cronômetro de
    // cancelamento por inatividade (ver src/lib/inatividadeConversa.ts).
    // Autor "cliente" só avança a geração (invalida ticks pendentes), nunca
    // registra uma mensagem falsa no histórico da conversa. Nunca pode
    // impedir a resposta normal deste endpoint (o vínculo do token já foi
    // resolvido com sucesso nesse ponto).
    try {
      await sincronizarCronometroInatividade(resolvido.phone, "cliente");
    } catch {
      // best-effort — nunca bloqueia a resolução do token
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
