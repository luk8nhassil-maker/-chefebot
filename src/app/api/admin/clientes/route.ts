import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { listarClientesCadastrados } from "@/lib/clientes";
import { derivarClienteIdPorTelefone, obterConfigFidelidadePontos, obterSaldoPontos, calcularMetaPontos } from "@/lib/fidelidade";
import { obterConfigJornadaChef, obterEstadoJornada, jornadaAtivaParaCliente, derivarFaseAtual } from "@/lib/jornadaChef";

// GET /api/admin/clientes — lista todos os clientes com perfil no app
// (perfil-cliente:*), com o status de cada um nos dois programas de
// fidelidade (pontos e Jornada do Chef). Existe para responder "quem além de
// mim está cadastrado?" sem precisar buscar telefone por telefone na tela de
// Consultar cliente da Jornada do Chef.

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

  const [clientes, configPontos, configJornada] = await Promise.all([
    listarClientesCadastrados(),
    obterConfigFidelidadePontos(),
    obterConfigJornadaChef(),
  ]);
  const metaPontos = calcularMetaPontos(configPontos);

  const lista = await Promise.all(
    clientes.map(async (cliente) => {
      const clienteId = derivarClienteIdPorTelefone(cliente.telefone);
      if (!clienteId) {
        return {
          telefone: cliente.telefone,
          nome: cliente.nome ?? null,
          createdAt: cliente.createdAt,
          fidelidadePontos: null,
          jornada: null,
        };
      }

      const [saldoPontos, estadoJornada] = await Promise.all([
        obterSaldoPontos(clienteId),
        obterEstadoJornada(clienteId),
      ]);

      return {
        telefone: cliente.telefone,
        nome: cliente.nome ?? null,
        createdAt: cliente.createdAt,
        fidelidadePontos: {
          ativo: configPontos.ativo,
          disponivel: saldoPontos.disponivel,
          meta: metaPontos,
        },
        jornada: {
          participando: jornadaAtivaParaCliente(configJornada, clienteId),
          cicloAtual: estadoJornada.cicloAtual,
          pizzasNoCiclo: estadoJornada.pizzasNoCiclo,
          faseAtual: derivarFaseAtual(estadoJornada.pizzasNoCiclo, configJornada.metaPizzas),
          totalJornadasConcluidas: estadoJornada.totalJornadasConcluidas,
        },
      };
    })
  );

  lista.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return NextResponse.json({ clientes: lista, total: lista.length });
}
