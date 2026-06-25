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
  tamanho: 'P' | 'M' | 'G'
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
