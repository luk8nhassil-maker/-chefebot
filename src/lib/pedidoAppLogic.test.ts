import { describe, it, expect } from "vitest";
import { computeTaxaApp, buildEnderecoApp } from "./pedidoAppLogic";

const neighborhoods = [
  { name: "Centro", fee: 3 },
  { name: "Santa Rosa", fee: 5 },
  { name: "Vila Nova", fee: 4 },
];

describe("computeTaxaApp", () => {
  it("returns fee for known delivery bairro", () => {
    expect(computeTaxaApp("delivery", "Centro", neighborhoods)).toBe(3);
  });

  it("is case-insensitive for bairro name", () => {
    expect(computeTaxaApp("delivery", "santa rosa", neighborhoods)).toBe(5);
    expect(computeTaxaApp("delivery", "VILA NOVA", neighborhoods)).toBe(4);
  });

  it("returns 0 for unknown bairro", () => {
    expect(computeTaxaApp("delivery", "Bairro Inexistente", neighborhoods)).toBe(0);
  });

  it("returns 0 for retirada regardless of bairro", () => {
    expect(computeTaxaApp("retirada", "Centro", neighborhoods)).toBe(0);
  });

  it("returns 0 for dine_in regardless of bairro", () => {
    expect(computeTaxaApp("dine_in", "Centro", neighborhoods)).toBe(0);
  });

  it("returns 0 when bairro is undefined for delivery", () => {
    expect(computeTaxaApp("delivery", undefined, neighborhoods)).toBe(0);
  });

  it("returns 0 for empty neighborhood list", () => {
    expect(computeTaxaApp("delivery", "Centro", [])).toBe(0);
  });
});

describe("buildEnderecoApp", () => {
  it("returns 'Consumo no local' for dine_in", () => {
    expect(buildEnderecoApp({ tipoEntrega: "dine_in" })).toBe("Consumo no local");
  });

  it("returns 'Retirada na loja' for retirada", () => {
    expect(buildEnderecoApp({ tipoEntrega: "retirada" })).toBe("Retirada na loja");
  });

  it("builds full delivery address with rua, numero, bairro", () => {
    expect(buildEnderecoApp({ tipoEntrega: "delivery", rua: "Rua das Flores", numero: "123", bairro: "Centro" })).toBe("Rua das Flores, 123 - Centro");
  });

  it("builds delivery address without numero", () => {
    expect(buildEnderecoApp({ tipoEntrega: "delivery", rua: "Rua das Flores", bairro: "Centro" })).toBe("Rua das Flores - Centro");
  });

  it("builds delivery address without bairro", () => {
    expect(buildEnderecoApp({ tipoEntrega: "delivery", rua: "Rua das Flores", numero: "10" })).toBe("Rua das Flores, 10");
  });

  it("returns empty string for delivery with no fields", () => {
    expect(buildEnderecoApp({ tipoEntrega: "delivery" })).toBe("");
  });

  it("ignores referencia in endereco (stored separately)", () => {
    const result = buildEnderecoApp({ tipoEntrega: "delivery", rua: "Av. Principal", numero: "5", bairro: "Centro" });
    expect(result).toBe("Av. Principal, 5 - Centro");
  });
});
