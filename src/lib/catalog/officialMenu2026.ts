// Cardápio oficial 2026 — fonte comercial única, versionada, para pizzas,
// calzone, pastel de forno, pastel de feira, hambúrguer, lanches,
// macarronada, sucos, vitaminas, bebidas, adicionais e bordas de pizza.
//
// Por que isto NÃO mora no Redis (chave "cardapio", lida por
// getMENUDinamico): o incidente que motivou esta reestruturação é
// exatamente "Redis antigo restaura preço antigo silenciosamente". Preço,
// produto, sabor, ingrediente e categoria comercial destas seções agora só
// existem AQUI — versionados em código, revisados por PR como qualquer
// outra mudança de comportamento — nunca editáveis pela tela
// "Salvar Cardápio" nem persistidos em Redis. O que continua no Redis via
// Menu (@/lib/menu) é só estado OPERACIONAL: disponibilidade/esgotados
// (@/lib/estoque, já por ID estável), bairros/taxa de entrega e formas de
// pagamento — nada que decida um preço de produto.
//
// Fonte: CARDAPIO_CHEFE.pdf (cardápio impresso oficial, ago/2026),
// extraído e conferido texto + imagem, todas as 12 páginas. Nenhum valor
// aqui foi herdado do cardápio antigo (@/lib/menu) — cada preço/produto/
// ingrediente foi copiado literalmente do PDF, inclusive grafias como
// "Frango com Chedder", "Gongorzola", "Chapion", "Cremethse", "MeM" — ver
// decisão comercial aprovada "não corrigir silenciosamente nomes/grafias
// do PDF".
//
// Preços sempre em CENTAVOS INTEIROS. `reais` só existe como forma de
// leitura no código-fonte deste arquivo (mais fácil de conferir contra o
// PDF linha a linha) — a conversão para centavos acontece uma única vez,
// aqui, via `centavos()`.
import { slugify } from "./ids";

export const CATALOG_VERSION = 2;

function centavos(reais: number): number {
  return Math.round(reais * 100);
}

// ---------------------------------------------------------------------------
// Tamanhos de pizza
// ---------------------------------------------------------------------------

export type PizzaSizeCode = "F" | "G" | "M" | "P" | "MINI";

export interface OfficialPizzaSize {
  id: string;
  code: PizzaSizeCode;
  label: string;
  fatias: number;
}

// Ordem oficial (maior → menor), igual à do PDF em todas as tabelas.
export const PIZZA_SIZES: OfficialPizzaSize[] = [
  { id: `size-${slugify("F")}`, code: "F", label: "Família", fatias: 12 },
  { id: `size-${slugify("G")}`, code: "G", label: "Grande", fatias: 10 },
  { id: `size-${slugify("M")}`, code: "M", label: "Média", fatias: 8 },
  { id: `size-${slugify("P")}`, code: "P", label: "Pequena", fatias: 6 },
  { id: `size-${slugify("MINI")}`, code: "MINI", label: "Mini", fatias: 4 },
];

// Bordas e adicionais nunca se aplicam a MINI (o PDF não lista preço para
// MINI em nenhuma das duas tabelas) — usado pelo motor de preço para
// rejeitar a combinação, nunca para inventar um valor.
export const TAMANHOS_COM_BORDA_OU_ADICIONAL: PizzaSizeCode[] = ["P", "M", "G", "F"];

// ---------------------------------------------------------------------------
// Sabores de pizza — Tradicionais, Especiais, Doces
// ---------------------------------------------------------------------------

export type PizzaCategoryId = "tradicional" | "especial" | "doce";

export interface OfficialPizzaFlavor {
  id: string;
  name: string;
  category: PizzaCategoryId;
  ingredients: string;
  /** Preço por tamanho, em centavos. Especiais nunca têm chave MINI —
   *  é essa ausência (não uma lista separada) que o motor usa para
   *  rejeitar Especial + MINI. */
  pricesBySizeCode: Partial<Record<PizzaSizeCode, number>>;
  /** Grafias/apelidos que o bot do WhatsApp já reconhecia — apenas
   *  variações de escrita do MESMO sabor, nunca um sabor diferente. */
  aliases?: string[];
}

function tradicionalOuDoce(
  name: string,
  category: "tradicional" | "doce",
  ingredients: string,
  precos: { F: number; G: number; M: number; P: number; MINI: number },
  aliases?: string[]
): OfficialPizzaFlavor {
  return {
    id: `flavor-${slugify(name)}`,
    name,
    category,
    ingredients,
    pricesBySizeCode: {
      F: centavos(precos.F),
      G: centavos(precos.G),
      M: centavos(precos.M),
      P: centavos(precos.P),
      MINI: centavos(precos.MINI),
    },
    aliases,
  };
}

function especial(
  name: string,
  ingredients: string,
  precos: { F: number; G: number; M: number; P: number },
  aliases?: string[]
): OfficialPizzaFlavor {
  return {
    id: `flavor-${slugify(name)}`,
    name,
    category: "especial",
    ingredients,
    pricesBySizeCode: {
      F: centavos(precos.F),
      G: centavos(precos.G),
      M: centavos(precos.M),
      P: centavos(precos.P),
      // sem MINI — Especiais não têm tamanho Mini (decisão comercial aprovada).
    },
    aliases,
  };
}

export const PIZZA_FLAVORS_TRADICIONAIS: OfficialPizzaFlavor[] = [
  tradicionalOuDoce("Á Moda da Casa", "tradicional", "Molho, Calabresa, Bacon, Requeijão Cremoso, Mussarela e Orégano.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Baiana", "tradicional", "Molho, Mussarela, Calabresa Processada, Azeite de Dedê, Orégano e Pimenta.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Frango com Chedder", "tradicional", "Molho, Frango, Cheddar, Mussarela, Orégano e Bacon.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Milho", "tradicional", "Molho, Mussarela, Milho e Orégano.", { F: 50, G: 40, M: 35, P: 30, MINI: 12 }),
  tradicionalOuDoce("Peruana", "tradicional", "Molho, Mussarela, Peito de Peru e Orégano.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Calabresa", "tradicional", "Molho, Mussarela, Linguiça Calabresa, Cebola e Orégano.", { F: 50, G: 45, M: 38, P: 33, MINI: 15 }),
  tradicionalOuDoce("Frango", "tradicional", "Molho de Tomate, Mussarela, Frango e Orégano.", { F: 50, G: 45, M: 38, P: 33, MINI: 15 }),
  tradicionalOuDoce("Mussarela", "tradicional", "Molho, Mussarela, Rodelas de Tomate, e Orégano.", { F: 50, G: 45, M: 38, P: 33, MINI: 15 }),
  tradicionalOuDoce("Bacon", "tradicional", "Molho, Bacon, Mussarela, Tomate e Orégano.", { F: 50, G: 45, M: 38, P: 33, MINI: 15 }),
  tradicionalOuDoce("3 Queijos", "tradicional", "Molho, Mussarela, Parmesão, Requeijão Cremoso e Orégano.", { F: 50, G: 45, M: 38, P: 33, MINI: 15 }),
  tradicionalOuDoce("Napolitana", "tradicional", "Molho, Mussarela, Rodelas de Tomate, Queijo Parmesão e Orégano.", { F: 50, G: 45, M: 38, P: 33, MINI: 15 }),
  tradicionalOuDoce("Presunto", "tradicional", "Molho, Presunto, Mussarela e Orégano.", { F: 47, G: 43, M: 38, P: 33, MINI: 15 }),
  tradicionalOuDoce("Xuxa", "tradicional", "Molho, Mussarela, Milho, Bacon e Orégano.", { F: 48, G: 43, M: 35, P: 30, MINI: 13 }),
  tradicionalOuDoce("4 Queijos", "tradicional", "Molho, Mussarela, Requeijão Cremoso, Gongorzola e Parmesão.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Siciliana", "tradicional", "Molho, Mussarela, Bacon, Chapion e Orégano.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Caramussa", "tradicional", "Molho, Calabresa Coberta com Mussarela, Cebola e Orégano.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Toscana", "tradicional", "Molho, Calabresa Moída, Mussarela, Cebola e Orégano.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Frango com Requeijão", "tradicional", "Molho, Frango, Requeijão Cremoso, Mussarela e Orégano.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
];

export const PIZZA_FLAVORS_ESPECIAIS: OfficialPizzaFlavor[] = [
  especial("Calabresa Suprema", "Molho, Mussarela, Calabresa, Cremethse, Barbecue, Azeitona e Orégano.", { F: 70, G: 62, M: 55, P: 42 }),
  especial("Frango Catupiry Original", "Molho, Frango Catupiry Original, Mussarela, Azeitona e Orégano.", { F: 70, G: 62, M: 55, P: 42 }),
  especial("6 Queijos", "Molho, Requeijão Cremoso, Cheddar, Parmesão, Provolone, Gorgonzola, Mussarela e Orégano.", { F: 65, G: 55, M: 50, P: 40 }),
  especial("Nordestina", "Molho de Tomate, Mussarela, Carne Seca, Requeijão Cremoso, Pimentão, Tomate, Cebola, Azeitona e Orégano.", { F: 60, G: 55, M: 45, P: 38 }),
  especial("Mexicana", "Molho, Calabresa, Bacon, Requeijão Cremoso, Mussarela, Cebola, Pimenta e Orégano.", { F: 60, G: 55, M: 43, P: 38 }),
  especial("Portuguesa", "Molho, Presunto, Ervilha, Milho, Mussarela, Cebola, Azeitona, e Orégano.", { F: 60, G: 53, M: 43, P: 38 }),
  especial("Carne Seca Especial", "Molho, Mussarela, Carne Seca, Catupiry Original, Queijo Coalho, Geleia de Pimenta, Pimenta Biquinho e Orégano.", { F: 70, G: 62, M: 55, P: 42 }),
  especial("Mazini", "Molho, Frango, Bacon, Requeijão Cremoso, Banana, Mussarela e Orégano.", { F: 60, G: 55, M: 45, P: 38 }),
  especial("Carne Seca", "Molho, Mussarela, Carne seca, Requeijão Cremoso e Orégano.", { F: 60, G: 55, M: 45, P: 40 }),
  especial("Atum", "Molho, Atum, Cebola Mussarela e Orégano.", { F: 60, G: 55, M: 45, P: 40 }),
  especial("5 Queijos", "Molho, Requeijão Cremoso, Cheddar, Gorgonzola, Parmesão, Provolone e Orégano.", { F: 60, G: 55, M: 45, P: 40 }),
  especial("Caipira", "Molho, Frango, Bacon, Requeijão Cremoso, Milho Mussarela e Orégano.", { F: 60, G: 55, M: 45, P: 40 }),
  especial("Peper Cheddar", "Molho, Mussarela, Peperone, Cheddar, Bacon, Azeitona e Orégano.", { F: 60, G: 55, M: 45, P: 40 }),
  especial("Delicia", "Molho, Frango, Milho, Palmito, Tomate, Requeijão Cremoso, Bacon e Orégano.", { F: 65, G: 58, M: 50, P: 45 }),
  especial("Pizza do Chefe", "Molho, Presunto, Mussarela, Bacon, Palmito, Milho, Tomate, Cebola, Ovos e Orégano.", { F: 65, G: 55, M: 45, P: 40 }),
  especial("Calabresa com Barbecue", "Molho, Mussarela, Calabresa, Bacon, Cebola, Barbecue e Orégano.", { F: 60, G: 55, M: 45, P: 40 }),
  especial("Calabresa Especial", "Molho, Mussarela, Calabresa, Pimenta Calabresa, Pimenta Biquinho, Queijo Coalho, Cebola e Orégano.", { F: 60, G: 52, M: 43, P: 38 }),
  // Distinto de "Calabresa Suprema" — ingredientes diferentes, listado
  // separadamente no PDF (decisão comercial aprovada: nunca tratar como duplicata).
  especial("Calabresa Suprema 2", "Molho de Tomate, Mussarela, Calabresa, Barbecue, Cream Cheese e Orégano.", { F: 70, G: 62, M: 55, P: 42 }),
  especial("Carne de Sol da Casa", "Molho, Carne de Sol, Queijo Coalho, Pimenta Biquinho, Mussarela, Azeitona, Cebola e Orégano.", { F: 70, G: 62, M: 55, P: 42 }),
  especial("Carne de Sol Especial da Casa", "Molho, Mussarela, Carne de Sol, Geleia de Pimenta, Cream Cheese, Pimenta Biquinho, Cebola e Orégano.", { F: 70, G: 62, M: 55, P: 42 }),
];

export const PIZZA_FLAVORS_DOCES: OfficialPizzaFlavor[] = [
  tradicionalOuDoce("Chocolate", "doce", "Chocolate Preto.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Choconinho", "doce", "Creme de Leite, Creme de Ninho, Chocolate ao Leite.", { F: 60, G: 55, M: 45, P: 40, MINI: 20 }),
  tradicionalOuDoce("M&M", "doce", "Creme de Leite, Chocolate ao Leite, Coberto com MeM.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Dois Amores", "doce", "Creme de Leite, Chocolate ao Leite e Chocolate Branco.", { F: 60, G: 55, M: 45, P: 40, MINI: 20 }),
  tradicionalOuDoce("Sensação", "doce", "Chocolate, Granulado e Morango.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Romeu e Julieta", "doce", "Creme de Leite, Queijo e Goiabada.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
  tradicionalOuDoce("Cartola", "doce", "Banana Caramelizada, Canela, Leite Condensado e Creme de Leite.", { F: 55, G: 50, M: 40, P: 35, MINI: 17 }),
];

export const PIZZA_FLAVORS: OfficialPizzaFlavor[] = [
  ...PIZZA_FLAVORS_TRADICIONAIS,
  ...PIZZA_FLAVORS_ESPECIAIS,
  ...PIZZA_FLAVORS_DOCES,
];

// ---------------------------------------------------------------------------
// Adicionais e bordas de pizza — preço por tamanho (P/M/G/F, nunca MINI)
// ---------------------------------------------------------------------------

export interface OfficialPizzaExtra {
  id: string;
  label: string;
  pricesBySizeCode: Record<"P" | "M" | "G" | "F", number>;
}

function extra(prefix: string, label: string, precos: { P: number; M: number; G: number; F: number }): OfficialPizzaExtra {
  return {
    id: `${prefix}-${slugify(label)}`,
    label,
    pricesBySizeCode: { P: centavos(precos.P), M: centavos(precos.M), G: centavos(precos.G), F: centavos(precos.F) },
  };
}

export const PIZZA_ADDONS: OfficialPizzaExtra[] = [
  extra("addon", "Requeijão Cremoso", { P: 5, M: 5, G: 5, F: 7 }),
  extra("addon", "Cheddar Cremoso", { P: 5, M: 5, G: 5, F: 7 }),
  extra("addon", "Geléia de Pimenta", { P: 6, M: 7, G: 10, F: 15 }),
  extra("addon", "Catupiry (Original)", { P: 8, M: 10, G: 12, F: 15 }),
  extra("addon", "Cream Cheese", { P: 8, M: 10, G: 12, F: 15 }),
  extra("addon", "Bacon", { P: 6, M: 8, G: 10, F: 12 }),
  extra("addon", "Calabresa", { P: 5, M: 7, G: 9, F: 12 }),
  extra("addon", "Barbecue", { P: 8, M: 10, G: 12, F: 15 }),
];

export const PIZZA_BORDERS: OfficialPizzaExtra[] = [
  extra("border", "Requeijão Cremoso", { P: 10, M: 10, G: 10, F: 10 }),
  extra("border", "Catupiry Original", { P: 15, M: 15, G: 15, F: 15 }),
  extra("border", "Cream Cheese", { P: 15, M: 15, G: 15, F: 15 }),
  extra("border", "Cheddar", { P: 10, M: 10, G: 10, F: 10 }),
];

// ---------------------------------------------------------------------------
// Calzone e Pastel de Forno — mesmos 12 sabores/ingredientes (ver PDF pág.
// 6); quando os ingredientes são idênticos aos de um sabor de pizza já
// existente, reaproveita o MESMO flavorId (decisão comercial aprovada:
// "quando a mesma entidade comercial for compartilhada entre produtos,
// reutilizar o mesmo flavorId"). `displayLabel` só existe quando o PDF usa
// um texto diferente no contexto de Calzone/Pastel (Mazine vs Mazini) —
// nunca duplica a identidade.
// ---------------------------------------------------------------------------

export interface OfficialFlavorProductVariant {
  /** flavorId oficial reaproveitado (de PIZZA_FLAVORS) quando a mesma
   *  entidade comercial já existe como sabor de pizza; senão, um flavorId
   *  próprio (não existe como pizza). */
  flavorId: string;
  /** Rótulo exibido neste produto — só definido quando difere do `name`
   *  do flavorId de pizza reaproveitado (ex.: "Mazine" vs "Mazini"). */
  displayLabel?: string;
  name: string;
  ingredients: string;
}

function variant(name: string, ingredients: string, aliasOfPizzaFlavorName?: string): OfficialFlavorProductVariant {
  const flavorId = aliasOfPizzaFlavorName ? `flavor-${slugify(aliasOfPizzaFlavorName)}` : `flavor-${slugify(name)}`;
  const displayLabel = aliasOfPizzaFlavorName && slugify(aliasOfPizzaFlavorName) !== slugify(name) ? name : undefined;
  return { flavorId, displayLabel, name, ingredients };
}

// As 12 entradas — nome/ingrediente exatamente como aparecem no PDF (seção
// Calzone). Preço do Calzone é POR SABOR (decisão comercial aprovada);
// Pastel de Forno usa os mesmos 12, todos a R$25,00.
const CALZONE_PASTEL_VARIANTS: OfficialFlavorProductVariant[] = [
  variant("Carne Seca", "Molho, Mussarela, Carne seca, Requeijão Cremoso e Orégano.", "Carne Seca"),
  variant("Frango", "Molho de Tomate, Mussarela, Frango e Orégano.", "Frango"),
  variant("Frango com Requeijão", "Molho, Frango, Requeijão Cremoso, Mussarela e Orégano.", "Frango com Requeijão"),
  variant("Calabresa", "Molho, Mussarela, Linguiça Calabresa, Cebola e Orégano.", "Calabresa"),
  variant("Calabresa com Requeijão", "Molho, Mussarela, Calabresa, Bacon, Cebola, Barbecue e Orégano."), // sem equivalente em pizza — flavorId próprio
  variant("Portuguesa", "Molho, Presunto, Ervilha, Milho, Mussarela, Cebola, Azeitona, e Orégano.", "Portuguesa"),
  variant("Baiana", "Molho, Mussarela, Calabresa Processada, Azeite de Dedê, Orégano e Pimenta.", "Baiana"),
  variant("Mexicana", "Molho, Calabresa, Bacon, Requeijão Cremoso, Mussarela, Cebola, Pimenta e Orégano.", "Mexicana"),
  variant("Mazine", "Molho, Frango, Bacon, Requeijão Cremoso, Banana, Mussarela e Orégano.", "Mazini"),
  variant("3 Queijos", "Molho, Mussarela, Parmesão, Requeijão Cremoso e Orégano.", "3 Queijos"),
  variant("A Moda", "Molho, Calabresa, Bacon, Requeijão Cremoso, Mussarela e Orégano.", "Á Moda da Casa"),
  variant("Delicia", "Molho, Frango, Milho, Palmito, Tomate, Requeijão Cremoso, Bacon e Orégano.", "Delicia"),
];

export interface OfficialCalzoneFlavor extends OfficialFlavorProductVariant {
  id: string;
  priceCents: number;
}

const CALZONE_PRECOS: Record<string, number> = {
  "Carne Seca": 40,
  "Frango": 30,
  "Frango com Requeijão": 35,
  "Calabresa": 30,
  "Calabresa com Requeijão": 32,
  "Portuguesa": 35,
  "Baiana": 30,
  "Mexicana": 35,
  "Mazine": 35,
  "3 Queijos": 28,
  "A Moda": 35,
  "Delicia": 35,
};

export const CALZONE_FLAVORS: OfficialCalzoneFlavor[] = CALZONE_PASTEL_VARIANTS.map((v) => ({
  ...v,
  id: `calzone-${slugify(v.name)}`,
  priceCents: centavos(CALZONE_PRECOS[v.name]),
}));

export const PASTEL_FORNO_PRICE_CENTS = centavos(25);

export interface OfficialPastelFornoFlavor extends OfficialFlavorProductVariant {
  id: string;
  priceCents: number;
}

export const PASTEL_FORNO_FLAVORS: OfficialPastelFornoFlavor[] = CALZONE_PASTEL_VARIANTS.map((v) => ({
  ...v,
  id: `pastel-forno-${slugify(v.name)}`,
  priceCents: PASTEL_FORNO_PRICE_CENTS,
}));

// ---------------------------------------------------------------------------
// Pastel de Feira — recheios próprios (não são sabores de pizza; entidade
// comercial independente, mesmo quando o nome coincide, ex.: "Frango").
// ---------------------------------------------------------------------------

export const PASTEL_FEIRA_PRICE_CENTS = centavos(8);

export interface OfficialPastelFeiraRecheio {
  id: string;
  name: string;
  ingredients: string;
}

export const PASTEL_FEIRA_RECHEIOS: OfficialPastelFeiraRecheio[] = [
  { id: "pastel-feira-frango", name: "Frango", ingredients: "frango, milho, ervilha, queijo e orégano" },
  { id: "pastel-feira-frango-com-catupiri", name: "Frango com Catupiri", ingredients: "frango, catupiri, queijo, milho e azeitona" },
  { id: "pastel-feira-queijo", name: "Queijo", ingredients: "queijo coalho" },
  { id: "pastel-feira-calabresa", name: "Calabresa", ingredients: "calabresa, queijo, cebola e orégano" },
  { id: "pastel-feira-carne-seca", name: "Carne seca", ingredients: "carne de sol, catupiry e queijo, mussarela, orégano" },
  { id: "pastel-feira-queijo-com-presunto", name: "Queijo com Presunto", ingredients: "presunto, queijo, e orégano" },
];

// ---------------------------------------------------------------------------
// Hambúrguer — categoria própria
// ---------------------------------------------------------------------------

export interface OfficialFixedProduct {
  id: string;
  name: string;
  ingredients?: string;
  priceCents: number;
}

export const HAMBURGUERES: OfficialFixedProduct[] = [
  { id: "hamburguer-x-burguer", name: "X-Burguer", ingredients: "1 hambúrguer: Ovo, Salada, Molho, Mussarela, Cheddar e Presunto.", priceCents: centavos(17) },
  { id: "hamburguer-x-bacon", name: "X-Bacon", ingredients: "2 hambúrguer: Ovo, Salada, Mussarela, Cheddar, Molho Especial e Presunto.", priceCents: centavos(20) },
  { id: "hamburguer-x-tudo", name: "X-Tudo", ingredients: "2 hambúrguer: Ovo, Salada, Mussarela, Cheddar, Molho Especial, Bacon, Catupiry, Batata Palha, Milho Verde e Presunto.", priceCents: centavos(25) },
  { id: "hamburguer-x-calabresa", name: "X-Calabresa", ingredients: "2 Carne, Ovos, Queijo, Presunto, Cheddar, Calabresa, Salada e Molho Especial.", priceCents: centavos(20) },
  { id: "hamburguer-x-salada", name: "X-Salada", ingredients: "Carne, Queijo, Presunto, Cheddar e Salada.", priceCents: centavos(15) },
];

// ---------------------------------------------------------------------------
// Lanches (itens fixos, fora do grupo Hambúrguer/Pastel de Feira)
// ---------------------------------------------------------------------------

export const LANCHES_FIXOS: OfficialFixedProduct[] = [
  { id: "lanche-porcao-de-batatas", name: "Porção de Batatas", priceCents: centavos(12) },
  { id: "lanche-coxinha-de-frango", name: "Coxinha de Frango", priceCents: centavos(8) },
  { id: "lanche-coxinha-de-frango-c-catupiry", name: "Coxinha de Frango c/ Catupiry", priceCents: centavos(7) },
  { id: "lanche-pastel-de-carne-seca", name: "Pastel de Carne Seca", priceCents: centavos(12) },
];

// ---------------------------------------------------------------------------
// Macarronada — tamanhos G/M/P/PP + grupo opcional de adicional (no máximo 1)
// ---------------------------------------------------------------------------

export type MacarronadaSizeCode = "G" | "M" | "P" | "PP";

export interface OfficialMacarronada {
  id: string;
  name: string;
  ingredients: string;
  pricesBySizeCode: Record<MacarronadaSizeCode, number>;
}

export const MACARRONADAS: OfficialMacarronada[] = [
  {
    id: "macarronada-de-carne",
    name: "Macarronada de Carne",
    ingredients: "Molho de carne, Mussarela, Presunto, Milho, ervilha e Batata Palha.",
    pricesBySizeCode: { G: centavos(50), M: centavos(40), P: centavos(28), PP: centavos(15) },
  },
  {
    id: "macarronada-de-frango",
    name: "Macarronada de Frango",
    ingredients: "Creme de Leite, Frango, Queijo mussarela, Molho, Milho, Ervilha, Batata Palha.",
    pricesBySizeCode: { G: centavos(55), M: centavos(43), P: centavos(30), PP: centavos(17) },
  },
];

// Grupo opcional "no máximo 1 dos dois" — nunca os dois juntos (o PDF não
// define cobrança de R$20 para os dois ao mesmo tempo).
export interface OfficialAddOnGroupOption {
  id: string;
  label: string;
  priceCents: number;
}

export const MACARRONADA_ADICIONAL_GRUPO: { max: 1; options: OfficialAddOnGroupOption[] } = {
  max: 1,
  options: [
    { id: "macarronada-adicional-bacon", label: "Bacon", priceCents: centavos(10) },
    { id: "macarronada-adicional-ovos", label: "Ovo", priceCents: centavos(10) },
  ],
};

// ---------------------------------------------------------------------------
// Sucos — preço base por sabor + acréscimo único "com leite"
// ---------------------------------------------------------------------------

export const ACRESCIMO_LEITE_CENTS = centavos(1);

export const SUCOS: OfficialFixedProduct[] = [
  { id: "suco-caja", name: "Cajá", priceCents: centavos(8) },
  { id: "suco-caju", name: "Cajú", priceCents: centavos(7) },
  { id: "suco-acerola", name: "Acerola", priceCents: centavos(7) },
  { id: "suco-goiaba", name: "Goiaba", priceCents: centavos(7) },
  { id: "suco-bacuri", name: "Bacuri", priceCents: centavos(10) },
  { id: "suco-cupuacu", name: "Cupuaçú", priceCents: centavos(9) },
  { id: "suco-laranja", name: "Laranja", priceCents: centavos(10) },
  { id: "suco-maracuja", name: "Maracujá", priceCents: centavos(10) },
  { id: "suco-graviola", name: "Graviola", priceCents: centavos(9) },
  { id: "suco-abacaxi", name: "Abacaxi", priceCents: centavos(8) },
  { id: "suco-abacaxi-com-hortela", name: "Abacaxi c/ Hortelã", priceCents: centavos(9) },
];

// ---------------------------------------------------------------------------
// Vitaminas — categoria própria; NUNCA herda a regra do leite dos sucos.
// ---------------------------------------------------------------------------

export const VITAMINAS: OfficialFixedProduct[] = [
  { id: "vitamina-de-banana", name: "Vitamina de Banana", priceCents: centavos(10) },
];

// ---------------------------------------------------------------------------
// Bebidas — exatamente as do PDF (nunca reaproveitar preço antigo da main)
// ---------------------------------------------------------------------------

export const BEBIDAS: OfficialFixedProduct[] = [
  { id: "bebida-guarana-1l", name: "Guaraná 1L", priceCents: centavos(9) },
  { id: "bebida-guarana-1-5l", name: "Guaraná 1,5L", priceCents: centavos(11) },
  { id: "bebida-guarana-2l", name: "Guaraná 2L", priceCents: centavos(13) },
  { id: "bebida-guarana-lata", name: "Guaraná Lata", priceCents: centavos(6) },
  { id: "bebida-guarana-zero-lata", name: "Guaraná Zero Lata", priceCents: centavos(6) },
  { id: "bebida-guarana-zero-1l", name: "Guaraná Zero 1L", priceCents: centavos(9) },
  { id: "bebida-guarana-zero-2l", name: "Guaraná Zero 2L", priceCents: centavos(13) },
  { id: "bebida-pepsi-lata", name: "Pepsi Lata", priceCents: centavos(5) },
  { id: "bebida-coca-cola-1l", name: "Coca-Cola 1L", priceCents: centavos(11) },
  { id: "bebida-jesus-1l", name: "Jesus 1L", priceCents: centavos(11) },
  { id: "bebida-fanta-laranja-1l", name: "Fanta Laranja 1L", priceCents: centavos(11) },
  { id: "bebida-kuat-1l", name: "Kuat 1L", priceCents: centavos(11) },
  { id: "bebida-coca-cola-2l", name: "Coca-Cola 2L", priceCents: centavos(15) },
  { id: "bebida-jesus-2l", name: "Jesus 2L", priceCents: centavos(15) },
  { id: "bebida-fanta-laranja-2l", name: "Fanta Laranja 2L", priceCents: centavos(15) },
  { id: "bebida-fanta-uva-2l", name: "Fanta Uva 2L", priceCents: centavos(15) },
  { id: "bebida-kuat-2l", name: "Kuat 2L", priceCents: centavos(15) },
  { id: "bebida-refrigerante-1-5l", name: "Refrigerante 1,5L", priceCents: centavos(13) },
  { id: "bebida-refrigerante-lata", name: "Refrigerante Lata", priceCents: centavos(6) },
  { id: "bebida-refrigerante-retornavel", name: "Refrigerante Retornável", priceCents: centavos(10) },
  { id: "bebida-agua-sem-gas", name: "Água sem Gás", priceCents: centavos(3) },
  { id: "bebida-agua-com-gas", name: "Água com Gás", priceCents: centavos(4) },
  { id: "bebida-cerveja-long-neck", name: "Cerveja Long Neck", priceCents: centavos(10) },
];
