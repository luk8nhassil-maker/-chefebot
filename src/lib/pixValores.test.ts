import { describe, expect, it } from "vitest";
import { calcularDivisaoPixDinheiro } from "./pixValores";

describe("calcularDivisaoPixDinheiro", () => {
  it("[caso 4] Pix integral de R$ 100 mostra R$ 100 (não é híbrido)", () => {
    const r = calcularDivisaoPixDinheiro(100, 100);
    expect(r.isHibrido).toBe(false);
    expect(r.pix).toBe(100);
    expect(r.dinheiro).toBe(0);
  });

  it("[caso 5/6] pedido misto total R$ 100, Pix R$ 40 => Pix R$ 40 e Dinheiro R$ 60", () => {
    const r = calcularDivisaoPixDinheiro(100, 40);
    expect(r.isHibrido).toBe(true);
    expect(r.pix).toBe(40);
    expect(r.dinheiro).toBe(60);
  });

  it("[caso 7] arredondamento em centavos nunca produz valor negativo", () => {
    // 0.1 + 0.2 é o clássico problema de ponto flutuante em JS.
    const r = calcularDivisaoPixDinheiro(0.3, 0.1);
    expect(r.dinheiro).toBeCloseTo(0.2, 10);
    expect(r.dinheiro).toBeGreaterThanOrEqual(0);
    expect(r.pix).toBeGreaterThanOrEqual(0);
  });

  it("nunca deixa dinheiro negativo mesmo se valorPix vier maior que o total (dado inconsistente)", () => {
    const r = calcularDivisaoPixDinheiro(50, 999);
    expect(r.dinheiro).toBeGreaterThanOrEqual(0);
    expect(r.pix).toBeLessThanOrEqual(50);
  });

  it("nunca deixa pix negativo mesmo se valorPix vier negativo (dado inconsistente)", () => {
    const r = calcularDivisaoPixDinheiro(50, -10);
    expect(r.pix).toBeGreaterThanOrEqual(0);
  });

  it("valorPix ausente (undefined) trata como Pix integral (mesmo total)", () => {
    const r = calcularDivisaoPixDinheiro(75.5, undefined);
    expect(r.isHibrido).toBe(false);
    expect(r.pix).toBe(75.5);
    expect(r.dinheiro).toBe(0);
  });

  it("valorPix igual a zero não é híbrido (trata como sem Pix, sem negativo)", () => {
    const r = calcularDivisaoPixDinheiro(100, 0);
    expect(r.isHibrido).toBe(false);
    expect(r.pix).toBe(0);
    expect(r.dinheiro).toBe(100);
  });

  it("soma pix+dinheiro sempre bate com o total (centavos exatos)", () => {
    const casos: [number, number][] = [[199.99, 66.66], [10.1, 3.33], [1000, 333.33]];
    for (const [total, valorPix] of casos) {
      const r = calcularDivisaoPixDinheiro(total, valorPix);
      expect(Math.round((r.pix + r.dinheiro) * 100)).toBe(Math.round(total * 100));
    }
  });
});
