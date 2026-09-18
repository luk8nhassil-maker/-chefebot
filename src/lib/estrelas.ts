/** Regra pública interna da progressão de Estrelas V1. */
export const REGRA_ESTRELAS_V1 = "estrelas-faixas-v1" as const;
export const META_ESTRELAS_V1 = 50;

export type ResultadoEstrelas = {
  estrelas: number;
  valorElegivelCents: number;
  regraVersao: typeof REGRA_ESTRELAS_V1;
};

/**
 * Calcula Estrelas apenas a partir de centavos já validados pelo servidor.
 * A função é pura, determinística e não conhece Redis, navegador ou catálogo.
 */
export function calcularEstrelasPorValorElegivel(valorElegivelCents: number): number {
  const cents = Number.isFinite(valorElegivelCents) ? Math.max(0, Math.floor(valorElegivelCents)) : 0;
  if (cents === 0) return 0;
  if (cents < 4_000) return 3;
  if (cents < 7_000) return 5;
  if (cents < 10_000) return 7;
  if (cents < 15_000) return 9;
  return 12;
}

export function calcularEstrelasV1(valorElegivelCents: number): ResultadoEstrelas {
  const cents = Number.isFinite(valorElegivelCents) ? Math.max(0, Math.floor(valorElegivelCents)) : 0;
  return { estrelas: calcularEstrelasPorValorElegivel(cents), valorElegivelCents: cents, regraVersao: REGRA_ESTRELAS_V1 };
}

export function progressoEstrelas(saldo: number, meta = META_ESTRELAS_V1) {
  const seguro = Math.max(0, Math.floor(Number(saldo) || 0));
  const alvo = Math.max(0, Math.floor(Number(meta) || 0));
  return {
    saldo: seguro,
    meta,
    faltam: alvo > 0 ? Math.max(alvo - seguro, 0) : 0,
    percentual: alvo > 0 ? Math.min(100, Math.round((seguro / alvo) * 100)) : 0,
    marcoAtingido: alvo > 0 && seguro >= alvo,
  };
}
