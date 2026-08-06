// Geração de IDs estáveis a partir de nomes existentes do cardápio.
//
// O texto visível (nome do produto/sabor) pode mudar sem quebrar o sistema —
// só o ID precisa ser estável. Como hoje não existe nenhum ID próprio no
// cardápio (tudo é reconhecido por nome), derivamos o ID do nome atual no
// momento da leitura. Isso NÃO inventa nenhum dado comercial novo: é só uma
// forma determinística de apontar para o mesmo nome que já existe.
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function withId<T extends { name: string }>(item: T, prefix: string): T & { id: string } {
  return { ...item, id: `${prefix}-${slugify(item.name)}` };
}
