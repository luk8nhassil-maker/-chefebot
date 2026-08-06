// Helpers puros de item/preço do fluxo de pedido do site (pedido-app) —
// extraídos de src/app/api/pedido-app/route.ts para serem reaproveitados
// também pelo salvamento de edição de pedido (mesma validação/recálculo de
// preço no servidor, nunca confiando em preço vindo do cliente).

export type ItemApp = {
  kind: "pizza" | "simple" | "promo";
  name: string;     // ex: "Pizza G (meio a meio)" ou "Refrigerante 2L"
  detail?: string;  // ex: "Calabresa / Baiana · borda Catupiry"
  price: number;
  qty: number;
  promoId?: string; // presente quando kind === "promo"
  // Presente quando este item é o presente resgatado da Jornada do Chef —
  // preço sempre forçado a 0 no servidor (nunca confia no preço vindo do
  // cliente), nunca soma pontos nem avança a trilha de novo (ver
  // contarPizzasElegiveisPedido em @/lib/jornadaChef).
  recompensaJornadaId?: string;
  // Presente quando o item é uma pizza montada pelo fluxo estruturado da
  // Fase 2A (seletor com Tradicionais/Especiais por ID) — ver
  // @/lib/pricing/pizzaEngine. Quando presente, o preço é recalculado pelo
  // novo motor (maior preço entre os sabores + borda + adicionais), nunca
  // por este `officialUnitPrice`. Ausente em itens do fluxo legado (name/
  // detail livres) — esses continuam validados exatamente como antes.
  pizzaEstruturada?: {
    sizeId: string;
    flavorIds: string[];
    borderId?: string;
    additionalIds?: string[];
  };
};

export type MenuSimpleItem = { name: string; price: number; sizes?: { code: string; price: number }[] };

export type MenuPedidoApp = {
  sizes: { code: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  lanches: { name: string; price: number; sizes?: { code: string; price: number }[] }[];
  bebidas: { name: string; price: number }[];
  sucos: { name: string; price: number }[];
  borders: { label: string; priceSmall: number; priceLarge: number }[];
};

export function norm(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function formatItem(item: ItemApp): string {
  const qtyPrefix = item.qty > 1 ? `${item.qty}x ` : "";
  const detalhe = item.detail ? ` ${item.detail}` : "";
  return `${qtyPrefix}${item.name}${detalhe}`.trim();
}

/**
 * Conta pizzas PAGAS para a fidelidade antiga (compra N pizzas, ganha 1
 * grátis — `creditarFidelidadePedido`/`pizzasParaPremio`). Exclui
 * explicitamente o presente da Jornada do Chef (`recompensaJornadaId`) e
 * qualquer item inválido/quantidade não positiva — uma pizza que o cliente
 * não pagou nunca pode avançar o progresso de OUTRO programa de fidelidade.
 * Distinta de `contarPizzas` (@/lib/fidelidade), que conta toda pizza sem
 * essa exclusão e é usada só para exibição (não credita nada sozinha).
 */
export function contarPizzasPagasParaFidelidade(itens: ItemApp[] | undefined): number {
  if (!Array.isArray(itens)) return 0;
  return itens
    .filter((item) => item?.kind === "pizza" && !item.recompensaJornadaId)
    .reduce((soma, item) => soma + Math.max(0, Math.trunc(Number(item.qty)) || 0), 0);
}

export function officialUnitPrice(item: ItemApp, menu: MenuPedidoApp): number | null {
  if (!Number.isInteger(item.qty) || item.qty < 1) return null;

  if (item.kind === "simple") {
    const produtos: MenuSimpleItem[] = [...menu.lanches, ...menu.bebidas, ...menu.sucos];
    const found = produtos.find((produto) => norm(produto.name) === norm(item.name));
    if (!found) return null;

    const suco = menu.sucos.find((entry) => norm(entry.name) === norm(item.name));
    if (suco) {
      const detail = norm(item.detail || "");
      if (!detail || detail === "sem leite") return Number.isFinite(suco.price) ? suco.price : null;
      if (detail === "com leite") return Number.isFinite(suco.price) ? suco.price + 1 : null;
      return null;
    }
    if (norm(found.name).includes("macarronada")) {
      const sizeCode = item.detail?.match(/^Tamanho\s+([A-Za-z])$/i)?.[1]?.toUpperCase();
      const size = sizeCode ? found.sizes?.find((entry) => entry.code.toUpperCase() === sizeCode) : null;
      return size && Number.isFinite(size.price) ? size.price : null;
    }

    // Calzone é vendido com exatamente 1 sabor (nunca meio a meio). O
    // frontend manda `detail: "Sabor: <flavor>"` — payload adulterado com
    // 2+ sabores, sem sabor ou com sabor fora da lista da pizza é rejeitado
    // aqui (não confiamos em nada vindo do cliente além do nome/qty).
    if (norm(found.name) === "calzone") {
      const match = (item.detail || "").trim().match(/^Sabor:\s*(.+)$/i);
      if (!match) return null;
      const sabor = match[1].trim();
      if (!sabor || sabor.includes("/") || sabor.includes("·")) return null;
      const saboresPermitidos = [...menu.saltyFlavors, ...menu.sweetFlavors].map(norm);
      if (!saboresPermitidos.includes(norm(sabor))) return null;
      return Number.isFinite(found.price) ? found.price : null;
    }

    return Number.isFinite(found.price) ? found.price : null;
  }

  if (item.kind !== "pizza") return null;

  const sizeCode = item.name.match(/^Pizza\s+([A-Za-z])/i)?.[1]?.toUpperCase();
  const size = sizeCode ? menu.sizes.find((entry) => entry.code.toUpperCase() === sizeCode) : null;
  if (!size || !Number.isFinite(size.price)) return null;

  const detail = item.detail || "";
  const detailParts = detail.split("·").map((part) => part.trim()).filter(Boolean);
  const flavorsText = detailParts[0] || "";
  const flavors = flavorsText.split("/").map((part) => part.trim()).filter(Boolean);
  const allowedFlavors = [...menu.saltyFlavors, ...menu.sweetFlavors].map(norm);
  if (flavors.length === 0 || flavors.some((flavor) => !allowedFlavors.includes(norm(flavor)))) {
    return null;
  }

  const borderText = detailParts.find((part) => norm(part).startsWith("borda "));
  if (!borderText) return size.price;

  const borderName = borderText.replace(/^borda\s+/i, "").trim();
  const border = menu.borders.find((entry) => norm(entry.label) === norm(borderName));
  if (!border) return null;

  const isSmallOrMedium = size.code === "P" || size.code === "M";
  return size.price + (isSmallOrMedium ? border.priceSmall : border.priceLarge);
}

export type Promocao = {
  id: string;
  active: boolean;
  maxUsesPerOrder?: number;
};

/**
 * Fábrica do validador de preço de item promocional — recebe as dependências
 * (promoções ativas, catálogo, esgotados) já carregadas pelo chamador, para
 * não acoplar este módulo puro ao Redis.
 */
export function makePromoUnitPrice<P extends { id: string; active: boolean; maxUsesPerOrder?: number }>(deps: {
  promos: P[];
  esgotadosPromo: string[];
  dentroDaJanela: (p: P) => boolean;
  promocaoIndisponivel: (p: P, esgotados: string[]) => boolean;
  precoFinalPromocao: (p: P) => number | null;
}) {
  const { promos, esgotadosPromo, dentroDaJanela, promocaoIndisponivel, precoFinalPromocao } = deps;
  return function promoUnitPrice(item: ItemApp): number | null {
    if (!Number.isInteger(item.qty) || item.qty < 1) return null;
    const promo = promos.find((p) => p.id === item.promoId);
    if (!promo || !promo.active || !dentroDaJanela(promo)) return null;
    if (promo.maxUsesPerOrder && item.qty > promo.maxUsesPerOrder) return null;
    if (promocaoIndisponivel(promo, esgotadosPromo)) return null;
    const sabor = item.detail?.match(/Sabor:\s*([^·]+)/i)?.[1]?.trim();
    if (sabor && esgotadosPromo.some((e) => norm(e) === norm(sabor))) return null;
    const preco = precoFinalPromocao(promo);
    return preco !== null && Number.isFinite(preco) && preco >= 0 ? preco : null;
  };
}

/**
 * Valida e formata uma lista de itens vinda do cliente, recalculando preço
 * 100% no servidor. Nunca aceita `recompensaJornadaId` como fonte de preço —
 * um campo vindo do navegador nunca pode zerar o preço de um item arbitrário.
 * O presente da Jornada do Chef nunca passa por aqui: é materializado à parte
 * pelo chamador a partir do snapshot da própria recompensa (ver
 * `materializarItensRecompensa` em @/lib/jornadaChef), sempre com preço 0
 * atribuído pelo servidor, nunca por este helper genérico.
 */
export function validarEFormatarItens(
  itens: ItemApp[],
  menu: MenuPedidoApp,
  promoUnitPrice: (item: ItemApp) => number | null
): { linha: string; unitPrice: number | null; qty: number }[] {
  return itens.map((item) => ({
    linha: formatItem(item),
    unitPrice: item.kind === "promo" ? promoUnitPrice(item) : officialUnitPrice(item, menu),
    qty: item.qty,
  }));
}
