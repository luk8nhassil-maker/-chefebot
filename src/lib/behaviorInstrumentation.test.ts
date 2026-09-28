import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function ler(relativo: string): string {
  return readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf-8").replace(/\r
/g, "
");
}

const cardapio = ler("../app/cardapio/page.tsx");
const cliente = ler("../app/cliente/page.tsx");
const pedidos = ler("../app/cliente/pedidos/page.tsx");
const rastrear = ler("../app/rastrear/[pedidoId]/page.tsx");
const behaviorClient = ler("./behaviorClient.ts");
const pedidoApi = ler("../app/api/pedido-app/route.ts");

describe("instrumentação comportamental — cobertura essencial", () => {
  test("cardápio cobre acesso, navegação, busca, produto, carrinho e checkout", () => {
    for (const evento of [
      "app_open",
      "whatsapp_link_verified",
      "screen_view",
      "search_used",
      "category_view",
      "product_view",
      "cart_state",
      "cart_add",
      "cart_remove",
      "cart_quantity_change",
      "checkout_start",
      "delivery_step_view",
      "payment_step_view",
      "order_submit_attempt",
      "action_result",
    ]) {
      expect(cardapio).toContain(`trackBehavior("${evento}"`);
    }
    expect(cardapio).toContain("behaviorSessionId: getBehaviorSessionId() || undefined");
  });

  test("área do cliente diferencia fidelidade e ranking", () => {
    expect(cliente).toContain("trackBehavior('app_open'");
    expect(cliente).toContain("trackBehavior('fidelity_open'");
    expect(cliente).toContain("trackBehavior('ranking_open'");
  });

  test("histórico e rastreamento são classificados separadamente de intenção de compra", () => {
    expect(pedidos).toContain("source: 'orders'");
    expect(pedidos).toContain("target: 'tracking'");
    expect(pedidos).toContain("trackBehavior('search_used'");
    expect(rastrear).toContain("source: 'tracking'");
    expect(rastrear).toContain("installBehaviorPageExitTracking('tracking')");
  });

  test("sessão mede contexto técnico coarse e tempo ativo sem PII", () => {
    expect(behaviorClient).toContain('deviceClass');
    expect(behaviorClient).toContain('viewportClass');
    expect(behaviorClient).toContain('displayMode');
    expect(behaviorClient).toContain('referrerKind');
    expect(behaviorClient).toContain('engagementMs');
    expect(behaviorClient).not.toContain("localStorage");
    expect(behaviorClient).not.toContain("getBehaviorVisitorId");
    expect(behaviorClient).not.toContain("navigator.userAgent");
    expect(behaviorClient).not.toContain("geolocation");
  });

  test("pedido oficial liga sessão anônima à conversão no servidor", () => {
    expect(pedidoApi).toContain('type: "order_created"');
    expect(pedidoApi).toContain("sessionId: body.behaviorSessionId");
    expect(pedidoApi).toContain("registrarEventoServidorComportamento");
  });
});
