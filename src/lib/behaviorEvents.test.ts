import { describe, expect, test } from "vitest";
import {
  classifyBehaviorPaymentMethod,
  classifyPublicBehaviorPage,
} from "./behaviorEvents";

describe("classifyPublicBehaviorPage", () => {
  test("classifica rotas públicas relevantes", () => {
    expect(classifyPublicBehaviorPage("/")).toBe("home");
    expect(classifyPublicBehaviorPage("/cardapio")).toBe("cardapio");
    expect(classifyPublicBehaviorPage("/cliente")).toBe("cliente");
    expect(classifyPublicBehaviorPage("/cliente/pedidos")).toBe("cliente_pedidos");
    expect(classifyPublicBehaviorPage("/rastrear/123")).toBe("rastrear");
    expect(classifyPublicBehaviorPage("/pedido/editar/123")).toBe("pedido_editar");
  });

  test("nunca monitora admin, salão, dev, login ou API pelo tracker global", () => {
    expect(classifyPublicBehaviorPage("/admin")).toBeNull();
    expect(classifyPublicBehaviorPage("/salao")).toBeNull();
    expect(classifyPublicBehaviorPage("/dev/customer360")).toBeNull();
    expect(classifyPublicBehaviorPage("/login")).toBeNull();
    expect(classifyPublicBehaviorPage("/api/orders")).toBeNull();
  });
});

describe("classifyBehaviorPaymentMethod", () => {
  test("classifica sem guardar texto bruto de pagamento", () => {
    expect(classifyBehaviorPaymentMethod("Pix")).toBe("pix");
    expect(classifyBehaviorPaymentMethod("Dinheiro")).toBe("dinheiro");
    expect(classifyBehaviorPaymentMethod("Cartão")).toBe("cartao");
    expect(classifyBehaviorPaymentMethod("Pix + Dinheiro")).toBe("misto");
    expect(classifyBehaviorPaymentMethod("Outro")).toBe("outro");
  });
});
