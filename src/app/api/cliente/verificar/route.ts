import { NextRequest, NextResponse } from "next/server";
import { verificarOtp, criarSessaoCliente, definirCookieSessaoCliente } from "@/lib/clienteAuth";
import { obterOuCriarCliente, normalizarTelefoneClienteBr } from "@/lib/clientes";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const telefone = normalizarTelefoneClienteBr(body?.telefone || "");
    const codigo = String(body?.codigo || "").trim();

    if (telefone.length < 10 || !codigo) {
      return NextResponse.json({ ok: false, error: "Dados inválidos" }, { status: 400 });
    }

    const valido = await verificarOtp(telefone, codigo);
    if (!valido) {
      return NextResponse.json({ ok: false, error: "Código inválido ou expirado" }, { status: 401 });
    }

    const cliente = await obterOuCriarCliente(telefone, body?.nome);
    const token = await criarSessaoCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    const res = NextResponse.json({ ok: true, cliente: { nome: cliente.nome ?? null, telefone: cliente.telefone } });
    definirCookieSessaoCliente(res, token);
    return res;
  } catch (error) {
    console.error("[ChefeBot] Erro ao verificar OTP do cliente:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
