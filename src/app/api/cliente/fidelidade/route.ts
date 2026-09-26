import { NextRequest, NextResponse } from "next/server";
import { lerSessaoCliente } from "@/lib/clienteAuth";
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
  calcularSaldoEstrelas,
  estrelasV1Ativa,
  metaEstrelasDaConfig,
  classificarOrigemMovimentoPontos,
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
  // Sessão via cookie HttpOnly ou, em navegadores sem cookie confiável
  // (WhatsApp no iPhone), via Authorization: Bearer com sessão opaca.
  const payload = await lerSessaoCliente(req);
  if (!payload) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const cliente = await buscarClientePorId(payload.clienteId);
  if (!cliente) return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limite = resolverLimite(searchParams);
  const clienteIdPontos = derivarClienteIdPorTelefone(cliente.telefone) ?? cliente.clienteId;

  const [extratoCompleto, config, pizzasAcumuladas, recompensasCompletas] = await Promise.all([
    obterExtratoPontos(clienteIdPontos),
    obterConfigFidelidadePontos(),
    obterSaldoAntigoPizzas(cliente.clienteId).catch(() => 0),
    obterRecompensasPontos(clienteIdPontos),
  ]);

  const estrelasAtivas = estrelasV1Ativa(config);
  const saldoPontos = estrelasAtivas ? calcularSaldoEstrelas(extratoCompleto) : calcularSaldoDoExtrato(extratoCompleto);
  const pontosPrevistos = calcularPontosPrevistos(estrelasAtivas
    ? extratoCompleto.filter((movimento) => movimento.regraVersao === config.regraVersao)
    : extratoCompleto);
  const metaPontos = estrelasAtivas ? metaEstrelasDaConfig(config) : calcularMetaPontos(config);
  const { pontosFaltantes, progressoPercentual, metaAtingida } = calcularProgressoPontos(saldoPontos, metaPontos);

  const extratoVisivel = estrelasAtivas
    ? extratoCompleto.filter((movimento) => movimento.regraVersao === config.regraVersao)
    : extratoCompleto;
  const extrato = ordenarExtratoPontosDesc(extratoVisivel)
    .slice(0, limite)
    .map((m) => ({
      id: m.movimentoId,
      pedidoId: m.pedidoId ?? null,
      tipo: m.tipo,
      pontos: m.pontos,
      ...(m.unidade ? { unidade: m.unidade } : {}),
      descricao: m.motivo,
      criadoEm: m.createdAt,
      // Origem estruturada (a partir do eventoId interno, nunca da
      // descrição em texto livre) — usada pelo cliente para reconhecer uma
      // indicação convertida sem depender de regex sobre `descricao`.
      origem: classificarOrigemMovimentoPontos(m.eventoId ?? null),
    }));

  // Recompensas abertas (ainda resgatáveis) e histórico separado — o front
  // nunca deve inferir elegibilidade só pelo snapshot `pontosNaDesbloqueio`:
  // a fonte da verdade de "pode resgatar agora" é sempre `metaAtingida`
  // (saldo atual) combinado com `ativo` e a existência de uma recompensa
  // aberta abaixo, revalidados de novo no próprio endpoint de reserva.
  const recompensasAbertas = recompensasCompletas
    .filter(() => !estrelasAtivas || config.coberturaEconomicaAprovada === true)
    .filter((r) => r.status === "disponivel" || r.status === "notificada")
    .map((r) => ({
      recompensaId: r.recompensaId,
      status: r.status,
      criadoEm: r.createdAt,
      descricao: r.descricaoRecompensa ?? config.descricaoRecompensa,
    }));

  const recompensasHistorico = recompensasCompletas
    .filter((r) => r.status === "resgatada" || r.status === "expirada")
    .map((r) => ({
      recompensaId: r.recompensaId,
      status: r.status,
      criadoEm: r.createdAt,
      descricao: r.descricaoRecompensa ?? config.descricaoRecompensa,
    }));

  return NextResponse.json({
    ativo: config.ativo,
    unidade: estrelasAtivas ? "estrelas" : "pontos",
    regraVersao: estrelasAtivas ? config.regraVersao : null,
    descricaoRecompensa: config.descricaoRecompensa,
    saldoPontos,
    saldoEstrelas: estrelasAtivas ? saldoPontos : 0,
    pontosPrevistos,
    metaPontos,
    metaEstrelas: estrelasAtivas ? metaPontos : 0,
    pontosFaltantes,
    estrelasFaltantes: estrelasAtivas ? pontosFaltantes : 0,
    progressoPercentual,
    metaAtingida,
    marcoEstrelasAtingido: estrelasAtivas ? metaAtingida : false,
    extrato,
    recompensas: recompensasAbertas,
    recompensasHistorico,
    legado: {
      pizzasAcumuladas,
    },
  });
}
