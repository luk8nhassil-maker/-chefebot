import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { resolverSessaoCliente, definirCookieSessaoCliente } from "@/lib/clienteAuth";
import {
  calcularSaldoDoExtrato,
  derivarClienteIdPorTelefone,
  mascararIdentidadePontos,
  obterExtratoPontos,
  reconciliarPontosClientePedidos,
  type ResultadoConfirmarCompraPontos,
} from "@/lib/fidelidade";

const LIMITE_RECONCILIACAO = 50;
const DIAS_RECONCILIACAO = 90;

function sanitizarResultado(resultado: ResultadoConfirmarCompraPontos) {
  return {
    pedidoId: resultado.pedidoId,
    numero: resultado.numero,
    elegivel: resultado.elegivel,
    motivo: resultado.motivo,
    gates: resultado.gates,
    origemProprietario: resultado.origemProprietario,
    origemConfirmacao: resultado.origemConfirmacao,
    proprietarioClienteIdMascarado: resultado.proprietarioClienteIdMascarado,
    pontosCalculados: resultado.pontosCalculados,
    movimentoGravado: !!resultado.movimento,
    eventoId: resultado.movimento?.eventoId,
    confirmacaoPersistida: resultado.confirmacaoPersistida === true,
  };
}

export async function POST(req: NextRequest) {
  const sessao = await resolverSessaoCliente(req);
  if (!sessao) return NextResponse.json({ ok: false, error: "Nao autorizado" }, { status: 401 });
  const { cliente } = sessao;
  const clienteIdPontos = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;

  try {
    const pedidos = (await redis.get<Parameters<typeof reconciliarPontosClientePedidos>[1]>("pedidos")) || [];
    const resumo = await reconciliarPontosClientePedidos(cliente, pedidos, {
      limite: LIMITE_RECONCILIACAO,
      dias: DIAS_RECONCILIACAO,
    });
    const extrato = await obterExtratoPontos(clienteIdPontos);
    const saldoPontos = calcularSaldoDoExtrato(extrato);

    const res = NextResponse.json({
      ok: true,
      clienteIdMascarado: mascararIdentidadePontos(clienteIdPontos),
      verificados: resumo.verificados,
      creditados: resumo.creditados,
      saldoPontos,
      detalhes: resumo.detalhes.map(sanitizarResultado),
    });
    if (sessao.deveRenovar && sessao.novoToken) definirCookieSessaoCliente(res, sessao.novoToken);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro_desconhecido";
    console.error("[ChefeBot] Erro ao reconciliar pontos do cliente:", {
      clienteId: mascararIdentidadePontos(clienteIdPontos),
      erro: message,
    });
    const status = /lock|bloqueio/i.test(message) ? 409 : 502;
    return NextResponse.json(
      {
        ok: false,
        error: status === 409 ? "FALHA_LOCK_REPROCESSAVEL" : "FALHA_REDIS_OU_RECONCILIACAO",
        retryable: true,
      },
      { status }
    );
  }
}
