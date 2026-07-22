// Medições manuais verificadas na Railway UI, durante e após o incidente do
// postgres-volume (ver docs/operations/railway-infra-monitor.md). Fonte
// "railway-ui-manual" — NUNCA confundir com coleta automática do coletor
// GitHub Actions. São unidas ao histórico só na camada de leitura
// (src/infra/railway/persistence.ts:lerHistoricoConsolidado), nunca gravadas
// no Redis e nunca disparam alerta retroativo.

import type { HistoryPoint } from "./types";

const MB = 1024 * 1024;

// Capacidade vigente no momento de cada medição manual: as duas primeiras
// ainda com o volume de 500 MB (antes da ampliação do incidente), a última já
// com os 5 GB atuais. Necessário para o percentual de cada ponto ser fiel ao
// que a Railway UI mostrava naquele instante — nunca recalculado com a
// capacidade atual.
const CAPACIDADE_500MB = 500 * MB;
const CAPACIDADE_5GB = 5 * 1024 * MB;

/** `new Date(...)` com o offset de GMT-3 (São Paulo) explícito. */
function saoPauloMs(iso: string): number {
  return new Date(iso).getTime();
}

export const VERIFIED_BASELINES: readonly HistoryPoint[] = [
  {
    ts: saoPauloMs("2026-06-22T01:00:00-03:00"),
    usedBytes: Math.round(337.3 * MB),
    capacityBytes: CAPACIDADE_500MB,
    percentUsed: (337.3 * MB) / CAPACIDADE_500MB,
    origin: "railway-ui-manual",
  },
  {
    ts: saoPauloMs("2026-07-20T21:00:00-03:00"),
    usedBytes: Math.round(495.4 * MB),
    capacityBytes: CAPACIDADE_500MB,
    percentUsed: (495.4 * MB) / CAPACIDADE_500MB,
    origin: "railway-ui-manual",
  },
  {
    ts: saoPauloMs("2026-07-21T21:00:00-03:00"),
    usedBytes: Math.round(765.21 * MB),
    capacityBytes: CAPACIDADE_5GB,
    percentUsed: (765.21 * MB) / CAPACIDADE_5GB,
    origin: "railway-ui-manual",
  },
];
