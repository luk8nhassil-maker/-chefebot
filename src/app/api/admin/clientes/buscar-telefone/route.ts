import { NextRequest, NextResponse } from "next/server";
import { lerSessaoAdministrativa } from "@/lib/sessaoAdministrativa";
import { buscarClientePorTelefone, sanitizeTelefoneCliente } from "@/lib/clientes";

export const dynamic = "force-dynamic";

// Busca administrativa de cliente por telefone — usada pelo pedido manual do
// painel para reconhecer o cliente enquanto a atendente digita. Reaproveita
// o mesmo cadastro de perfil (perfil-cliente:{telefone}) já usado pela
// fidelidade, com correspondência normalizada exata (sem DDD fixo, sem
// heurística regional) — nunca um cadastro paralelo.
//
// Retorno mínimo de propósito: nunca expõe pedidos, clienteId ou qualquer
// dado além do nome, e só responde a uma sessão administrativa real
// (cookie verificado no servidor).
export async function GET(req: NextRequest) {
  const sessaoAdmin = await lerSessaoAdministrativa(req);
  if (!sessaoAdmin) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const telefoneParam = req.nextUrl.searchParams.get("telefone") || "";
  const telefone = sanitizeTelefoneCliente(telefoneParam);
  if (telefone.length < 10) {
    return NextResponse.json({ ok: true, encontrado: false });
  }

  try {
    const cliente = await buscarClientePorTelefone(telefone);
    if (!cliente || !cliente.nome) {
      return NextResponse.json({ ok: true, encontrado: false });
    }
    return NextResponse.json({ ok: true, encontrado: true, nome: cliente.nome });
  } catch {
    return NextResponse.json({ ok: false, error: "Busca indisponível" }, { status: 503 });
  }
}
