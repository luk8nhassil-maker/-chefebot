import { NextRequest, NextResponse } from "next/server";
import { verificarOtp, criarTokenCliente, CLIENTE_COOKIE, cookieOptionsSessaoCliente } from "@/lib/clienteAuth";
import { obterOuCriarCliente, sanitizeTelefoneCliente } from "@/lib/clientes";
import { ativarPontosCliente, derivarClienteIdPorTelefone } from "@/lib/fidelidade";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const telefone = sanitizeTelefoneCliente(body?.telefone || "");
    const codigo = String(body?.codigo || "").trim();

    if (telefone.length < 10 || !codigo) {
      return NextResponse.json({ ok: false, error: "Dados inválidos" }, { status: 400 });
    }

    const valido = await verificarOtp(telefone, codigo);
    if (!valido) {
      return NextResponse.json({ ok: false, error: "Código inválido ou expirado" }, { status: 401 });
    }

    const cliente = await obterOuCriarCliente(telefone, body?.nome);
    const token = await criarTokenCliente({ clienteId: cliente.clienteId, telefone: cliente.telefone });

    // Ativacao do programa de pontos direto do fluxo "Ativar meus pontos" sem
    // sessao previa: o front pede login primeiro e sinaliza aqui a intencao,
    // para o programa ser ativado assim que a autenticacao for concluida.
    if (body?.ativarPontos === true) {
      const clienteIdPontos = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
      try {
        await ativarPontosCliente(clienteIdPontos);
      } catch (err) {
        console.error("[ChefeBot] Erro ao ativar pontos apos login (ignorado):", err);
      }
    }

    const res = NextResponse.json({ ok: true, cliente: { nome: cliente.nome ?? null, telefone: cliente.telefone } });
    res.cookies.set(CLIENTE_COOKIE, token, cookieOptionsSessaoCliente());
    return res;
  } catch (error) {
    console.error("[ChefeBot] Erro ao verificar OTP do cliente:", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
