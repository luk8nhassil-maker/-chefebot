'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type MomentoResumo = {
  id: string
  nome: string
  tipo: string
  quantidade: number
  perguntaPrincipal: string | null
  objetivo: string
  calculavelComAnalytics: boolean
}

type DryRunResponse = {
  ok: boolean
  modo: 'dry-run'
  periodoDias: number
  janela: {
    inicioIso: string
    fimIso: string
    primeiroEventoObservadoIso: string | null
    ultimoEventoObservadoIso: string | null
  }
  cobertura: {
    pedidosValidosObservados: number
    clientesObservados: number
    intervalosEntreComprasObservados: number
    primeiraCompraObservadaNaoEquivaleAPrimeiraCompraVitalicia: true
  }
  calibracao: {
    medianaIntervaloDias: number | null
    p75IntervaloDias: number | null
    p90IntervaloDias: number | null
    origemDosLimiares: string
  }
  estadosAtuais: Record<string, number>
  momentos: Record<string, MomentoResumo>
  segurancaContato: {
    envioAutomaticoAtivo: false
    elegibilidadeFinalCalculada: false
    candidatosComportamentaisNaoSaoElegiveisFinais: true
    motivo: string
    politica: {
      cooldownDias: number
      maxContatosEm90Dias: number
    }
    fontesPendentes: string[]
  }
  observacoes: string[]
}

function getUserRole(): string | null {
  if (typeof document === 'undefined') return null
  try {
    for (const cookie of document.cookie.split(';')) {
      const trimmed = cookie.trim()
      if (!trimmed.startsWith('auth-user=')) continue
      const raw = trimmed.substring('auth-user='.length)
      let decoded = raw
      try { decoded = decodeURIComponent(raw) } catch { decoded = raw }
      if (decoded.startsWith('%7B')) {
        try { decoded = decodeURIComponent(decoded) } catch {}
      }
      const user = JSON.parse(decoded)
      return user?.role ?? null
    }
  } catch {
    return null
  }
  return null
}

function formatarDias(valor: number | null): string {
  if (valor === null) return 'Sem dados suficientes'
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} dias`
}

const card = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
}

export default function PesquisaPreferenciaDevPage() {
  const router = useRouter()
  const [data, setData] = useState<DryRunResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const buscar = useCallback(() => {
    fetch('/api/admin/pesquisa-preferencia/dry-run', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((body) => setData(body))
      .catch((e) => setErro(e instanceof Error ? e.message : 'Falha desconhecida'))
      .finally(() => setLoading(false))
  }, [])

  const atualizar = () => {
    setLoading(true)
    setErro(null)
    buscar()
  }

  useEffect(() => {
    const role = getUserRole()
    if (role !== 'admin' && role !== 'dev') {
      router.push('/login?callbackUrl=/dev/pesquisa-preferencia')
      return
    }
    buscar()
  }, [buscar, router])

  const primeiraOnda: MomentoResumo[] = data
    ? ['M1', 'M2', 'M5']
        .map((id) => data.momentos[id])
        .filter((momento): momento is MomentoResumo => Boolean(momento))
    : []

  const estadosVisiveis = data
    ? ['S1', 'S2', 'S4', 'S5', 'S6'].map((id) => ({ id, quantidade: data.estadosAtuais[id] ?? 0 }))
    : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', padding: '24px 16px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <h1 style={{ margin: 0, fontSize: 24, color: 'var(--foreground)' }}>Motor de Preferência</h1>
              <span style={{ borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 800, background: 'var(--attention-soft)', color: 'var(--attention)' }}>
                DRY-RUN · SEM ENVIO
              </span>
            </div>
            <p style={{ margin: 0, color: 'var(--foreground-secondary)', fontSize: 13, lineHeight: 1.5 }}>
              Painel interno somente leitura. Mostra candidatos comportamentais, calibração e gates. Não envia pesquisa e não grava resposta.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={atualizar} disabled={loading} style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--foreground)', borderRadius: 9, padding: '9px 14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Atualizando…' : 'Atualizar'}
            </button>
            <button onClick={() => router.push('/dev')} style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--foreground-secondary)', borderRadius: 9, padding: '9px 14px', cursor: 'pointer' }}>
              Voltar
            </button>
          </div>
        </div>

        {erro && (
          <div style={{ ...card, borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 16 }}>
            Não foi possível carregar o dry-run: {erro}
          </div>
        )}

        {loading && !data && (
          <div style={{ ...card, color: 'var(--foreground-secondary)' }}>Carregando dados agregados…</div>
        )}

        {data && (
          <>
            <div style={{ ...card, marginBottom: 16, background: 'var(--attention-soft)' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 800, color: 'var(--attention)' }}>Contato real permanece bloqueado</p>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--foreground-secondary)', lineHeight: 1.55 }}>
                {data.segurancaContato.motivo}
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--foreground-secondary)' }}>
                Política preparada: 1 contato a cada {data.segurancaContato.politica.cooldownDias} dias e no máximo {data.segurancaContato.politica.maxContatosEm90Dias} em 90 dias.
              </p>
            </div>

            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--foreground-secondary)', margin: '0 0 10px' }}>Cobertura observada</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Pedidos válidos</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.pedidosValidosObservados}</strong>
              </div>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Clientes observados</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.clientesObservados}</strong>
              </div>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Intervalos observados</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.intervalosEntreComprasObservados}</strong>
              </div>
            </div>

            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--foreground-secondary)', margin: '0 0 10px' }}>Calibração pelo histórico</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
              <div style={card}><p style={{ margin: '0 0 5px', fontSize: 12, color: 'var(--foreground-secondary)' }}>Mediana</p><strong>{formatarDias(data.calibracao.medianaIntervaloDias)}</strong></div>
              <div style={card}><p style={{ margin: '0 0 5px', fontSize: 12, color: 'var(--foreground-secondary)' }}>P75</p><strong>{formatarDias(data.calibracao.p75IntervaloDias)}</strong></div>
              <div style={card}><p style={{ margin: '0 0 5px', fontSize: 12, color: 'var(--foreground-secondary)' }}>P90</p><strong>{formatarDias(data.calibracao.p90IntervaloDias)}</strong></div>
            </div>

            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--foreground-secondary)', margin: '0 0 10px' }}>Primeira onda · candidatos comportamentais</h2>
            <p style={{ fontSize: 12, color: 'var(--foreground-secondary)', margin: '-4px 0 10px' }}>
              Estes números não autorizam contato. São somente candidatos derivados do comportamento observado.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginBottom: 20 }}>
              {primeiraOnda.map((momento) => (
                <div key={momento.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <strong style={{ color: 'var(--foreground)' }}>{momento.id} · {momento.nome}</strong>
                    <span style={{ fontSize: 22, fontWeight: 800 }}>{momento.quantidade}</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.5, margin: '8px 0 0' }}>{momento.objetivo}</p>
                </div>
              ))}
            </div>

            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--foreground-secondary)', margin: '0 0 10px' }}>Estados atuais observados</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
              {estadosVisiveis.map((estado) => (
                <div key={estado.id} style={card}>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>{estado.id}</p>
                  <strong style={{ fontSize: 24 }}>{estado.quantidade}</strong>
                </div>
              ))}
            </div>

            <div style={card}>
              <p style={{ margin: '0 0 8px', fontWeight: 800, color: 'var(--foreground)' }}>Fontes que ainda faltam antes de qualquer piloto</p>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--foreground-secondary)', fontSize: 13, lineHeight: 1.7 }}>
                {data.segurancaContato.fontesPendentes.map((fonte) => <li key={fonte}>{fonte.split('_').join(' ')}</li>)}
              </ul>
            </div>

            <p style={{ margin: '18px 0 0', color: 'var(--foreground-muted)', fontSize: 11, textAlign: 'center' }}>
              Primeira/segunda compra significam ocorrências observadas no histórico analítico disponível, não necessariamente na vida inteira do cliente.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
