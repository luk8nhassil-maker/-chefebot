'use client'
import { useEffect, useState } from 'react'
export default function AuditoriaRanking3() {
  const [dados, setDados] = useState<Record<string, unknown> | null>(null)
  const [erro, setErro] = useState('')
  async function carregar() {
    try {
      const resposta = await fetch('/api/dev/ranking3', { cache: 'no-store' })
      if (!resposta.ok) throw new Error()
      setDados(await resposta.json()); setErro('')
    } catch { setErro('Auditoria indisponível. Nenhum dado foi alterado.') }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void carregar() }, 0)
    return () => window.clearTimeout(timer)
  }, [])
  return <main style={{ maxWidth: 720, margin: 'auto', padding: 24 }}>
    <a href="/dev">← DEV</a><h1>Auditoria · Ranking 3</h1><p>Somente leitura. Não fecha temporadas, concede prêmios nem envia mensagens.</p>
    <button type="button" onClick={() => void carregar()}>Atualizar leitura</button>
    {erro && <p role="alert">{erro}</p>}
    {dados && <dl>{Object.entries(dados).map(([chave, valor]) => <div key={chave} style={{ padding: 8 }}><dt>{chave}</dt><dd style={{ overflowWrap: 'anywhere' }}>{typeof valor === 'object' ? JSON.stringify(valor) : String(valor)}</dd></div>)}</dl>}
  </main>
}
