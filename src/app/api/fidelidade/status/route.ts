import { NextResponse } from "next/server";
import { obterConfigFidelidadePontos } from "@/lib/fidelidade";

// GET /api/fidelidade/status — status público (sem autenticação) do programa
// de pontos, usado só para decidir a tela de /cliente ANTES do login: "ainda
// não está ativo por aqui" vs. "ative seus pontos". Expõe apenas o booleano
// `ativo` do restaurante — nenhum dado de cliente, saldo ou histórico.
//
// Falha do Redis nunca vira 500: cai para `ativo:false` (mesmo "na dúvida,
// não confirmar" do conciliador Pix — aqui, na dúvida, nunca oferece a
// ativação). O frontend distingue essa falha de "programa desligado de
// propósito" pelo próprio `res.ok` do fetch, não por este corpo.
export async function GET() {
  try {
    const config = await obterConfigFidelidadePontos();
    return NextResponse.json({ ativo: config.ativo === true });
  } catch (err) {
    console.error("[ChefeBot] Erro ao ler status publico do programa de pontos:", err);
    return NextResponse.json({ ativo: false }, { status: 503 });
  }
}
