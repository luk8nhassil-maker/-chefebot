import { describe, it, expect } from 'vitest';
import { estaNoPeriodoDePico, idFimDeSemana } from '../lib/janelaPico';

// Horários em UTC — America/Sao_Paulo é UTC-3 (sem horário de verão desde 2019).
describe('estaNoPeriodoDePico', () => {
  it('sexta 21:00 UTC (18:00 BRT) está no período de pico', () => {
    expect(estaNoPeriodoDePico(new Date('2026-07-24T21:00:00Z'))).toBe(true); // sexta
  });

  it('sábado 01:00 UTC (22:00 BRT de sexta) está no período de pico', () => {
    expect(estaNoPeriodoDePico(new Date('2026-07-25T01:00:00Z'))).toBe(true); // ainda "sexta à noite"
  });

  it('quarta-feira à noite não está no período de pico', () => {
    expect(estaNoPeriodoDePico(new Date('2026-07-22T21:00:00Z'))).toBe(false); // quarta
  });

  it('sábado 15:00 UTC (12:00 BRT) — dentro do dia certo mas fora da janela de horário', () => {
    expect(estaNoPeriodoDePico(new Date('2026-07-25T15:00:00Z'))).toBe(false);
  });

  it('domingo 05:00 UTC (02:00 BRT) ainda está no período de pico (madrugada)', () => {
    expect(estaNoPeriodoDePico(new Date('2026-07-26T05:00:00Z'))).toBe(true);
  });

  it('domingo 06:00 UTC (03:00 BRT) já saiu do período de pico', () => {
    expect(estaNoPeriodoDePico(new Date('2026-07-26T06:00:00Z'))).toBe(false);
  });
});

describe('idFimDeSemana', () => {
  it('retorna null para dia de semana comum', () => {
    expect(idFimDeSemana(new Date('2026-07-22T21:00:00Z'))).toBeNull(); // quarta
  });

  it('sexta, sábado e domingo do mesmo fim de semana têm o mesmo id', () => {
    const sexta = idFimDeSemana(new Date('2026-07-24T21:00:00Z'));
    const sabado = idFimDeSemana(new Date('2026-07-25T21:00:00Z'));
    const domingoDeMadrugada = idFimDeSemana(new Date('2026-07-26T05:00:00Z')); // sábado à noite BRT
    expect(sexta).not.toBeNull();
    expect(sexta).toBe(sabado);
    expect(sabado).toBe(domingoDeMadrugada);
  });

  it('fins de semana diferentes têm ids diferentes', () => {
    const fds1 = idFimDeSemana(new Date('2026-07-25T15:00:00Z'));
    const fds2 = idFimDeSemana(new Date('2026-08-01T15:00:00Z'));
    expect(fds1).not.toBe(fds2);
  });
});
