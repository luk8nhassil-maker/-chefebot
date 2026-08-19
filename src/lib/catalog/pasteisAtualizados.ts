// Atualização comercial dos pastéis, aprovada em 19/08/2026.
//
// Esta fonte é deliberadamente pequena e isolada para ADICIONAR os novos
// produtos ao cardápio sem remover o Pastel de Forno de R$25 já existente.
// IDs são estáveis e preços ficam em centavos inteiros.

export const PASTEL_CARNE_SECA_ATUAL = {
  id: "lanche-pastel-de-carne-seca",
  name: "Pastel de Carne Seca",
  priceCents: 1200,
  ingredients: "Carne de sol, Catupiry, queijo mussarela e orégano.",
} as const;

export const PASTEL_FEIRA_ATUAL = {
  id: "product-pastel-de-feira",
  name: "Pastel de Feira",
  priceCents: 800,
  recheios: [
    {
      id: "pastel-feira-carne",
      name: "Carne",
      ingredients: "Carne moída, milho e ervilha.",
    },
    {
      id: "pastel-feira-frango",
      name: "Frango",
      ingredients: "Frango, milho, ervilha, queijo e orégano.",
    },
    {
      id: "pastel-feira-frango-com-catupiri",
      name: "Frango com Catupiri",
      ingredients: "Frango, Catupiri, queijo, milho e azeitona.",
    },
    {
      id: "pastel-feira-queijo",
      name: "Queijo",
      ingredients: "Queijo coalho.",
    },
    {
      id: "pastel-feira-calabresa",
      name: "Calabresa",
      ingredients: "Calabresa, queijo, cebola e orégano.",
    },
    {
      id: "pastel-feira-queijo-com-presunto",
      name: "Queijo com Presunto",
      ingredients: "Presunto, queijo e orégano.",
    },
  ],
} as const;
