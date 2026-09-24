import type { EventoAnalitico } from "./historicoAnalitico";

export type FonteEvidenciaCompraHistorica =
  | "fidelidade_legado"
  | "fidelidade_pontos";

export type EvidenciaCompraHistorica = {
  pedidoId: string;
  criadoEmMs: number;
  fonte: FonteEvidenciaCompraHistorica;
};

export type ResumoHistoricoAnteriorPreferencia = {
  fonte: "ledgers_fidelidade";
  clientesAuditados: number;
  evidenciaMaisAntigaIso: string | null;
  m1Observado: number;
  m1ComCompraAnteriorComprovada: number;
  m1SemEvidenciaAnteriorComprovada: number;
  m2Observado: number;
  m2ComCompraAnteriorAntesDaPrimeiraObservada: number;
  m2SemEvidenciaAnteriorComprovada: number;
  aviso: string;
};

type OcasiaoHistorica = {
  expedienteId: string;
  criadoEmMs: number;
  pedidoIds: Set<string>;
};

export type CarregadorEvidenciasHistoricas = (
  clienteId: string
) => Promise<readonly EvidenciaCompraHistorica[]>;

function agruparOcasioes(
  eventos: readonly EventoAnalitico[]
): Map<string, OcasiaoHistorica[]> {
  const porCliente = new Map<string, Map<string, OcasiaoHistorica>>();

  for (const evento of eventos) {
    if (evento.statusAnalitico !== "entregue") continue;

    const chaveOcasiao = evento.expedienteId?.trim() || `pedido:${evento.pedidoId}`;
    const porExpediente =
      porCliente.get(evento.clienteId) ?? new Map<string, OcasiaoHistorica>();
    const atual = porExpediente.get(chaveOcasiao);

    if (!atual) {
      porExpediente.set(chaveOcasiao, {
        expedienteId: chaveOcasiao,
        criadoEmMs: evento.criadoEmMs,
        pedidoIds: new Set([evento.pedidoId]),
      });
    } else {
      atual.pedidoIds.add(evento.pedidoId);
      if (evento.criadoEmMs > atual.criadoEmMs) {
        atual.criadoEmMs = evento.criadoEmMs;
      }
    }

    porCliente.set(evento.clienteId, porExpediente);
  }

  return new Map(
    [...porCliente.entries()].map(([clienteId, porExpediente]) => [
      clienteId,
      [...porExpediente.values()].sort((a, b) => a.criadoEmMs - b.criadoEmMs),
    ])
  );
}

function deduplicarEvidencias(
  evidencias: readonly EvidenciaCompraHistorica[]
): EvidenciaCompraHistorica[] {
  const porPedido = new Map<string, EvidenciaCompraHistorica>();

  for (const evidencia of evidencias) {
    if (!evidencia.pedidoId || !Number.isFinite(evidencia.criadoEmMs)) continue;
    const atual = porPedido.get(evidencia.pedidoId);
    if (!atual || evidencia.criadoEmMs < atual.criadoEmMs) {
      porPedido.set(evidencia.pedidoId, evidencia);
    }
  }

  return [...porPedido.values()];
}

export async function auditarHistoricoAnteriorPreferencia(params: {
  eventos: readonly EventoAnalitico[];
  janelaInicioMs: number;
  carregarEvidencias: CarregadorEvidenciasHistoricas;
  concorrencia?: number;
}): Promise<ResumoHistoricoAnteriorPreferencia> {
  const {
    eventos,
    janelaInicioMs,
    carregarEvidencias,
    concorrencia = 10,
  } = params;

  const grupos = agruparOcasioes(eventos);
  const clientes = [...grupos.entries()];
  const limite = Math.max(1, Math.min(25, Math.floor(concorrencia) || 1));

  let m1Observado = 0;
  let m1ComCompraAnteriorComprovada = 0;
  let m2Observado = 0;
  let m2ComCompraAnteriorAntesDaPrimeiraObservada = 0;
  let evidenciaMaisAntigaMs: number | null = null;

  for (let inicio = 0; inicio < clientes.length; inicio += limite) {
    const lote = clientes.slice(inicio, inicio + limite);

    const resultados = await Promise.all(
      lote.map(async ([clienteId, ocasioes]) => {
        const primeira = ocasioes[0];
        const segunda = ocasioes[1];

        if (!primeira) {
          return {
            temM1: false,
            temM2: false,
            temAnterior: false,
            evidenciaMaisAntigaMs: null as number | null,
          };
        }

        const idsAnalytics = new Set(
          ocasioes.flatMap((ocasiao) => [...ocasiao.pedidoIds])
        );
        const evidencias = deduplicarEvidencias(
          await carregarEvidencias(clienteId)
        ).filter((evidencia) => !idsAnalytics.has(evidencia.pedidoId));

        const anteriores = evidencias.filter(
          (evidencia) => evidencia.criadoEmMs < primeira.criadoEmMs
        );
        const maisAntiga =
          anteriores.length > 0
            ? Math.min(...anteriores.map((evidencia) => evidencia.criadoEmMs))
            : null;

        return {
          temM1: primeira.criadoEmMs >= janelaInicioMs,
          temM2: Boolean(segunda && segunda.criadoEmMs >= janelaInicioMs),
          temAnterior: anteriores.length > 0,
          evidenciaMaisAntigaMs: maisAntiga,
        };
      })
    );

    for (const resultado of resultados) {
      if (resultado.temM1) {
        m1Observado += 1;
        if (resultado.temAnterior) m1ComCompraAnteriorComprovada += 1;
      }

      if (resultado.temM2) {
        m2Observado += 1;
        if (resultado.temAnterior) {
          m2ComCompraAnteriorAntesDaPrimeiraObservada += 1;
        }
      }

      if (
        resultado.evidenciaMaisAntigaMs !== null &&
        (evidenciaMaisAntigaMs === null ||
          resultado.evidenciaMaisAntigaMs < evidenciaMaisAntigaMs)
      ) {
        evidenciaMaisAntigaMs = resultado.evidenciaMaisAntigaMs;
      }
    }
  }

  return {
    fonte: "ledgers_fidelidade",
    clientesAuditados: grupos.size,
    evidenciaMaisAntigaIso:
      evidenciaMaisAntigaMs === null
        ? null
        : new Date(evidenciaMaisAntigaMs).toISOString(),
    m1Observado,
    m1ComCompraAnteriorComprovada,
    m1SemEvidenciaAnteriorComprovada:
      m1Observado - m1ComCompraAnteriorComprovada,
    m2Observado,
    m2ComCompraAnteriorAntesDaPrimeiraObservada,
    m2SemEvidenciaAnteriorComprovada:
      m2Observado - m2ComCompraAnteriorAntesDaPrimeiraObservada,
    aviso:
      "Ausência de movimento anterior nos ledgers não prova primeira compra vitalícia; apenas significa que esta fonte não encontrou evidência anterior.",
  };
}
