import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import { derivarClienteIdPorTelefone } from "@/lib/fidelidade";
import {
  obterConfigJornadaChef,
  obterEstadoJornada,
  obterRecompensasCliente,
  derivarFaseAtual,
  calcularMensagemProgresso,
  jornadaAtivaParaCliente,
} from "@/lib/jornadaChef";

// GET /api/cliente/jornada-chef — progresso da trilha e presentes do cliente
// autenticado (Jornada do Chef, camada separada dos pontos). Só lê os dados
// do dono da sessão: nenhum identificador vindo do frontend é aceito.
//
// Rollout canário: um cliente fora de `jornadaAtivaParaCliente` não vê a
// trilha/progresso/presentes — nem os que já existiam antes de sair da
// lista canário (rule 3). O dado continua intacto no Redis, só não é
// exposto para ele enquanto não estiver elegível de novo.

export async function GET(req: NextRequest) {
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const clienteIdJornada = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;
  const config = await obterConfigJornadaChef();

  if (!jornadaAtivaParaCliente(config, clienteIdJornada)) {
    return NextResponse.json({ ativo: false });
  }

  const [estado, recompensas] = await Promise.all([
    obterEstadoJornada(clienteIdJornada),
    obterRecompensasCliente(clienteIdJornada),
  ]);

  const faseAtual = derivarFaseAtual(estado.pizzasNoCiclo, config.metaPizzas);
  const mensagem = calcularMensagemProgresso(estado.pizzasNoCiclo, config.metaPizzas);

  const caixasFechadas = recompensas.filter((r) => r.status === "fechada");
  const disponiveis = recompensas.filter((r) => r.status === "disponivel");
  const reservadas = recompensas.filter((r) => r.status === "reservada");
  const historico = recompensas.filter((r) => ["resgatada", "expirada", "cancelada", "suspensa"].includes(r.status));

  return NextResponse.json({
    ativo: true,
    metaPizzas: config.metaPizzas,
    limitePizzasPorPedido: config.limitePizzasPorPedido,
    cicloAtual: estado.cicloAtual,
    pizzasNoCiclo: estado.pizzasNoCiclo,
    faltam: Math.max(0, config.metaPizzas - estado.pizzasNoCiclo),
    faseAtual,
    mensagem,
    totalJornadasConcluidas: estado.totalJornadasConcluidas,
    textos: config.textos,
    caixasFechadas: caixasFechadas.map((r) => ({ recompensaId: r.recompensaId, ciclo: r.ciclo, criadoEm: r.criadaEm })),
    recompensasDisponiveis: disponiveis.map((r) => ({
      recompensaId: r.recompensaId,
      tipo: r.tipo,
      produtoNome: r.produtoNome,
      abertaEm: r.abertaEm,
      validaAte: r.validaAte,
    })),
    recompensasReservadas: reservadas.map((r) => ({ recompensaId: r.recompensaId, produtoNome: r.produtoNome, validaAte: r.validaAte })),
    historico: historico.map((r) => ({ recompensaId: r.recompensaId, status: r.status, produtoNome: r.produtoNome, criadoEm: r.criadaEm })),
  });
}
