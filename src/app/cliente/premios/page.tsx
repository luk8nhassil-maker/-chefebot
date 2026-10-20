'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchCliente } from '@/lib/clienteSessaoFront'
import { PREMIO_CARRINHO } from '@/lib/ranking3/cart'
import { gerarClientRequestId } from '@/survival/clientRequestId'
import type { Premio } from '@/lib/ranking3/domain'

type PremioPublico = Omit<Premio, 'clienteId' | 'tentativaId'> & { sabores: { id: string; nome: string }[] }
export default function PremiosPage() {
  const router = useRouter()
  const [premios, setPremios] = useState<PremioPublico[] | null>(null)
  const [erro, setErro] = useState('')
  const [login, setLogin] = useState(false)
  const [escolhas, setEscolhas] = useState<Record<string, string[]>>({})
  useEffect(() => {
    let ativo = true
    void fetchCliente('/api/cliente/ranking3', { cache: 'no-store' }).then(async (res) => {
      if (!ativo) return
      if (res.status === 401) { setLogin(true); return }
      if (!res.ok) throw new Error('Não foi possível carregar os prêmios. Tente novamente mais tarde.')
      const dados = await res.json()
      if (ativo) setPremios(dados.premios)
    }).catch(() => { if (ativo) setErro('Não foi possível carregar os prêmios. Seus direitos estão preservados.') })
    return () => { ativo = false }
  }, [])
  function continuar(premio: PremioPublico) {
    const flavorIds = escolhas[premio.id] ?? []
    if (!flavorIds.length || flavorIds.length > 2) return
    try {
      localStorage.setItem(PREMIO_CARRINHO, JSON.stringify({ id: premio.id, selecao: { sizeId: 'size-f', flavorIds }, clientRequestId: gerarClientRequestId() }))
      router.push('/cardapio')
    } catch { setErro('Seu navegador não permitiu guardar a seleção. O prêmio continua disponível.') }
  }
  return <main className="ranking3-wallet" style={{ width: '100%', maxWidth: 540, padding: 24, margin: '0 auto' }}>
    <style>{`.ranking3-wallet h1{font-size:26px;font-weight:800;margin:20px 0 12px}.ranking3-wallet h2{font-size:20px;font-weight:750;margin:0 0 12px}.ranking3-wallet p{line-height:1.5;margin:12px 0}.ranking3-wallet button{min-height:44px;width:100%;padding:12px 16px;border-radius:12px;background:var(--brand,#ffcd00);color:#1f2937;font-weight:800;margin-top:12px}.ranking3-wallet button:disabled{opacity:.5}.ranking3-wallet a{display:inline-block;min-height:44px;padding:10px 0}`}</style>
    <a href="/cliente">← Minha área</a><h1>Meus prêmios</h1>
    <p>Pizza Família grátis. Seu prêmio não vence. Escolha até dois sabores e finalize no site. Extras são opcionais e pagos normalmente.</p>
    {login ? <a href="/cliente?next=%2Fcliente%2Fpremios">Entrar para ver meus prêmios</a> : erro ? <p role="alert">{erro}</p> : premios === null ? <p role="status">Carregando…</p> : !premios.length ? <p>Você ainda não tem prêmio nesta carteira. Seus prêmios anteriores continuam na área original.</p> : premios.map((premio) => <article key={premio.id} style={{ border: '1px solid #888', borderRadius: 16, padding: 18, marginTop: 18 }}>
      <h2>🎁 Pizza Família · Nível {premio.liga}</h2>
      <p>Temporada {premio.temporadaId} · {premio.estado === 'associado' ? 'Pedido associado — não faça outro resgate' : premio.estado.replaceAll('_', ' ')}</p>
      {premio.estado === 'disponivel' && (premio.sabores.length ? <>
        <fieldset><legend>Escolha um ou dois sabores</legend>{premio.sabores.map((sabor) => {
          const ids = escolhas[premio.id] ?? []
          return <label key={sabor.id} style={{ display: 'block', padding: 12 }}><input type="checkbox" checked={ids.includes(sabor.id)} disabled={!ids.includes(sabor.id) && ids.length === 2} onChange={(e) => setEscolhas({ ...escolhas, [premio.id]: e.target.checked ? [...ids, sabor.id] : ids.filter((id) => id !== sabor.id) })} /> {sabor.nome}</label>
        })}</fieldset>
        <button type="button" disabled={!escolhas[premio.id]?.length} onClick={() => continuar(premio)}>Continuar para o checkout</button>
      </> : <p>Nenhum sabor elegível disponível agora. Seu direito permanece guardado, sem vencimento.</p>)}
    </article>)}
  </main>
}
