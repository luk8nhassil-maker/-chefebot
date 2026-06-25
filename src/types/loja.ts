export interface Tenant {
  id: string
  nome: string
  logo_url: string | null
  cor_primaria: string
  horario: string
  endereco: string
  telefone: string
}

export interface Produto {
  id: string
  tenant_id: string
  nome: string
  descricao: string | null
  preco: number
  categoria: string
  foto_url: string | null
  ativo: boolean
}

export interface CartItem {
  cartId: string
  produtoId: string
  nome: string
  tamanho: string
  borda?: string
  quantidade: number
  observacao: string
  precoUnitario: number
  total: number
}

export interface PedidoConfirmado {
  id: string
  token: string
  total: number
  clienteNome: string
  tipoEntrega: 'delivery' | 'retirada'
  pagamento: 'pix' | 'cartao' | 'dinheiro'
  items: CartItem[]
  created_at: string
}

export interface TamanhoInfo {
  code: string
  label: string
  price: number
}

export interface BordaInfo {
  label: string
  priceSmall: number
  priceLarge: number
}

export type TipoProduto = 'pizza' | 'lanche_tamanhos' | 'item_simples'

export interface ProdutoLoja {
  id: string
  nome: string
  categoria: 'Pizzas' | 'Lanches' | 'Bebidas' | 'Sucos'
  tipo: TipoProduto
  preco: number
  tamanhos?: TamanhoInfo[]
}

export interface CardapioData {
  tamanhosPizza: TamanhoInfo[]
  bordas: BordaInfo[]
  produtos: ProdutoLoja[]
}
