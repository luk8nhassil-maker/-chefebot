import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE, cookieOptionsSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { ativarPontosCliente, derivarClienteIdPorTelefone } from "@/lib/fidelidade";

// POST /api/cliente/fidelidade/ativar — ativa o programa de pontos para o
// cliente já autenticado (cookie cliente-token). Usado quando o cliente
// clica em "Ativar meus pontos" já com sessão válida; o caso "ainda não
// autenticado" ativa direto em /api/cliente/verificar (ver `ativarPontos`
// no corpo daquele endpoint), logo após concluir o login por WhatsApp.
export async function POST(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const payload = await verificarTokenCliente(token);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const clienteIdPontos = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  await ativarPontosCliente(clienteIdPontos);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(CLIENTE_COOKIE, token, cookieOptionsSessaoCliente());
  return res;
}
