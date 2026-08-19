const SECOES_TEXTO = ['saltyFlavors', 'sweetFlavors', 'calzoneFlavors', 'miniPizzaFlavors', 'payments'] as const
const SECOES_ITEM_PRECO = ['bebidas', 'sucos'] as const
const CHAVES_CONHECIDAS = new Set([
  'sizes', 'borders', 'neighborhoods', 'lanches',
  ...SECOES_TEXTO, ...SECOES_ITEM_PRECO,
])

const MAX_ITENS_POR_SECAO = 500
const MAX_TAMANHO_TEXTO = 200
const MAX_PRECO = 100000

function nomeValido(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TAMANHO_TEXTO
}

function precoValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_PRECO
}

function precoNaoNegativoValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_PRECO
}

export type ResultadoValidacaoCardapio =
  | { ok: true; cardapio: Record<string, unknown> }
  | { ok: false; erro: string }

function validarSecaoTexto(nomeSecao: string, valor: unknown): string | null {
  if (!Array.isArray(valor)) return `${nomeSecao}: precisa ser uma lista`
  if (valor.length > MAX_ITENS_POR_SECAO) return `${nomeSecao}: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (!nomeValido(item)) return `${nomeSecao}: contém um valor inválido (texto vazio ou grande demais)`
    if (vistos.has(item)) return `${nomeSecao}: item duplicado ("${item}")`
    vistos.add(item)
  }
  return null
}

function validarSecaoItemPreco(nomeSecao: string, valor: unknown): string | null {
  if (!Array.isArray(valor)) return `${nomeSecao}: precisa ser uma lista`
  if (valor.length > MAX_ITENS_POR_SECAO) return `${nomeSecao}: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return `${nomeSecao}: item inválido`
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.name)) return `${nomeSecao}: nome vazio ou inválido`
    if (!precoValido(obj.price)) return `${nomeSecao}: preço inválido em "${String(obj.name)}"`
    const chave = `${(obj.name as string).trim()}::${obj.price}`
    if (vistos.has(chave)) return `${nomeSecao}: item duplicado ("${obj.name}", mesmo preço)`
    vistos.add(chave)
  }
  return null
}

function validarSizes(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'sizes: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `sizes: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'sizes: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.code)) return 'sizes: código vazio ou inválido'
    if (!precoValido(obj.price)) return `sizes: preço inválido em "${String(obj.code)}"`
    if (obj.label !== undefined && !nomeValido(obj.label)) return `sizes: rótulo inválido em "${String(obj.code)}"`
    if (vistos.has(obj.code as string)) return `sizes: código duplicado ("${obj.code}")`
    vistos.add(obj.code as string)
  }
  return null
}

function validarLanches(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'lanches: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `lanches: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  const vistos = new Set<string>()
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'lanches: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.name)) return 'lanches: nome vazio ou inválido'
    if (!precoNaoNegativoValido(obj.price)) return `lanches: preço inválido em "${String(obj.name)}"`
    if (obj.sizes !== undefined) {
      if (!Array.isArray(obj.sizes)) return `lanches: tamanhos inválidos em "${String(obj.name)}"`
      for (const s of obj.sizes) {
        if (typeof s !== 'object' || s === null) return `lanches: tamanho inválido em "${String(obj.name)}"`
        const so = s as Record<string, unknown>
        if (!nomeValido(so.code) || !precoValido(so.price)) return `lanches: tamanho inválido em "${String(obj.name)}"`
      }
    }
    if (obj.flavorsMode !== undefined && obj.flavorsMode !== 'pizza' && obj.flavorsMode !== 'own') {
      return `lanches: flavorsMode inválido em "${String(obj.name)}"`
    }
    const chave = `${(obj.name as string).trim()}::${obj.price}`
    if (vistos.has(chave)) return `lanches: item duplicado ("${obj.name}", mesmo preço)`
    vistos.add(chave)
  }
  return null
}

function validarBorders(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'borders: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `borders: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'borders: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.label)) return 'borders: rótulo vazio ou inválido'
    if (!precoNaoNegativoValido(obj.priceSmall) || !precoNaoNegativoValido(obj.priceLarge)) {
      return `borders: preço inválido em "${String(obj.label)}"`
    }
  }
  return null
}

function validarNeighborhoods(valor: unknown): string | null {
  if (!Array.isArray(valor)) return 'neighborhoods: precisa ser uma lista'
  if (valor.length > MAX_ITENS_POR_SECAO) return `neighborhoods: excede o máximo de ${MAX_ITENS_POR_SECAO} itens`
  for (const item of valor) {
    if (typeof item !== 'object' || item === null) return 'neighborhoods: item inválido'
    const obj = item as Record<string, unknown>
    if (!nomeValido(obj.name)) return 'neighborhoods: nome vazio ou inválido'
    if (!precoNaoNegativoValido(obj.fee)) return `neighborhoods: taxa inválida em "${String(obj.name)}"`
  }
  return null
}

/** Validação estrutural pura do catálogo, separada da Route para cumprir o contrato de exports do Next.js. */
export function validarCardapio(body: unknown): ResultadoValidacaoCardapio {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, erro: 'Corpo inválido' }
  }
  const obj = body as Record<string, unknown>

  for (const chave of Object.keys(obj)) {
    if (!CHAVES_CONHECIDAS.has(chave)) return { ok: false, erro: `Campo desconhecido: ${chave}` }
  }

  if (obj.sizes !== undefined) {
    const erro = validarSizes(obj.sizes)
    if (erro) return { ok: false, erro }
  }
  if (obj.lanches !== undefined) {
    const erro = validarLanches(obj.lanches)
    if (erro) return { ok: false, erro }
  }
  if (obj.borders !== undefined) {
    const erro = validarBorders(obj.borders)
    if (erro) return { ok: false, erro }
  }
  if (obj.neighborhoods !== undefined) {
    const erro = validarNeighborhoods(obj.neighborhoods)
    if (erro) return { ok: false, erro }
  }
  for (const secao of SECOES_ITEM_PRECO) {
    if (obj[secao] !== undefined) {
      const erro = validarSecaoItemPreco(secao, obj[secao])
      if (erro) return { ok: false, erro }
    }
  }
  for (const secao of SECOES_TEXTO) {
    if (obj[secao] !== undefined) {
      const erro = validarSecaoTexto(secao, obj[secao])
      if (erro) return { ok: false, erro }
    }
  }

  return { ok: true, cardapio: obj }
}
