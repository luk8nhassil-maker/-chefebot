import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import { sanitizeTelefoneCliente } from "@/lib/clientes";
import { obterEstadoJornada, obterRecompensasCliente, obterConfigJornadaChef, derivarFaseAtual, jornadaAtivaParaCliente } from "@/lib/jornadaChef";

// GET /api/admin/jornada-chef?telefone=... — painel da Kellyne: progresso,
// ciclo, pizzas na trilha, caixas e recompensas de um cliente pelo telefone
// (fallback manual, rule 15). Não expõe dados pessoais além do necessário.

async function checkAuth(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value ?? null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !["admin", "atendente", "dev"].includes(payload.role as string)) return null;
  return payload;
}

export async function GET(req: NextRequest) {
  const auth = await checkAuth(req);
  if (!auth) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const telefone = new URL(req.url).searchParams.get("telefone") || "";
  const sanitizado = sanitizeTelefoneCliente(telefone);
  if (sanitizado.length < 10) return NextResponse.json({ error: "Telefone invalido" }, { status: 400 });

  const clienteId = derivarClienteIdPorTelefone(sanitizado)!;
  const [config, estado, recompensas] = await Promise.all([
    obterConfigJornadaChef(),
    obterEstadoJornada(clienteId),
    obterRecompensasCliente(clienteId),
  ]);

  return NextResponse.json({
    modoRollout: config.modoRollout,
    ativoParaEsteCliente: jornadaAtivaParaCliente(config, clienteId),
    metaPizzas: config.metaPizzas,
    cicloAtual: estado.cicloAtual,
    pizzasNoCiclo: estado.pizzasNoCiclo,
    faseAtual: derivarFaseAtual(estado.pizzasNoCiclo, config.metaPizzas),
    totalJornadasConcluidas: estado.totalJornadasConcluidas,
    recompensas: recompensas.map((r) => ({
      recompensaId: r.recompensaId,
      ciclo: r.ciclo,
      status: r.status,
      tipo: r.tipo,
      produtoNome: r.produtoNome,
      codigoPublico: r.status === "resgatada" || r.status === "cancelada" ? undefined : r.codigoPublico,
      pedidoOrigemId: r.pedidoOrigemId,
      reservaPedidoId: r.reservaPedidoId,
      criadaEm: r.criadaEm,
      abertaEm: r.abertaEm,
      validaAte: r.validaAte,
      resgatadaEm: r.resgatadaEm,
      motivoSuspensao: r.motivoSuspensao,
    })),
  });
}
