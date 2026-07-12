import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import {
  obterExtratoPontos,
  obterConfigFidelidadePontos,
  obterSaldoAntigoPizzas,
  calcularSaldoDoExtrato,
  calcularPontosPrevistos,
  calcularMetaPontos,
  calcularProgressoPontos,
  ordenarExtratoPontosDesc,
} from "@/lib/fidelidade";

// GET /api/cliente/fidelidade — saldo, progresso e extrato da fidelidade por
// pontos do cliente autenticado (Etapa 3). Só lê os dados do dono da sessão
// (cliente-token): nenhum identificador arbitrário vindo do frontend (query,
// body) é aceito para selecionar a conta. Modelo antigo (pizzas) é exposto só
// como "legado", separado do saldo em pontos, nunca somado a ele.

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

function resolverLimite(searchParams: URLSearchParams): number {
  const bruto = searchParams.get("limit");
  if (!bruto) return LIMITE_PADRAO;
  const numero = parseInt(bruto, 10);
  if (!Number.isFinite(numero) || numero <= 0) return LIMITE_PADRAO;
  return Math.min(numero, LIMITE_MAXIMO);
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(CLIENTE_COOKIE)?.value ?? null;
  if (!token) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const payload = await verificarTokenCliente(token);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limite = resolverLimite(searchParams);

  const [extratoCompleto, config, pizzasAcumuladas] = await Promise.all([
    obterExtratoPontos(cliente.clienteId),
    obterConfigFidelidadePontos(),
    obterSaldoAntigoPizzas(cliente.clienteId).catch(() => 0),
  ]);

  const saldoPontos = calcularSaldoDoExtrato(extratoCompleto);
  const pontosPrevistos = calcularPontosPrevistos(extratoCompleto);
  const metaPontos = calcularMetaPontos(config);
  const { pontosFaltantes, progressoPercentual, metaAtingida } = calcularProgressoPontos(saldoPontos, metaPontos);

  const extrato = ordenarExtratoPontosDesc(extratoCompleto)
    .slice(0, limite)
    .map((m) => ({
      id: m.movimentoId,
      pedidoId: m.pedidoId ?? null,
      tipo: m.tipo,
      pontos: m.pontos,
      descricao: m.motivo,
      criadoEm: m.createdAt,
    }));

  const recompensa = config.recompensa
    ? {
        ativa: config.recompensa.ativa,
        custoPontos: config.recompensa.custoPontos,
        tipo: config.recompensa.tipo,
        descricao: config.recompensa.descricao,
        disponivel: config.recompensa.ativa && saldoPontos >= config.recompensa.custoPontos,
      }
    : null;

  return NextResponse.json({
    saldoPontos,
    pontosPrevistos,
    metaPontos,
    pontosFaltantes,
    progressoPercentual,
    metaAtingida,
    extrato,
    recompensa,
    legado: {
      pizzasAcumuladas,
    },
  });
}
