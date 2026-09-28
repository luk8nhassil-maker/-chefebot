import type { EventoAnalitico } from "./historicoAnalitico";

export type QuantisCalibracao = {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
};

export type CalibracaoComportamentalCofre = {
  schemaVersao: 1;
  modo: "calibracao_somente_leitura";
  clientesParticipantesObservados: number;
  cobertura: {
    inicioSolicitadoMs: number;
    fimSolicitadoMs: number;
    primeiroEventoObservadoMs: number | null;
    ultimoEventoObservadoMs: number | null;
    diasObservados: number | null;
  };
  recorrencia: {
    clientesCom1Pedido: number;
    clientesCom2OuMaisPedidos: number;
    clientesCom3OuMaisPedidos: number;
    clientesComCadenciaIndividual: number;
    intervalosObservados: number;
    intervaloEntrePedidosDias: QuantisCalibracao;
    razaoGapAtualSobreMedianaIndividual: QuantisCalibracao;
  };
  ticket: {
    pedidosValidos: number;
    ticketElegivelCents: QuantisCalibracao;
    clientesComBaseParaCompararUltimoTicket: number;
    razaoUltimoTicketSobreMedianaAnterior: QuantisCalibracao;
  };
  ativacaoAutomatica: {
    permitida: false;
    motivo: "calibracao_nao_define_regra_comercial";
  };
};

const DIA_MS = 24 * 60 * 60 * 1000;

function quantilLinear(valores: number[], p: number): number | null {
  const validos = valores
    .filter((valor) => Number.isFinite(valor))
    .sort((a, b) => a - b);
  if (validos.length === 0) return null;
  if (validos.length === 1) return validos[0]!;
  const pos = (validos.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const atual = validos[base]!;
  const proximo = validos[Math.min(base + 1, validos.length - 1)]!;
  return atual + (proximo - atual) * resto;
}

function arredondar(valor: number | null, casas = 2): number | null {
  if (valor === null) return null;
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

function quantis(valores: number[], casas = 2): QuantisCalibracao {
  return {
    p25: arredondar(quantilLinear(valores, 0.25), casas),
    p50: arredondar(quantilLinear(valores, 0.5), casas),
    p75: arredondar(quantilLinear(valores, 0.75), casas),
    p90: arredondar(quantilLinear(valores, 0.9), casas),
  };
}

function mediana(valores: number[]): number | null {
  return quantilLinear(valores, 0.5);
}

function diasEntre(inicioMs: number, fimMs: number): number {
  return (fimMs - inicioMs) / DIA_MS;
}

/**
 * Agrega sinais sem expor clienteId e sem escolher thresholds operacionais.
 *
 * A função recebe somente participantes do Ranking previamente filtrados pelo
 * chamador. Qualquer evento estornado, não positivo ou fora da janela é
 * descartado.
 */
export function calibrarComportamentoCofre(params: {
  eventos: EventoAnalitico[];
  participantes: ReadonlySet<string>;
  inicioMs: number;
  fimMs: number;
  agoraMs?: number;
}): CalibracaoComportamentalCofre {
  const agoraMs = Number.isFinite(params.agoraMs)
    ? Math.trunc(params.agoraMs as number)
    : params.fimMs;

  const validos = (Array.isArray(params.eventos) ? params.eventos : [])
    .filter((evento) =>
      params.participantes.has(evento.clienteId)
      && evento.statusAnalitico === "entregue"
      && Number.isFinite(evento.criadoEmMs)
      && evento.criadoEmMs >= params.inicioMs
      && evento.criadoEmMs <= params.fimMs
      && Number.isFinite(evento.valorElegivelCents)
      && evento.valorElegivelCents > 0,
    )
    .sort((a, b) => a.criadoEmMs - b.criadoEmMs);

  const porCliente = new Map<string, EventoAnalitico[]>();
  for (const evento of validos) {
    const lista = porCliente.get(evento.clienteId) ?? [];
    lista.push(evento);
    porCliente.set(evento.clienteId, lista);
  }

  let clientesCom1Pedido = 0;
  let clientesCom2OuMaisPedidos = 0;
  let clientesCom3OuMaisPedidos = 0;
  let clientesComCadenciaIndividual = 0;
  let clientesComBaseParaCompararUltimoTicket = 0;

  const intervalosDias: number[] = [];
  const razoesGapAtual: number[] = [];
  const razoesUltimoTicket: number[] = [];

  for (const eventosCliente of porCliente.values()) {
    const quantidade = eventosCliente.length;
    if (quantidade === 1) clientesCom1Pedido += 1;
    if (quantidade >= 2) clientesCom2OuMaisPedidos += 1;
    if (quantidade >= 3) clientesCom3OuMaisPedidos += 1;

    const intervalosCliente: number[] = [];
    for (let i = 1; i < quantidade; i++) {
      const intervalo = diasEntre(
        eventosCliente[i - 1]!.criadoEmMs,
        eventosCliente[i]!.criadoEmMs,
      );
      if (intervalo > 0) {
        intervalosCliente.push(intervalo);
        intervalosDias.push(intervalo);
      }
    }

    // Para estimar o ritmo individual exigimos pelo menos 2 intervalos
    // observados (3 compras). Isso evita chamar uma única repetição de "padrão".
    if (intervalosCliente.length >= 2) {
      const medianaIntervalo = mediana(intervalosCliente);
      const ultimo = eventosCliente[eventosCliente.length - 1]!;
      if (medianaIntervalo !== null && medianaIntervalo > 0 && agoraMs >= ultimo.criadoEmMs) {
        clientesComCadenciaIndividual += 1;
        razoesGapAtual.push(diasEntre(ultimo.criadoEmMs, agoraMs) / medianaIntervalo);
      }
    }

    // Comparação de ticket usa o último pedido contra a mediana dos pedidos
    // ANTERIORES. O próprio último ticket nunca entra na sua referência.
    if (quantidade >= 3) {
      const anteriores = eventosCliente
        .slice(0, -1)
        .map((evento) => evento.valorElegivelCents);
      const referencia = mediana(anteriores);
      const ultimoTicket = eventosCliente[quantidade - 1]!.valorElegivelCents;
      if (referencia !== null && referencia > 0) {
        clientesComBaseParaCompararUltimoTicket += 1;
        razoesUltimoTicket.push(ultimoTicket / referencia);
      }
    }
  }

  const primeiroEvento = validos[0]?.criadoEmMs ?? null;
  const ultimoEvento = validos[validos.length - 1]?.criadoEmMs ?? null;

  return {
    schemaVersao: 1,
    modo: "calibracao_somente_leitura",
    clientesParticipantesObservados: porCliente.size,
    cobertura: {
      inicioSolicitadoMs: params.inicioMs,
      fimSolicitadoMs: params.fimMs,
      primeiroEventoObservadoMs: primeiroEvento,
      ultimoEventoObservadoMs: ultimoEvento,
      diasObservados:
        primeiroEvento !== null && ultimoEvento !== null && ultimoEvento >= primeiroEvento
          ? arredondar(diasEntre(primeiroEvento, ultimoEvento), 1)
          : null,
    },
    recorrencia: {
      clientesCom1Pedido,
      clientesCom2OuMaisPedidos,
      clientesCom3OuMaisPedidos,
      clientesComCadenciaIndividual,
      intervalosObservados: intervalosDias.length,
      intervaloEntrePedidosDias: quantis(intervalosDias, 1),
      razaoGapAtualSobreMedianaIndividual: quantis(razoesGapAtual, 2),
    },
    ticket: {
      pedidosValidos: validos.length,
      ticketElegivelCents: quantis(
        validos.map((evento) => evento.valorElegivelCents),
        0,
      ),
      clientesComBaseParaCompararUltimoTicket,
      razaoUltimoTicketSobreMedianaAnterior: quantis(razoesUltimoTicket, 2),
    },
    ativacaoAutomatica: {
      permitida: false,
      motivo: "calibracao_nao_define_regra_comercial",
    },
  };
}
