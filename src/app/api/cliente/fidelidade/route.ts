import { NextRequest, NextResponse } from "next/server";
import { verificarTokenCliente, CLIENTE_COOKIE, cookieOptionsSessaoCliente } from "@/lib/clienteAuth";
import { buscarClientePorId } from "@/lib/clientes";
import {
  obterExtratoPontos,
  obterConfigFidelidadePontos,
  obterSaldoAntigoPizzas,
  obterRecompensasPontos,
  calcularSaldoDoExtrato,
  calcularPontosPrevistos,
  calcularMetaPontos,
  calcularProgressoPontos,
  ordenarExtratoPontosDesc,
  derivarClienteIdPorTelefone,
  clienteAtivouPontos,
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
  const clienteIdPontos = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;

  const [extratoCompleto, config, pizzasAcumuladas, recompensasCompletas, clienteAtivou] = await Promise.all([
    obterExtratoPontos(clienteIdPontos),
    obterConfigFidelidadePontos(),
    obterSaldoAntigoPizzas(cliente.clienteId).catch(() => 0),
    obterRecompensasPontos(clienteIdPontos),
    clienteAtivouPontos(clienteIdPontos),
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

  // Recompensas abertas (ainda resgatáveis) e histórico separado — o front
  // nunca deve inferir elegibilidade só pelo snapshot `pontosNaDesbloqueio`:
  // a fonte da verdade de "pode resgatar agora" é sempre `metaAtingida`
  // (saldo atual) combinado com `ativo` e a existência de uma recompensa
  // aberta abaixo, revalidados de novo no próprio endpoint de reserva.
  const recompensasAbertas = recompensasCompletas
    .filter((r) => r.status === "disponivel" || r.status === "notificada")
    .map((r) => ({ recompensaId: r.recompensaId, status: r.status, criadoEm: r.createdAt }));

  const recompensasHistorico = recompensasCompletas
    .filter((r) => r.status === "resgatada" || r.status === "expirada")
    .map((r) => ({ recompensaId: r.recompensaId, status: r.status, criadoEm: r.createdAt }));

  const res = NextResponse.json({
    // Ativacao do programa é POR CLIENTE (opt-in explícito na Área do
    // Cliente) — distinta de `ativo`, que é a configuração global da loja.
    // O front nunca mostra saldo/progresso/recompensa quando `clienteAtivou`
    // é false, mesmo que `ativo` seja true.
    clienteAtivou,
    ativo: config.ativo,
    descricaoRecompensa: config.descricaoRecompensa,
    saldoPontos,
    pontosPrevistos,
    metaPontos,
    pontosFaltantes,
    progressoPercentual,
    metaAtingida,
    extrato,
    recompensas: recompensasAbertas,
    recompensasHistorico,
    legado: {
      pizzasAcumuladas,
    },
  });
  res.cookies.set(CLIENTE_COOKIE, token, cookieOptionsSessaoCliente());
  return res;
}
