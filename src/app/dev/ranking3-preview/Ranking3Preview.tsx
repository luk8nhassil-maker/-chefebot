'use client'
import { useState } from 'react'
import { Ranking3Experience, type PainelRanking3 } from '@/app/cliente/Ranking3Experience'

export default function Ranking3Preview() {
  const [liga, setLiga] = useState<1 | 2 | 3>(1)
  const [comPremio, setComPremio] = useState(false)
  const painel: PainelRanking3 = {
    atualizando: false, liga, posicao: liga === 3 ? null : 4, score: 12, meta: liga === 2 ? 20 : null,
    janela: { id: 'r3-2026-10-20-0', indice: 0, inicio: '2026-10-20T06:00:00.000Z', fim: '2026-11-19T06:00:00.000Z' },
    decisaoPendente: false, conquistaAnterior: null,
    lista: [{ posicao: 1, score: 30, eVoce: false }, { posicao: 4, score: 12, eVoce: true }],
    premios: comPremio ? [{ id: 'r3-2026-10-20-0-liga-1', temporadaId: 'r3-2026-10-20-0', liga: 1, tetoCents: 4700, concedidoEm: '2026-11-19T06:00:00.000Z', estado: 'disponivel', proximoAvisoEm: 0, revisao: 0, pedidoId: undefined }] : [],
  }
  return <main style={{ width: '100%', maxWidth: 540, margin: '0 auto', padding: 16 }}>
    <p role="status">AMBIENTE SINTÉTICO · sem clientes, Redis, Pix, WhatsApp ou pedidos reais</p>
    <label>Liga de demonstração <select value={liga} onChange={(e) => setLiga(Number(e.target.value) as 1 | 2 | 3)}><option value="1">Nível 1</option><option value="2">Nível 2</option><option value="3">Nível 3</option></select></label>
    <label style={{ display: 'block', padding: 12 }}><input type="checkbox" checked={comPremio} onChange={(e) => setComPremio(e.target.checked)} /> Demonstrar prêmio disponível</label>
    <Ranking3Experience painel={painel} onClose={() => { setLiga(1); setComPremio(false) }} previewSeguro />
  </main>
}
