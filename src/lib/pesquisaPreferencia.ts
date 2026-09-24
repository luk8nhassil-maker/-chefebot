import type { EventoAnalitico } from "./historicoAnalitico";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export type MomentoPesquisaId =
  | "M0"
  | "M1"
  | "M2"
  | "M3"
  | "M4"
  | "M5"
  | "M6"
  | "M7"
  | "M8"
  | "M9"
  | "M10"
  | "M11"
  | "M12"
  | "M13"
  | "M14";

export type EstadoComportamentalId =
  | "S0"
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5"
  | "S6"
  | "S7"
  | "S8"
  | "S9"
  | "S10"
  | "S11";

type MomentoPesquisa = {
  id: MomentoPesquisaId;
  nome: string;
  perguntaPrincipal: string | null;
  objetivo: string;
  fonte: "analytics" | "evento_operacional" | "teste_moderado" | "painel_longitudinal";
};

export const MOMENTOS_PESQUISA: readonly MomentoPesquisa[] = [
  {
    id: "M0",
    nome: "Baseline passivo",
    perguntaPrincipal: null,
    objetivo: "Observar comportamento sem interromper o cliente.",
    fonte: "analytics",
  },
  {
    id: "M1",
    nome: "Primeira compra observada",
    perguntaPrincipal: "Pensando neste pedido de hoje: o que mais pesou para você escolher a Chefe da Pizza?",
    objetivo: "Entender os mecanismos reais de escolha e aquisição.",
    fonte: "analytics",
  },
  {
    id: "M2",
    nome: "Segunda compra observada",
    perguntaPrincipal: "O que fez você escolher a gente de novo desta vez?",
    objetivo: "Entender o que transforma primeira compra em retorno.",
    fonte: "analytics",
  },
  {
    id: "M3",
    nome: "Recorrência em formação",
    perguntaPrincipal: "Quando bate vontade de pedir pizza, quais lugares costumam vir primeiro à sua cabeça?",
    objetivo: "Entender memória de marca e conjunto competitivo espontâneo.",
    fonte: "analytics",
  },
  {
    id: "M4",
    nome: "Recorrente atual",
    perguntaPrincipal: "Me conta da última vez em que você quase pediu em outro lugar. O que aconteceu?",
    objetivo: "Descobrir vulnerabilidades mesmo entre clientes recorrentes.",
    fonte: "analytics",
  },
  {
    id: "M5",
    nome: "Queda de frequência",
    perguntaPrincipal: "Percebi que faz um tempo desde seu último pedido. O que mudou nesse período?",
    objetivo: "Descobrir causas reais de esfriamento sem presumir abandono.",
    fonte: "analytics",
  },
  {
    id: "M6",
    nome: "Retorno após ausência",
    perguntaPrincipal: "O que fez você voltar a pedir aqui hoje?",
    objetivo: "Entender gatilhos reais de recuperação.",
    fonte: "analytics",
  },
  {
    id: "M7",
    nome: "Fricção resolvida",
    perguntaPrincipal: "Quero entender o que aconteceu para evitar repetir isso. Em que momento a experiência deixou de funcionar para você?",
    objetivo: "Localizar o ponto da jornada em que a experiência falhou.",
    fonte: "evento_operacional",
  },
  {
    id: "M8",
    nome: "Abandono de carrinho ou checkout",
    perguntaPrincipal: "O que fez você parar antes de concluir o pedido?",
    objetivo: "Descobrir fricções de conversão sem interromper o checkout.",
    fonte: "evento_operacional",
  },
  {
    id: "M9",
    nome: "Primeira leitura da fidelidade",
    perguntaPrincipal: "Olhe esta tela como se eu não estivesse aqui. Me diga o que você acha que está acontecendo e o que faria em seguida.",
    objetivo: "Medir compreensão espontânea de Estrelas, progresso, ranking e indicação.",
    fonte: "teste_moderado",
  },
  {
    id: "M10",
    nome: "Compartilhamento ou indicação",
    perguntaPrincipal: "O que estava acontecendo quando você decidiu compartilhar com essa pessoa?",
    objetivo: "Entender motivação social real para indicar.",
    fonte: "evento_operacional",
  },
  {
    id: "M11",
    nome: "Cliente indicado que compra",
    perguntaPrincipal: "Como você chegou até a Chefe da Pizza desta vez?",
    objetivo: "Medir a influência real da recomendação sem induzir a resposta.",
    fonte: "evento_operacional",
  },
  {
    id: "M12",
    nome: "Painel longitudinal de ocasiões",
    perguntaPrincipal: "Você decidiu pedir pizza hoje? Me conta o que aconteceu desde a vontade até escolher o lugar.",
    objetivo: "Observar ocasiões inclusive quando o cliente escolhe um concorrente.",
    fonte: "painel_longitudinal",
  },
  {
    id: "M13",
    nome: "Compra atípica",
    perguntaPrincipal: "Esse pedido de hoje foi diferente do seu normal? O que estava acontecendo?",
    objetivo: "Descobrir ocasiões que alteram o comportamento habitual.",
    fonte: "evento_operacional",
  },
  {
    id: "M14",
    nome: "Entrevista de aprofundamento",
    perguntaPrincipal: null,
    objetivo: "Aprofundar padrões novos, contraditórios ou de alto impacto.",
    fonte: "teste_moderado",
  },
] as const;

type TipoContagemMomento = "baseline" | "oportunidade_na_janela" | "candidato_atual" | "nao_calculado";

export type ResumoMomentoPesquisa = {
  id: MomentoPesquisaId;
  nome: string;
  tipo: TipoContagemMomento;
  quantidade: number;
  perguntaPrincipal: string | null;
  objetivo: string;
  calculavelComAnalytics: boolean;
};

export type ResumoPesquisaPreferencia = {
  modo: "dry-run";
  janela: {
    inicioIso: string;
    fimIso: string;
    primeiroEventoObservadoIso: string | null;
    ultimoEventoObservadoIso: string | null;
  };
  cobertura: {
    pedidosValidosObservados: number;
    ocasioesCompraObservadas: number;
    clientesObservados: number;
    intervalosEntreComprasObservados: number;
    intervalosEntreOcasioesObservados: number;
    clientesComHistoricoSuficienteParaQueda: number;
    clientesSemHistoricoSuficienteParaQueda: number;
    primeiraCompraObservadaNaoEquivaleAPrimeiraCompraVitalicia: true;
  };
  segmentacaoQueda: {
    minimoOcasioesParaCompararRitmo: 3;
    minimoIntervalosHistoricosPorCliente: 2;
    regra: "gap_atual_supera_quantil_do_cliente_e_da_populacao";
  };
  calibracao: {
    medianaIntervaloDias: number | null;
    p75IntervaloDias: number | null;
    p90IntervaloDias: number | null;
    origemDosLimiares: "quantis_do_historico_observado";
  };
  estadosAtuais: Record<EstadoComportamentalId, number>;
  momentos: Record<MomentoPesquisaId, ResumoMomentoPesquisa>;
  observacoes: string[];
};

function quantilNearestRank(valores: number[], q: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.max(0, Math.min(ordenados.length - 1, Math.ceil(q * ordenados.length) - 1));
  return ordenados[indice];
}

function emDias(ms: number | null): number | null {
  if (ms === null) return null;
  return Number((ms / MS_POR_DIA).toFixed(2));
}

function recordEstadosVazio(): Record<EstadoComportamentalId, number> {
  return {
    S0: 0,
    S1: 0,
    S2: 0,
    S3: 0,
    S4: 0,
    S5: 0,
    S6: 0,
    S7: 0,
    S8: 0,
    S9: 0,
    S10: 0,
    S11: 0,
  };
}

type OcasiaoCompra = {
  expedienteId: string;
  criadoEmMs: number;
};

function agruparOcasioesPorCliente(eventos: EventoAnalitico[]): Map<string, OcasiaoCompra[]> {
  const porCliente = new Map<string, Map<string, OcasiaoCompra>>();

  for (const evento of eventos) {
    if (evento.statusAnalitico !== "entregue") continue;

    // Um expediente operacional representa uma ocasião de compra. Se houver
    // mais de um pedido na mesma noite, mantemos apenas o instante mais recente
    // para não transformar pedido complementar/correção em "recompra".
    const chaveOcasiao = evento.expedienteId?.trim() || `pedido:${evento.pedidoId}`;
    const porExpediente = porCliente.get(evento.clienteId) ?? new Map<string, OcasiaoCompra>();
    const atual = porExpediente.get(chaveOcasiao);

    if (!atual || evento.criadoEmMs > atual.criadoEmMs) {
      porExpediente.set(chaveOcasiao, {
        expedienteId: chaveOcasiao,
        criadoEmMs: evento.criadoEmMs,
      });
    }

    porCliente.set(evento.clienteId, porExpediente);
  }

  const grupos = new Map<string, OcasiaoCompra[]>();
  for (const [clienteId, porExpediente] of porCliente.entries()) {
    grupos.set(
      clienteId,
      [...porExpediente.values()].sort((a, b) => a.criadoEmMs - b.criadoEmMs)
    );
  }
  return grupos;
}

function calcularIntervalosLista(ocasioes: OcasiaoCompra[]): number[] {
  const intervalos: number[] = [];
  for (let i = 1; i < ocasioes.length; i += 1) {
    const gap = ocasioes[i].criadoEmMs - ocasioes[i - 1].criadoEmMs;
    if (gap > 0) intervalos.push(gap);
  }
  return intervalos;
}

function calcularIntervalos(grupos: Map<string, OcasiaoCompra[]>): number[] {
  return [...grupos.values()].flatMap(calcularIntervalosLista);
}

function montarMomentosVazios(): Record<MomentoPesquisaId, ResumoMomentoPesquisa> {
  return Object.fromEntries(
    MOMENTOS_PESQUISA.map((momento) => [
      momento.id,
      {
        id: momento.id,
        nome: momento.nome,
        tipo: momento.id === "M0" ? "baseline" : "nao_calculado",
        quantidade: 0,
        perguntaPrincipal: momento.perguntaPrincipal,
        objetivo: momento.objetivo,
        calculavelComAnalytics: momento.fonte === "analytics",
      } satisfies ResumoMomentoPesquisa,
    ])
  ) as Record<MomentoPesquisaId, ResumoMomentoPesquisa>;
}

export function analisarPesquisaPreferencia(
  eventos: EventoAnalitico[],
  opcoes: { agoraMs: number; janelaInicioMs: number }
): ResumoPesquisaPreferencia {
  const { agoraMs, janelaInicioMs } = opcoes;
  const validos = eventos
    .filter((evento) => evento.statusAnalitico === "entregue")
    .sort((a, b) => a.criadoEmMs - b.criadoEmMs);
  const grupos = agruparOcasioesPorCliente(validos);
  const intervalos = calcularIntervalos(grupos);
  const ocasioesCompraObservadas = [...grupos.values()].reduce(
    (total, ocasioes) => total + ocasioes.length,
    0
  );
  const clientesComHistoricoSuficienteParaQueda = [...grupos.values()].filter(
    (ocasioes) => ocasioes.length >= 3
  ).length;
  const clientesSemHistoricoSuficienteParaQueda =
    grupos.size - clientesComHistoricoSuficienteParaQueda;

  const p50 = quantilNearestRank(intervalos, 0.5);
  const p75 = quantilNearestRank(intervalos, 0.75);
  const p90 = quantilNearestRank(intervalos, 0.9);

  const estados = recordEstadosVazio();
  const momentos = montarMomentosVazios();
  momentos.M0.quantidade = grupos.size;

  let oportunidadesM1 = 0;
  let oportunidadesM2 = 0;
  let candidatosM3 = 0;
  let candidatosM4 = 0;
  let candidatosM5 = 0;
  let oportunidadesM6 = 0;

  for (const ocasioesCliente of grupos.values()) {
    const primeiro = ocasioesCliente[0];
    const segundo = ocasioesCliente[1];
    const ultimo = ocasioesCliente[ocasioesCliente.length - 1];
    const gapAtual = Math.max(0, agoraMs - ultimo.criadoEmMs);

    if (primeiro && primeiro.criadoEmMs >= janelaInicioMs && primeiro.criadoEmMs <= agoraMs) {
      oportunidadesM1 += 1;
    }
    if (segundo && segundo.criadoEmMs >= janelaInicioMs && segundo.criadoEmMs <= agoraMs) {
      oportunidadesM2 += 1;
    }

    // Uma ou duas ocasiões não formam histórico suficiente para afirmar
    // queda de frequência: com 3 ocasiões existem pelo menos 2 intervalos
    // anteriores, o mínimo estrutural para comparar ritmo passado x atual.
    if (ocasioesCliente.length === 1) {
      estados.S1 += 1;
    } else if (ocasioesCliente.length === 2) {
      estados.S2 += 1;
      candidatosM3 += 1;
    } else {
      const intervalosCliente = calcularIntervalosLista(ocasioesCliente);
      const p75Cliente = quantilNearestRank(intervalosCliente, 0.75);
      const p90Cliente = quantilNearestRank(intervalosCliente, 0.9);

      if (
        p90 !== null &&
        p90Cliente !== null &&
        gapAtual > p90 &&
        gapAtual > p90Cliente
      ) {
        estados.S6 += 1;
      } else if (
        p75 !== null &&
        p75Cliente !== null &&
        gapAtual > p75 &&
        gapAtual > p75Cliente
      ) {
        estados.S5 += 1;
        candidatosM5 += 1;
      } else {
        estados.S4 += 1;
        candidatosM4 += 1;
      }
    }

    // Retorno após ausência também exige contexto anterior do próprio cliente.
    // A partir da 3ª ocasião, comparamos o novo intervalo com o histórico que
    // existia antes dele e com o p90 populacional.
    if (ocasioesCliente.length >= 3 && p90 !== null) {
      for (let i = 2; i < ocasioesCliente.length; i += 1) {
        const atual = ocasioesCliente[i];
        const anterior = ocasioesCliente[i - 1];
        const gap = atual.criadoEmMs - anterior.criadoEmMs;
        const intervalosAnteriores = calcularIntervalosLista(ocasioesCliente.slice(0, i));
        const p90AnteriorCliente = quantilNearestRank(intervalosAnteriores, 0.9);

        if (
          p90AnteriorCliente !== null &&
          atual.criadoEmMs >= janelaInicioMs &&
          atual.criadoEmMs <= agoraMs &&
          gap > p90 &&
          gap > p90AnteriorCliente
        ) {
          oportunidadesM6 += 1;
          break;
        }
      }
    }
  }

  momentos.M1 = { ...momentos.M1, tipo: "oportunidade_na_janela", quantidade: oportunidadesM1 };
  momentos.M2 = { ...momentos.M2, tipo: "oportunidade_na_janela", quantidade: oportunidadesM2 };
  momentos.M3 = { ...momentos.M3, tipo: "candidato_atual", quantidade: candidatosM3 };
  momentos.M4 = { ...momentos.M4, tipo: "candidato_atual", quantidade: candidatosM4 };
  momentos.M5 = { ...momentos.M5, tipo: "candidato_atual", quantidade: candidatosM5 };
  momentos.M6 = { ...momentos.M6, tipo: "oportunidade_na_janela", quantidade: oportunidadesM6 };

  const primeiroEvento = validos[0]?.criadoEmMs ?? null;
  const ultimoEvento = validos[validos.length - 1]?.criadoEmMs ?? null;

  return {
    modo: "dry-run",
    janela: {
      inicioIso: new Date(janelaInicioMs).toISOString(),
      fimIso: new Date(agoraMs).toISOString(),
      primeiroEventoObservadoIso: primeiroEvento === null ? null : new Date(primeiroEvento).toISOString(),
      ultimoEventoObservadoIso: ultimoEvento === null ? null : new Date(ultimoEvento).toISOString(),
    },
    cobertura: {
      pedidosValidosObservados: validos.length,
      ocasioesCompraObservadas,
      clientesObservados: grupos.size,
      // Alias legado mantido para consumidores atuais. A unidade agora é
      // ocasião de compra, não pedido individual.
      intervalosEntreComprasObservados: intervalos.length,
      intervalosEntreOcasioesObservados: intervalos.length,
      clientesComHistoricoSuficienteParaQueda,
      clientesSemHistoricoSuficienteParaQueda,
      primeiraCompraObservadaNaoEquivaleAPrimeiraCompraVitalicia: true,
    },
    segmentacaoQueda: {
      minimoOcasioesParaCompararRitmo: 3,
      minimoIntervalosHistoricosPorCliente: 2,
      regra: "gap_atual_supera_quantil_do_cliente_e_da_populacao",
    },
    calibracao: {
      medianaIntervaloDias: emDias(p50),
      p75IntervaloDias: emDias(p75),
      p90IntervaloDias: emDias(p90),
      origemDosLimiares: "quantis_do_historico_observado",
    },
    estadosAtuais: estados,
    momentos,
    observacoes: [
      "Nenhuma pergunta é enviada por este módulo.",
      "Nenhum dado é gravado por este módulo.",
      "M1 e M2 significam primeira e segunda ocasiões observadas no histórico analítico disponível, não necessariamente na vida inteira do cliente.",
      "Pedidos do mesmo expediente operacional contam como uma única ocasião de compra.",
      "M5 e S6 só são avaliados a partir de 3 ocasiões e exigem que o gap atual supere o quantil correspondente do próprio cliente e da população; não existem cortes fixos de dias codificados.",
      "Momentos dependentes de checkout, problemas, indicação, teste moderado ou painel longitudinal permanecem não calculados até suas fontes seguras existirem.",
      "A resposta agregada não expõe identificadores individuais nem dados pessoais ou de pagamento.",
    ],
  };
}
