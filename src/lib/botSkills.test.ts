import { detectarFormaRecebimento } from "./botSkills";

const casos: Array<{ frase: string; esperado: "delivery" | "pickup" | "dine_in" | null }> = [
  { frase: "vou querer entrega", esperado: "delivery" },
  { frase: "é pra entregar", esperado: "delivery" },
  { frase: "vou buscar aí", esperado: "pickup" },
  { frase: "é retirada", esperado: "pickup" },
  { frase: "vou comer aí", esperado: "dine_in" },
  { frase: "é pra comer no local", esperado: "dine_in" },
  { frase: "vou consumir no local", esperado: "dine_in" },
  { frase: "quero uma pizza pra mesa", esperado: "dine_in" },
  { frase: "vou comer no restaurante", esperado: "dine_in" },
];

describe("detectarFormaRecebimento", () => {
  test.each(casos)('detecta "$frase" como $esperado', ({ frase, esperado }) => {
    expect(detectarFormaRecebimento(frase)).toBe(esperado);
  });

  test("retorna null para texto sem forma de recebimento", () => {
    expect(detectarFormaRecebimento("quero uma pizza")).toBeNull();
  });

  test("delivery sobrepõe null quando bairro não é mencionado", () => {
    expect(detectarFormaRecebimento("delivery")).toBe("delivery");
  });

  test("pickup detecta variações", () => {
    expect(detectarFormaRecebimento("vou pegar lá")).toBe("pickup");
  });
});
