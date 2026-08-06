// Ponte checkout ↔ motor novo — garante que pedidos/carrinhos antigos (sem
// `pizzaEstruturada`) continuam validados exatamente como antes, e que
// pizzas do novo seletor (com `pizzaEstruturada`) são recalculadas 100% pelo
// catálogo oficial da Fase 2A, nunca confiando no preço do navegador.
import { describe, expect, it } from "vitest";
import { MENU } from "@/lib/menu";
import { officialUnitPrice, type ItemApp, type MenuPedidoApp } from "@/lib/pedidoAppItens";
import { unitPriceReaisPizza } from "./pizzaEngine";

describe("unitPriceReaisPizza — compatibilidade com pedidos/carrinhos antigos", () => {
  it("item de pizza sem pizzaEstruturada usa officialUnitPrice, sem nenhuma mudança de resultado", () => {
    const item: ItemApp = { kind: "pizza", name: "Pizza G", detail: "Calabresa", price: 0, qty: 1 };
    const esperado = officialUnitPrice(item, MENU as unknown as MenuPedidoApp);
    expect(unitPriceReaisPizza(item, MENU)).toBe(esperado);
  });

  it("item simples (bebida/lanche) continua passando pelo caminho legado, intocado", () => {
    const item: ItemApp = { kind: "simple", name: "Guarana Lata", price: 0, qty: 1 };
    const esperado = officialUnitPrice(item, MENU as unknown as MenuPedidoApp);
    expect(unitPriceReaisPizza(item, MENU)).toBe(esperado);
  });

  it("item com pizzaEstruturada é recalculado pelo novo catálogo — preço em reais, não em centavos", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza G",
      detail: "Calabresa",
      price: 999999, // valor adulterado — nunca deveria ser usado
      qty: 1,
      pizzaEstruturada: { sizeId: "size-g", flavorIds: ["flavor-calabresa"] },
    };
    // Calabresa G = R$ 45,00 (4500 centavos) — nunca R$ 9.999,99 do payload.
    expect(unitPriceReaisPizza(item, MENU)).toBe(45);
  });

  it("pizza especial estruturada some com o preço maior no meio a meio", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza G (meio a meio)",
      detail: "Calabresa Especial / Calabresa Suprema",
      price: 1,
      qty: 1,
      pizzaEstruturada: { sizeId: "size-g", flavorIds: ["flavor-calabresa-especial", "flavor-calabresa-suprema"] },
    };
    expect(unitPriceReaisPizza(item, MENU)).toBe(62); // Calabresa Suprema G = R$ 62,00
  });

  it("pizzaEstruturada com ID inválido é rejeitada (retorna null), nunca cai para o preço do navegador", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza G",
      detail: "Sabor Fantasma",
      price: 50,
      qty: 1,
      pizzaEstruturada: { sizeId: "size-g", flavorIds: ["flavor-inexistente"] },
    };
    expect(unitPriceReaisPizza(item, MENU)).toBeNull();
  });

  it("pizza doce continua funcionando pelo fluxo estruturado (não regrediu com a Fase 2A)", () => {
    const item: ItemApp = {
      kind: "pizza",
      name: "Pizza M",
      detail: "Chocolate",
      price: 1,
      qty: 1,
      pizzaEstruturada: { sizeId: "size-m", flavorIds: ["flavor-chocolate"] },
    };
    expect(unitPriceReaisPizza(item, MENU)).toBe(40); // Chocolate M = R$ 40,00
  });
});
