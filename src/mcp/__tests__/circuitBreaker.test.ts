import { describe, it, expect, beforeEach } from 'vitest';
import {
  circuitoPermiteTentativa,
  registrarSucessoCircuito,
  registrarFalhaCircuito,
  circuitoEstaAberto,
  resetarCircuitoParaTeste,
} from '../lib/circuitBreaker';

beforeEach(() => {
  resetarCircuitoParaTeste();
});

describe('circuitBreaker', () => {
  it('permite tentativas por padrão', () => {
    expect(circuitoPermiteTentativa()).toBe(true);
    expect(circuitoEstaAberto()).toBe(false);
  });

  it('abre depois de 5 falhas consecutivas', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) registrarFalhaCircuito(t0);
    expect(circuitoEstaAberto(t0)).toBe(false);
    registrarFalhaCircuito(t0);
    expect(circuitoEstaAberto(t0)).toBe(true);
    expect(circuitoPermiteTentativa(t0)).toBe(false);
  });

  it('fecha de novo depois da janela de 1 minuto (meio-aberto)', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) registrarFalhaCircuito(t0);
    expect(circuitoPermiteTentativa(t0)).toBe(false);
    expect(circuitoPermiteTentativa(t0 + 60_000)).toBe(true);
    expect(circuitoEstaAberto(t0 + 60_000)).toBe(false);
  });

  it('sucesso reseta o contador de falhas', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) registrarFalhaCircuito(t0);
    registrarSucessoCircuito();
    for (let i = 0; i < 4; i++) registrarFalhaCircuito(t0);
    expect(circuitoEstaAberto(t0)).toBe(false);
  });
});
