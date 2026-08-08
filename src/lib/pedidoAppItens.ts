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
  // Presente quando o item de pizza foi selecionado por ID estável do
  // catálogo oficial (Fase 2: @/lib/catalog/pizzas + @/lib/pricing/pizzaEngine)
  // em vez de name/detail em texto livre. Quando presente, o servidor
  // SEMPRE ignora `name`/`detail` enviados pelo cliente e reconstrói os
  // dois a partir do catálogo (ver resolverItemComSelecaoEstruturada em
  // @/lib/pedidoAppSelecaoEstruturada).
  pizzaSelection?: { sizeId: string; flavorIds: string[]; borderId?: string };
  // Mesma ideia de pizzaSelection (Fase 6), para os demais produtos
  // configuráveis do cardápio (Calzone, Mini-Pizza, Macarronada, sucos) por
  // ID estável do catálogo oficial (@/lib/catalog/simpleProducts). Quando
  // presente, o servidor SEMPRE ignora
  // `name`/`detail` enviados pelo cliente e reconstrói os dois a partir do
  // catálogo (ver resolverItemComSelecaoSimplesEstruturada em
  // @/lib/pedidoAppSelecaoEstruturada). `sizeId` só se aplica a produtos com
  // tamanho (macarronada); `flavorId` só a produtos de 1 sabor só (calzone,
  // mini-pizza); `milk` só a sucos.
  simpleSelection?: { productId: string; sizeId?: string; flavorId?: string; milk?: "com" | "sem" };
};

export type MenuSimpleItem = {
  name: string;
  price: number;
  sizes?: { code: string; price: number }[];
  // Passagem opcional da configuração oficial de sabores
  // (menu.lanches[].hasFlavors/flavorsKey/flavorsMode — ver src/lib/menu.ts
  // e @/lib/catalog/simpleProducts) — usada por QUALQUER produto de 1 sabor
  // só (Calzone, Mini-Pizza, e qualquer outro que venha a existir) no
  // caminho legado (ver officialUnitPrice) para respeitar o modo
  // configurado mesmo quando o cliente omite `simpleSelection`. A DECISÃO
  // de aplicar a validação de sabor é `hasFlavors && flavorsKey` — nunca o
  // nome do produto. QUAL lista vale (pizza inteira vs. lista própria) é
  // decidido por `resolverFlavorsModeEfetivo` (abaixo) — `flavorsMode`
  // AUSENTE não é sempre "pizza": depende de `flavorsKey` (ver a função).
  hasFlavors?: boolean;
  flavorsKey?: string;
  flavorsMode?: "pizza" | "own";
};

export type MenuPedidoApp = {
  sizes: { code: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  lanches: {
    name: string;
    price: number;
    sizes?: { code: string; price: number }[];
    hasFlavors?: boolean;
    flavorsKey?: string;
    flavorsMode?: "pizza" | "own";
  }[];
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
 * Acréscimo oficial do suco "com leite" — FONTE ÚNICA, em centavos.
 * Reutilizada tanto por `officialUnitPrice` (abaixo, caminho legado
 * name/detail) quanto pela precificação por estratégia/catálogo de
 * `simpleSelection` (ver `resolverItemComSelecaoSimplesEstruturada` em
 * @/lib/pedidoAppSelecaoEstruturada) — nenhum dos dois define o próprio
 * valor. Mudar aqui muda os dois caminhos igualmente.
 */
export const ACRESCIMO_LEITE_CENTS = 100;

export type FlavorsModeEfetivo = "pizza" | "own" | "invalido";

/**
 * Resolve o flavorsMode EFETIVO de um produto "single_flavor" (hasFlavors +
 * flavorsKey) — FONTE ÚNICA reutilizada pelo caminho estruturado
 * (buildSimpleCatalog, ver @/lib/catalog/simpleProducts) e pelo caminho
 * legado (officialUnitPrice, abaixo). Nunca dois fallbacks diferentes para a
 * mesma decisão.
 *
 * HARDENING (auditoria independente pós-8ª rodada): antes desta função,
 * `flavorsMode` ausente virava sempre "pizza" — correto para o Calzone
 * (regra comercial aprovada na 6ª rodada), mas ERRADO para um cardápio
 * `lanches` persistido ANTES da introdução deste campo, onde a Mini-Pizza
 * nunca teve `flavorsMode` gravado e dependia de `miniPizzaFlavors` sozinha
 * — isso ampliava silenciosamente a Mini-Pizza para qualquer sabor de pizza.
 * Também havia fail-open: um `flavorsMode` com valor desconhecido, ou modo
 * "own" cujo `flavorsKey` não resolvia para uma lista, caíam para os
 * sabores da Pizza em vez de rejeitar.
 *
 * Regras, nesta ordem — NUNCA pelo nome do produto:
 * - flavorsMode explícito "pizza"  => "pizza"
 * - flavorsMode explícito "own"    => "own"
 * - flavorsMode presente com qualquer outro valor (config corrompida)
 *   => "invalido" (fail-closed — nunca cai para sabores da Pizza)
 * - flavorsMode AUSENTE (cardápio persistido anterior à introdução deste
 *   campo): o comportamento histórico ANTES do modo "pizza" existir era
 *   sempre usar a lista PRÓPRIA do produto (nunca os sabores inteiros da
 *   Pizza) — tanto Calzone quanto Mini-Pizza dependiam só da própria lista
 *   (`calzoneFlavors`/`miniPizzaFlavors`). A 6ª rodada mudou esse padrão só
 *   para o Calzone, por decisão comercial explícita — uma exceção pelo
 *   `flavorsKey` ("calzoneFlavors"), nunca pelo nome do produto. Qualquer
 *   outro `flavorsKey` (Mini-Pizza — "miniPizzaFlavors" — ou um produto
 *   futuro sem histórico comprovado) preserva o comportamento histórico
 *   comprovável: lista própria ("own").
 */
export function resolverFlavorsModeEfetivo(produto: { flavorsKey?: string; flavorsMode?: string }): FlavorsModeEfetivo {
  if (produto.flavorsMode === "pizza") return "pizza";
  if (produto.flavorsMode === "own") return "own";
  if (produto.flavorsMode !== undefined) return "invalido";
  return produto.flavorsKey === "calzoneFlavors" ? "pizza" : "own";
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
      if (detail === "com leite") return Number.isFinite(suco.price) ? suco.price + ACRESCIMO_LEITE_CENTS / 100 : null;
      return null;
    }
    if (norm(found.name).includes("macarronada")) {
      const sizeCode = item.detail?.match(/^Tamanho\s+([A-Za-z])$/i)?.[1]?.toUpperCase();
      const size = sizeCode ? found.sizes?.find((entry) => entry.code.toUpperCase() === sizeCode) : null;
      return size && Number.isFinite(size.price) ? size.price : null;
    }

    // Produto de 1 sabor só (nunca meio a meio) — Calzone, Mini-Pizza, ou
    // qualquer outro que venha a existir. O frontend manda
    // `detail: "Sabor: <flavor>"` — payload adulterado com 2+ sabores, sem
    // sabor ou com sabor fora da lista efetiva é rejeitado aqui (não
    // confiamos em nada vindo do cliente além do nome/qty).
    //
    // HARDENING (auditoria independente pós-7ª rodada): a decisão de QUAL
    // produto passa por essa validação é `found.hasFlavors && found.flavorsKey`
    // — a mesma configuração oficial explícita que buildSimpleCatalog usa
    // para decidir `strategy === "single_flavor"` — NUNCA o nome do produto
    // ("calzone", "mini-pizza" etc.). Isso fecha a mesma classe de bug para
    // TODO produto configurado por sabor, não só o Calzone: um payload
    // legado que omite `simpleSelection` de propósito (para tentar contornar
    // a validação por catálogo/ID) nunca escapa pela porta dos fundos só
    // porque o produto tem outro nome.
    //
    // HARDENING (auditoria independente pós-8ª rodada): QUAL lista de
    // sabores vale (pizza inteira vs. lista própria) vem de
    // `resolverFlavorsModeEfetivo` — a MESMA fonte única usada por
    // buildSimpleCatalog, nunca um fallback próprio deste caminho. Modo
    // "invalido" (config corrompida) e modo "own" cujo `flavorsKey` não
    // resolve para uma lista rejeitam o item (fail-closed) — nenhum dos
    // dois cai para os sabores da Pizza.
    if (found.hasFlavors && found.flavorsKey) {
      const match = (item.detail || "").trim().match(/^Sabor:\s*(.+)$/i);
      if (!match) return null;
      const sabor = match[1].trim();
      if (!sabor || sabor.includes("/") || sabor.includes("·")) return null;

      const modoEfetivo = resolverFlavorsModeEfetivo(found);
      if (modoEfetivo === "invalido") return null;

      let saboresPermitidos: string[];
      if (modoEfetivo === "own") {
        const listaPropria = (menu as unknown as Record<string, unknown>)[found.flavorsKey];
        if (!Array.isArray(listaPropria)) return null;
        saboresPermitidos = (listaPropria as string[]).map(norm);
      } else {
        saboresPermitidos = [...menu.saltyFlavors, ...menu.sweetFlavors].map(norm);
      }
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
