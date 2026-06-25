import { getMENUDinamico } from '@/lib/menu'
import { NextResponse } from 'next/server'

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function GET() {
  const menu = await getMENUDinamico()

  type SizeEntry = { code: string; price: number }
  type BorderEntry = { label: string; priceSmall: number; priceLarge: number }
  type LancheEntry = { name: string; price: number; sizes?: SizeEntry[] }
  type SimpleEntry = { name: string; price: number }

  const tamanhosPizza = (menu.sizes as SizeEntry[]).map(s => ({
    code: s.code,
    label:
      s.code === 'P' ? 'Pequena' :
      s.code === 'M' ? 'Média' :
      s.code === 'G' ? 'Grande' : 'Família',
    price: s.price,
  }))

  const bordas = (menu.borders as BorderEntry[]).map(b => ({
    label: b.label,
    priceSmall: b.priceSmall,
    priceLarge: b.priceLarge,
  }))

  const pizzas = [
    ...(menu.saltyFlavors as string[]).map(nome => ({
      id: `pizza-${slugify(nome)}`,
      nome,
      categoria: 'Pizzas' as const,
      tipo: 'pizza' as const,
      preco: menu.sizes[0]?.price ?? 35,
    })),
    ...(menu.sweetFlavors as string[]).map(nome => ({
      id: `pizza-doce-${slugify(nome)}`,
      nome,
      categoria: 'Pizzas' as const,
      tipo: 'pizza' as const,
      preco: menu.sizes[0]?.price ?? 35,
    })),
  ]

  const lanches = (menu.lanches as LancheEntry[]).map(l => ({
    id: `lanche-${slugify(l.name)}`,
    nome: l.name,
    categoria: 'Lanches' as const,
    tipo: (l.sizes ? 'lanche_tamanhos' : 'item_simples') as 'lanche_tamanhos' | 'item_simples',
    preco: l.sizes ? l.sizes[0].price : l.price,
    tamanhos: l.sizes
      ? l.sizes.map((s: SizeEntry) => ({
          code: s.code,
          label: s.code === 'P' ? 'Pequena' : s.code === 'M' ? 'Média' : 'Grande',
          price: s.price,
        }))
      : undefined,
  }))

  const bebidas = (menu.bebidas as SimpleEntry[]).map(b => ({
    id: `bebida-${slugify(b.name)}`,
    nome: b.name,
    categoria: 'Bebidas' as const,
    tipo: 'item_simples' as const,
    preco: b.price,
  }))

  const sucos = (menu.sucos as SimpleEntry[]).map(s => ({
    id: `suco-${slugify(s.name)}`,
    nome: s.name,
    categoria: 'Sucos' as const,
    tipo: 'item_simples' as const,
    preco: s.price,
  }))

  return NextResponse.json({
    tamanhosPizza,
    bordas,
    produtos: [...pizzas, ...lanches, ...bebidas, ...sucos],
  })
}
