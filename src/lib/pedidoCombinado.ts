import type { MensagemRelevante } from './bot'
export { filtrarMensagensDoCiclo, recortarMensagensRecentes } from './ciclos'

export type RascunhoCombinado = {
  itens: string[]
  tipoEntrega: 'delivery' | 'retirada' | 'dine_in' | ''
  endereco: string
  bairro: string
  pagamento: string
  troco: string
}

function norm(txt: string): string {
  return txt.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function detectarPagamento(low: string): string | null {
  if (low.includes('dinheiro')) return 'Dinheiro'
  if (/\bpix\b/.test(low)) return 'Pix'
  if (low.includes('credito') || low.includes('credit')) return 'Cartão de Crédito'
  if (low.includes('debito') || low.includes('debit')) return 'Cartão de Débito'
  if (low.includes('cartao') || low.includes('cartão') || low.includes('maquina') || low.includes('maquininha')) return 'Cartão'
  return null
}

function isNegacao(low: string): boolean {
  return /^n[aã]o$|^nao$|^nope$|^nop$/.test(low.trim())
}

function isAddressLike(txt: string): boolean {
  const low = norm(txt)
  const temNumero = /\d/.test(txt)
  const temPalavraRua = low.includes('rua') || low.includes('av') || low.includes('avenida') ||
    low.includes('travessa') || low.includes('beco') || low.includes('estrada') ||
    low.includes('alameda') || low.includes('rodovia') || low.includes('proximo') ||
    low.includes('perto') || low.includes('numero') || low.includes('nº') || low.includes('n°')
  return temNumero && temPalavraRua && txt.length > 8
}

function isItemLike(low: string): boolean {
  return (
    low.includes('pizza') || low.includes('hamburguer') || low.includes('hamburgão') ||
    low.includes('lanche') || low.includes('suco') || low.includes('coca') ||
    low.includes('refrigerante') || low.includes('bebida') || low.includes('macarr') ||
    low.includes('calzone') || low.includes('batata') || low.includes('frango') ||
    low.includes('massa') || low.includes('sobremesa') || low.includes('agua')
  )
}

export function extrairDaConversa(mensagens: MensagemRelevante[]): RascunhoCombinado {
  const resultado: RascunhoCombinado = {
    itens: [],
    tipoEntrega: '',
    endereco: '',
    bairro: '',
    pagamento: '',
    troco: '',
  }

  let ultimaAtendenteLow = ''
  let ultimoClienteEraEndereco = false

  for (const m of mensagens) {
    const txt = m.texto.trim()
    const low = norm(txt)

    if (m.autor === 'atendente' || m.autor === 'bot') {
      ultimaAtendenteLow = low
      ultimoClienteEraEndereco = false
      continue
    }

    // cliente

    // Tipo de entrega
    if (!resultado.tipoEntrega) {
      if (low.includes('retirada') || low.includes('vou buscar') || low.includes('pegar no local') || low.includes('buscar no local')) {
        resultado.tipoEntrega = 'retirada'
      } else if (low.includes('consumo no local') || low.includes('comer aqui') || low.includes('mesa')) {
        resultado.tipoEntrega = 'dine_in'
      }
    }

    // Item de pedido
    if (isItemLike(low) && txt.length > 5) {
      resultado.itens.push(txt)
      continue
    }

    // Negação logo após pergunta de item (ex: "quer bebida?") → ignora, não é pagamento
    if (isNegacao(low)) {
      const atendentePerguntouBebida = ultimaAtendenteLow.includes('bebida') || ultimaAtendenteLow.includes('suco')
      const atendentePerguntouItem = ultimaAtendenteLow.includes('mais alguma') || ultimaAtendenteLow.includes('mais algo') || ultimaAtendenteLow.includes('quer mais')
      const atendentePerguntouTroco = ultimaAtendenteLow.includes('troco') || ultimaAtendenteLow.includes('troca')
      if (atendentePerguntouTroco && !resultado.troco) {
        resultado.troco = 'Sem troco'
        continue
      }
      if (atendentePerguntouBebida || atendentePerguntouItem) continue // descarta negação de item
    }

    // Endereço: prioriza contexto, depois fallback
    if (!resultado.endereco) {
      const atendentePerguntouEndereco = ultimaAtendenteLow.includes('endereco') || ultimaAtendenteLow.includes('rua') ||
        (ultimaAtendenteLow.includes('onde') && ultimaAtendenteLow.includes('entrega')) ||
        ultimaAtendenteLow.includes('logradouro')
      if (atendentePerguntouEndereco || isAddressLike(txt)) {
        resultado.endereco = txt
        ultimoClienteEraEndereco = true
        continue
      }
    }

    // Bairro: contexto ou mensagem curta após endereço
    if (!resultado.bairro) {
      const atendentePerguntouBairro = ultimaAtendenteLow.includes('bairro') || ultimaAtendenteLow.includes('regiao') || ultimaAtendenteLow.includes('região')
      if (atendentePerguntouBairro || ultimoClienteEraEndereco) {
        if (txt.length > 0 && txt.length <= 40 && !detectarPagamento(low)) {
          resultado.bairro = txt
          ultimoClienteEraEndereco = false
          continue
        }
      }
    }
    ultimoClienteEraEndereco = false

    // Pagamento: contexto ou keyword
    if (!resultado.pagamento) {
      const atendentePerguntouPagamento = ultimaAtendenteLow.includes('pagamento') || ultimaAtendenteLow.includes('pagar') ||
        ultimaAtendenteLow.includes('forma') || ultimaAtendenteLow.includes('dinheiro') || ultimaAtendenteLow.includes('pix')
      const pag = detectarPagamento(low)
      if (pag && (atendentePerguntouPagamento || true)) {
        resultado.pagamento = pag
        continue
      }
    }

    // Troco: contexto de pergunta de troco
    if (!resultado.troco) {
      const atendentePerguntouTroco = ultimaAtendenteLow.includes('troco') || ultimaAtendenteLow.includes('troca')
      if (atendentePerguntouTroco) {
        if (isNegacao(low) || low.includes('sem troco') || low.includes('nao precisa') || low.includes('nao tem')) {
          resultado.troco = 'Sem troco'
        } else {
          resultado.troco = txt
        }
        continue
      }
    }
  }

  // Se encontrou endereço/bairro, tipo padrão é delivery
  if (!resultado.tipoEntrega && (resultado.endereco || resultado.bairro)) {
    resultado.tipoEntrega = 'delivery'
  }

  return resultado
}
