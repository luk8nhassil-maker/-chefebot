// Promoções do Cardápio: montadas a partir de produtos reais do cardápio
// (nunca texto solto) para impedir preço errado, produto inexistente ou
// brinde cobrado. Persistidas no Redis na chave cardapio:promocoes.

export const PROMOS_KEY = "cardapio:promocoes";

export type PromoTipo = "combo_fixed_price" | "buy_get_free" | "product_discount" | "custom_bundle";

export type PromoCategoria = "pizza" | "lanche" | "bebida" | "suco" | "macarronada" | "outro";

export type PromoMainItem = {
  productId: string;
  productName: string;
  category: PromoCategoria;
  sizeRequired?: string;
  quantity: number;
  customerMustChooseFlavor?: boolean;
};

export type PromoFreeItem = {
  productId: string;
  productName: string;
  category: PromoCategoria;
  quantity: number;
  priceImpact: 0;
};

export type Promocao = {
  id: string;
  active: boolean;
  featured: boolean;
  badge: string;
  title: string;
  description: string;
  buttonText: string;
  type: PromoTipo;
  mainItems: PromoMainItem[];
  freeItems: PromoFreeItem[];
  originalPrice?: number;
  promotionalPrice?: number;
  discountValue?: number;
  discountPercent?: number;
  includedText: string;
  maxUsesPerOrder?: number;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CatalogoProduto = {
  productId: string;
  productName: string;
  category: PromoCategoria;
  price: number;
};

type MenuPromo = {
  sizes: { code: string; label?: string; price: number }[];
  saltyFlavors: string[];
  sweetFlavors: string[];
  lanches: { name: string; price: number; sizes?: { code: string; price: number }[] }[];
  bebidas: { name: string; price: number }[];
  sucos: { name: string; price: number }[];
};

function norm(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Catálogo plano de produtos reais que podem compor uma promoção. Pizzas
// entram por tamanho (o sabor é escolhido pelo cliente na hora).
export function catalogoDoMenu(menu: MenuPromo): CatalogoProduto[] {
  const out: CatalogoProduto[] = [];
  for (const s of menu.sizes || []) {
    out.push({ productId: `pizza:${s.code}`, productName: `Pizza ${s.code}`, category: "pizza", price: s.price });
  }
  for (const l of menu.lanches || []) {
    if (Array.isArray(l.sizes) && l.sizes.length > 0) {
      for (const sz of l.sizes) out.push({ productId: `macarronada:${l.name}:${sz.code}`, productName: `${l.name} ${sz.code}`, category: "macarronada", price: sz.price });
    } else {
      out.push({ productId: `lanche:${l.name}`, productName: l.name, category: "lanche", price: l.price });
    }
  }
  for (const b of menu.bebidas || []) out.push({ productId: `bebida:${b.name}`, productName: b.name, category: "bebida", price: b.price });
  for (const s of menu.sucos || []) out.push({ productId: `suco:${s.name}`, productName: s.name, category: "suco", price: s.price });
  return out;
}

export function buscarProdutoCatalogo(catalogo: CatalogoProduto[], productId: string): CatalogoProduto | null {
  return catalogo.find((p) => p.productId === productId) || null;
}

// Regras de segurança para uma promoção poder ficar ATIVA. Retorna a lista
// de erros; vazia = válida.
export function validarPromocao(promo: Partial<Promocao>, menu: MenuPromo): string[] {
  const erros: string[] = [];
  const catalogo = catalogoDoMenu(menu);

  if (!promo.title || !promo.title.trim()) erros.push("Título é obrigatório.");
  if (!promo.description || !promo.description.trim()) erros.push("Descrição é obrigatória.");
  if (!promo.type || !["combo_fixed_price", "buy_get_free", "product_discount", "custom_bundle"].includes(promo.type)) {
    erros.push("Tipo de promoção inválido.");
  }

  const mains = Array.isArray(promo.mainItems) ? promo.mainItems : [];
  if (mains.length < 1) erros.push("A promoção precisa de pelo menos 1 item principal do cardápio.");
  for (const item of mains) {
    const prod = item.productId ? buscarProdutoCatalogo(catalogo, item.productId) : null;
    if (!prod) { erros.push(`Item principal não existe no cardápio: ${item.productName || item.productId || "?"}.`); continue; }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) erros.push(`Quantidade inválida em ${prod.productName}.`);
  }

  const frees = Array.isArray(promo.freeItems) ? promo.freeItems : [];
  for (const item of frees) {
    const prod = item.productId ? buscarProdutoCatalogo(catalogo, item.productId) : null;
    if (!prod) { erros.push(`Item grátis não existe no cardápio: ${item.productName || item.productId || "?"}.`); continue; }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) erros.push(`Quantidade inválida no item grátis ${prod.productName}.`);
    if (item.priceImpact !== 0) erros.push(`Item grátis ${prod.productName} precisa custar R$ 0,00.`);
    if (mains.some((m) => m.productId === item.productId)) erros.push(`${prod.productName} não pode ser cobrado e grátis ao mesmo tempo.`);
  }

  const precoMains = mains.reduce((soma, m) => {
    const prod = m.productId ? buscarProdutoCatalogo(catalogo, m.productId) : null;
    return soma + (prod ? prod.price * (Number.isInteger(m.quantity) && m.quantity > 0 ? m.quantity : 1) : 0);
  }, 0);

  if (promo.type === "product_discount") {
    const original = typeof promo.originalPrice === "number" ? promo.originalPrice : precoMains;
    const desconto = typeof promo.discountValue === "number" ? promo.discountValue : (typeof promo.promotionalPrice === "number" ? original - promo.promotionalPrice : NaN);
    if (!Number.isFinite(desconto) || desconto <= 0) erros.push("Informe o desconto ou o preço promocional.");
    else if (desconto > original) erros.push("Desconto não pode ser maior que o valor original.");
  }

  const precoFinal = precoFinalPromocao(promo as Promocao, catalogo);
  if (precoFinal === null) erros.push("Não foi possível calcular o preço promocional.");
  else if (precoFinal < 0) erros.push("Preço promocional não pode ser negativo.");

  if (promo.maxUsesPerOrder !== undefined && (!Number.isInteger(promo.maxUsesPerOrder) || promo.maxUsesPerOrder < 1)) {
    erros.push("Limite por pedido precisa ser 1 ou mais.");
  }

  return erros;
}

// Preço final cobrado do cliente, sempre materializado a partir do tipo:
// combo/custom usam promotionalPrice; buy_get_free usa o preço real dos itens
// principais; product_discount usa original - desconto.
export function precoFinalPromocao(promo: Pick<Promocao, "type" | "mainItems" | "originalPrice" | "promotionalPrice" | "discountValue">, catalogo: CatalogoProduto[]): number | null {
  const mains = Array.isArray(promo.mainItems) ? promo.mainItems : [];
  const precoMains = mains.reduce((soma, m) => {
    const prod = m.productId ? buscarProdutoCatalogo(catalogo, m.productId) : null;
    if (!prod) return NaN;
    return soma + prod.price * (Number.isInteger(m.quantity) && m.quantity > 0 ? m.quantity : 1);
  }, 0);
  if (!Number.isFinite(precoMains)) return null;

  if (promo.type === "buy_get_free") return precoMains;
  if (promo.type === "product_discount") {
    const original = typeof promo.originalPrice === "number" ? promo.originalPrice : precoMains;
    if (typeof promo.discountValue === "number") return original - promo.discountValue;
    if (typeof promo.promotionalPrice === "number") return promo.promotionalPrice;
    return null;
  }
  // combo_fixed_price e custom_bundle exigem preço explícito
  return typeof promo.promotionalPrice === "number" && Number.isFinite(promo.promotionalPrice) ? promo.promotionalPrice : null;
}

export function dentroDaJanela(promo: Promocao, agora: Date = new Date()): boolean {
  if (promo.startsAt && new Date(promo.startsAt) > agora) return false;
  if (promo.endsAt && new Date(promo.endsAt) < agora) return false;
  return true;
}

// Um produto fixo esgotado torna a promoção indisponível (opção mais segura:
// o cliente nem vê a promoção). Sabor de pizza é filtrado na escolha.
export function promocaoIndisponivel(promo: Promocao, esgotados: string[]): boolean {
  const esg = (esgotados || []).map(norm);
  const nomes = [
    ...promo.mainItems.filter((m) => m.category !== "pizza").map((m) => m.productName),
    ...promo.freeItems.map((f) => f.productName),
  ];
  return nomes.some((n) => esg.includes(norm(n)));
}

// Lista pública: só promoções ativas, válidas, dentro da janela e sem
// produto esgotado, com destaque primeiro e preço final materializado.
export function promocoesPublicas(promos: Promocao[], menu: MenuPromo, esgotados: string[]): Promocao[] {
  const catalogo = catalogoDoMenu(menu);
  return (promos || [])
    .filter((p) => p.active)
    .filter((p) => dentroDaJanela(p))
    .filter((p) => validarPromocao(p, menu).length === 0)
    .filter((p) => !promocaoIndisponivel(p, esgotados))
    .map((p) => ({ ...p, promotionalPrice: precoFinalPromocao(p, catalogo) ?? p.promotionalPrice }))
    .sort((a, b) => Number(b.featured) - Number(a.featured));
}
