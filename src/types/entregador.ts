export interface EntregadorCadastro {
  id: string
  nome: string
  telefone: string
  ativo: boolean
}

export interface PedidoEntregador {
  pedidoId: string
  entregadorId: string
  entregadorNome: string
  entregadorTelefone: string
  clienteNome: string
  clienteTelefone: string
  endereco: string
  total: number
  itens: string[]
  status: "pendente" | "em_rota" | "entregue"
  horarioSaida: string
}

export interface LocalizacaoEntregador {
  entregadorId: string
  pedidoId: string
  lat: number
  lng: number
  timestamp: number
}

export type LocalizacaoPublica = Omit<LocalizacaoEntregador, "entregadorId">
