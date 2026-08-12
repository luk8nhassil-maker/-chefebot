import { describe, test, expect } from "vitest";
import { nextFlavorSelection, type SelecaoSabores } from "./pizzaSabores";

// Fonte de verdade da seleção de sabor no lado do cliente. Os testes checam
// SEMPRE a identidade exata dos sabores ([A, B] e não "dois sabores
// quaisquer"): `[A, C]` também tem tamanho 2 e seria uma substituição
// silenciosa — exatamente o bug que estes testes existem para impedir.
const A = "Baiana";
const B = "Calabresa Suprema";
const C = "Portuguesa";

describe("nextFlavorSelection — pizza normal (até 2 sabores)", () => {
  test("nenhum sabor → toque em A seleciona A", () => {
    expect(nextFlavorSelection({ f1: null, f2: null }, A, false)).toEqual({ f1: A, f2: null });
  });

  test("[A] → toque em B soma B, sem remover A", () => {
    expect(nextFlavorSelection({ f1: A, f2: null }, B, false)).toEqual({ f1: A, f2: B });
  });

  test("[A, B] → toque em C é RECUSADO e mantém exatamente [A, B] (nunca vira [A, C])", () => {
    const atual = { f1: A, f2: B };
    const depois = nextFlavorSelection(atual, C, false);
    expect(depois).toEqual({ f1: A, f2: B });
    expect(depois.f1).toBe(A);
    expect(depois.f2).toBe(B);
    // Nenhum sabor foi substituído: C não entrou em lugar nenhum.
    expect([depois.f1, depois.f2]).not.toContain(C);
  });

  test("[A, B] → tocar em C várias vezes seguidas continua sem alterar a seleção", () => {
    let sel: SelecaoSabores = { f1: A, f2: B };
    for (let i = 0; i < 5; i++) sel = nextFlavorSelection(sel, C, false);
    expect(sel).toEqual({ f1: A, f2: B });
  });

  test("[A, B] → toque em B desmarca B e mantém A", () => {
    expect(nextFlavorSelection({ f1: A, f2: B }, B, false)).toEqual({ f1: A, f2: null });
  });

  test("[A, B] → toque em A desmarca A e mantém B (que passa a ser o 1º)", () => {
    expect(nextFlavorSelection({ f1: A, f2: B }, A, false)).toEqual({ f1: B, f2: null });
  });

  test("troca de sabor pelo caminho oficial: [A, B] → desmarca B → escolhe C → [A, C]", () => {
    let sel: SelecaoSabores = { f1: A, f2: B };
    sel = nextFlavorSelection(sel, B, false);
    expect(sel).toEqual({ f1: A, f2: null });
    sel = nextFlavorSelection(sel, C, false);
    expect(sel).toEqual({ f1: A, f2: C });
  });

  test("[A] → toque em A desmarca tudo", () => {
    expect(nextFlavorSelection({ f1: A, f2: null }, A, false)).toEqual({ f1: null, f2: null });
  });

  test("limite atingido devolve a MESMA referência de estado (nenhum re-render/efeito colateral por trás)", () => {
    const atual = { f1: A, f2: B };
    expect(nextFlavorSelection(atual, C, false)).toBe(atual);
  });
});

describe("nextFlavorSelection — produtos de 1 sabor só (mini-pizza, calzone, pastel, tamanho MINI)", () => {
  test("tocar em outro sabor TROCA a escolha (não existe 2º lugar para ocupar)", () => {
    let sel: SelecaoSabores = nextFlavorSelection({ f1: null, f2: null }, A, true);
    expect(sel).toEqual({ f1: A, f2: null });
    sel = nextFlavorSelection(sel, B, true);
    expect(sel).toEqual({ f1: B, f2: null });
    expect(sel.f2).toBeNull();
  });

  test("tocar no sabor já escolhido desmarca, sem deixar f2 residual", () => {
    expect(nextFlavorSelection({ f1: A, f2: null }, A, true)).toEqual({ f1: null, f2: null });
  });
});
