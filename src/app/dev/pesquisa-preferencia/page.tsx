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
    ocasioesCompraObservadas: number
    clientesObservados: number
    intervalosEntreComprasObservados: number
    intervalosEntreOcasioesObservados: number
    clientesComHistoricoSuficienteParaQueda: number
    clientesSemHistoricoSuficienteParaQueda: number
    primeiraCompraObservadaNaoEquivaleAPrimeiraCompraVitalicia: true
  }
  segmentacaoQueda: {
    minimoOcasioesParaCompararRitmo: number
    minimoIntervalosHistoricosPorCliente: number
    regra: string
  }
  calibracao: {
    medianaIntervaloDias: number | null
    p75IntervaloDias: number | null
    p90IntervaloDias: number | null
    origemDosLimiares: string
  }
  estadosAtuais: Record<string, number>
  momentos: Record<string, MomentoResumo>
  primeiroEnvioM5: {
    candidatosComportamentais: number
    candidatosSemBloqueioAutomatico: number
    prontoParaConfirmacaoManual: boolean
    candidateRef: string | null
    identidadeMascarada: string | null
    pergunta: string | null
    envioLiberadoNestaVersao: boolean
  }
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
  const [confirmouCheckout, setConfirmouCheckout] = useState(false)
  const [confirmouDisputa, setConfirmouDisputa] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultadoEnvio, setResultadoEnvio] = useState<string | null>(null)

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
    const papel = getUserRole()
    if (papel !== 'admin' && papel !== 'dev') {
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

  const enviarPrimeiroM5 = async () => {
    const candidato = data?.primeiroEnvioM5
    if (getUserRole() !== 'admin') {
      setResultadoEnvio('Somente admin pode executar o primeiro envio.')
      return
    }
    if (
      !candidato?.candidateRef ||
      !candidato.prontoParaConfirmacaoManual ||
      !candidato.envioLiberadoNestaVersao ||
      !confirmouCheckout ||
      !confirmouDisputa
    ) return

    setEnviando(true)
    setResultadoEnvio(null)
    try {
      const res = await fetch('/api/admin/pesquisa-preferencia/envio-controlado', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          candidateRef: candidato.candidateRef,
          checkoutWebEmAndamento: false,
          disputaOuEstornoExternoAberto: false,
          confirmacao: 'ENVIAR_PESQUISA_CONTROLADA',
        }),
      })
      const body = await res.json()
      if (!res.ok || body?.ok !== true) {
        throw new Error(body?.error || body?.resultado?.status || `HTTP ${res.status}`)
      }
      setResultadoEnvio('Primeiro envio M5 confirmado pelo servidor.')
      setConfirmouCheckout(false)
      setConfirmouDisputa(false)
      buscar()
    } catch (e) {
      setResultadoEnvio(
        e instanceof Error ? `Envio não realizado: ${e.message}` : 'Envio não realizado.'
      )
    } finally {
      setEnviando(false)
    }
  }

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

            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontWeight: 800, color: 'var(--foreground)' }}>Primeiro envio controlado · M5</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.5 }}>
                    O servidor escolhe o candidato. Identidade e momento não podem ser digitados manualmente.
                  </p>
                </div>
                <span style={{ borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 800, background: data.primeiroEnvioM5.envioLiberadoNestaVersao ? 'var(--success-soft)' : 'var(--attention-soft)', color: data.primeiroEnvioM5.envioLiberadoNestaVersao ? 'var(--success)' : 'var(--attention)' }}>
                  {data.primeiroEnvioM5.envioLiberadoNestaVersao ? 'LIBERADO NESTA VERSÃO' : 'TRAVADO NESTA VERSÃO'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 14 }}>
                <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--foreground-secondary)' }}>M5 comportamental</p>
                  <strong style={{ fontSize: 22 }}>{data.primeiroEnvioM5.candidatosComportamentais}</strong>
                </div>
                <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--foreground-secondary)' }}>Sem bloqueio automático</p>
                  <strong style={{ fontSize: 22 }}>{data.primeiroEnvioM5.candidatosSemBloqueioAutomatico}</strong>
                </div>
              </div>

              {data.primeiroEnvioM5.candidateRef ? (
                <>
                  <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'var(--surface-secondary)' }}>
                    <p style={{ margin: '0 0 5px', fontSize: 11, color: 'var(--foreground-secondary)' }}>Candidato selecionado</p>
                    <strong style={{ color: 'var(--foreground)' }}>{data.primeiroEnvioM5.identidadeMascarada ?? 'Identidade protegida'}</strong>
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.55 }}>
                      Pergunta: {data.primeiroEnvioM5.pergunta ?? 'Instrumento M5 indisponível'}
                    </p>
                  </div>

                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, fontSize: 12, color: 'var(--foreground-secondary)' }}>
                    <input type="checkbox" checked={confirmouCheckout} onChange={(e) => setConfirmouCheckout(e.target.checked)} />
                    Confirmei que este cliente não está com checkout web em andamento.
                  </label>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8, fontSize: 12, color: 'var(--foreground-secondary)' }}>
                    <input type="checkbox" checked={confirmouDisputa} onChange={(e) => setConfirmouDisputa(e.target.checked)} />
                    Confirmei que não existe disputa ou estorno externo aberto para este cliente.
                  </label>

                  <button
                    onClick={enviarPrimeiroM5}
                    disabled={
                      !data.primeiroEnvioM5.envioLiberadoNestaVersao ||
                      !data.primeiroEnvioM5.prontoParaConfirmacaoManual ||
                      !confirmouCheckout ||
                      !confirmouDisputa ||
                      enviando
                    }
                    style={{
                      marginTop: 14,
                      border: '1px solid var(--border)',
                      background: data.primeiroEnvioM5.envioLiberadoNestaVersao ? 'var(--foreground)' : 'var(--surface-secondary)',
                      color: data.primeiroEnvioM5.envioLiberadoNestaVersao ? 'var(--background)' : 'var(--foreground-muted)',
                      borderRadius: 9,
                      padding: '10px 14px',
                      fontWeight: 800,
                      cursor: data.primeiroEnvioM5.envioLiberadoNestaVersao ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {enviando ? 'Validando e enviando…' : 'Enviar primeira pesquisa M5'}
                  </button>
                </>
              ) : (
                <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--foreground-secondary)' }}>
                  Nenhum M5 está pronto para confirmação manual neste momento.
                </p>
              )}

              <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--foreground-muted)' }}>
                O painel pode ser observado por admin/dev, mas somente admin pode executar o envio.
              </p>
              {resultadoEnvio && (
                <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--foreground-secondary)' }}>{resultadoEnvio}</p>
              )}
            </div>

            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--foreground-secondary)', margin: '0 0 10px' }}>Cobertura observada</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Pedidos válidos</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.pedidosValidosObservados}</strong>
              </div>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Ocasiões de compra</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.ocasioesCompraObservadas}</strong>
              </div>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Clientes observados</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.clientesObservados}</strong>
              </div>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Intervalos entre ocasiões</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.intervalosEntreOcasioesObservados}</strong>
              </div>
            </div>

            <h2 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--foreground-secondary)', margin: '0 0 10px' }}>Qualidade do histórico para queda</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Histórico suficiente</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.clientesComHistoricoSuficienteParaQueda}</strong>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--foreground-muted)' }}>
                  {data.segmentacaoQueda.minimoOcasioesParaCompararRitmo}+ ocasiões observadas
                </p>
              </div>
              <div style={card}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)' }}>Histórico insuficiente</p>
                <strong style={{ fontSize: 26, color: 'var(--foreground)' }}>{data.cobertura.clientesSemHistoricoSuficienteParaQueda}</strong>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--foreground-muted)' }}>
                  Não entram em M5/S6
                </p>
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
              Primeira/segunda compra significam ocasiões observadas no histórico analítico disponível, não necessariamente na vida inteira do cliente. M5/S6 exigem histórico suficiente do próprio cliente.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
