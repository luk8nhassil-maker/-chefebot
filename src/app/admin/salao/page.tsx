'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import PanelShell from '@/components/PanelShell'

const SALAO_LOGIN_URL = 'https://chefedapizza.com.br/salao/login'
const CODIGO_MIN_LENGTH = 4
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // sem O/0/I/1 — evita confusão ao digitar num tablet

// Nunca Math.random para o código do terminal (mesmo padrão já usado no
// projeto — ver src/app/admin/jornada-chef/page.tsx): crypto.getRandomValues.
function gerarCodigoAleatorio(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALFABETO_CODIGO[b % ALFABETO_CODIGO.length]
  return out
}

function formatarData(iso: string | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return ''
  }
}

const cardStyle: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }
const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--background)', border: '1px solid var(--surface-secondary)', borderRadius: 10,
  padding: '13px 14px', color: 'var(--foreground)', fontSize: 18, fontWeight: 800, letterSpacing: '2px',
  outline: 'none', boxSizing: 'border-box', minHeight: 50, fontFamily: "'Archivo', sans-serif",
}
const labelStyle: React.CSSProperties = { color: 'var(--foreground-secondary)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, display: 'block' }
const botaoPrimario: React.CSSProperties = { height: 46, padding: '0 18px', border: 'none', borderRadius: 12, background: 'var(--primary)', color: 'var(--primary-foreground)', fontSize: 14, fontWeight: 900, fontFamily: "'Archivo', sans-serif", cursor: 'pointer' }
const botaoSecundario: React.CSSProperties = { height: 46, padding: '0 18px', border: '1px solid var(--surface-secondary)', borderRadius: 12, background: 'transparent', color: 'var(--foreground-secondary)', fontSize: 14, fontWeight: 800, fontFamily: "'Archivo', sans-serif", cursor: 'pointer' }
const botaoDestrutivo: React.CSSProperties = { height: 46, padding: '0 18px', border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)', borderRadius: 12, background: 'transparent', color: 'var(--danger)', fontSize: 14, fontWeight: 900, fontFamily: "'Archivo', sans-serif", cursor: 'pointer' }

export default function AcessoDoSalaoPage() {
  const router = useRouter()

  const [carregando, setCarregando] = useState(true)
  const [erroCarregar, setErroCarregar] = useState(false)
  const [configurado, setConfigurado] = useState(false)
  const [atualizadoEm, setAtualizadoEm] = useState<string | undefined>(undefined)

  const [codigo, setCodigo] = useState('')
  const [codigoRecemSalvo, setCodigoRecemSalvo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroCodigo, setErroCodigo] = useState('')
  const [mensagemCodigo, setMensagemCodigo] = useState('')
  const salvandoRef = useRef(false)

  const [revogando, setRevogando] = useState(false)
  const [mensagemRevogar, setMensagemRevogar] = useState('')
  const revogandoRef = useRef(false)

  useEffect(() => {
    // A autorização de verdade é sempre do servidor (lerSessaoAdministrativa
    // + admin/dev, ver /api/admin/salao/config): um 401 real redireciona
    // para o login. Não há checagem de papel no cliente aqui — evita tanto
    // uma segunda fonte de verdade quanto qualquer mismatch de hidratação
    // entre o HTML gerado no servidor e a primeira renderização no cliente,
    // já que nada nesta página depende de cookies durante a renderização.
    fetch('/api/admin/salao/config')
      .then((r) => {
        if (r.status === 401) { router.push('/login?callbackUrl=/admin/salao'); return null }
        if (!r.ok) throw new Error('falha ao carregar')
        return r.json()
      })
      .then((data) => {
        if (data) {
          setConfigurado(!!data.configurado)
          setAtualizadoEm(data.atualizadoEm)
        }
      })
      .catch(() => setErroCarregar(true))
      .finally(() => setCarregando(false))
  }, [router])

  function gerarCodigo() {
    setCodigo(gerarCodigoAleatorio())
    setCodigoRecemSalvo(null)
    setCopiado(false)
    setErroCodigo('')
  }

  async function salvarCodigo() {
    if (salvandoRef.current) return
    const valor = codigo.trim()
    if (valor.length < CODIGO_MIN_LENGTH) {
      setErroCodigo(`O código precisa ter pelo menos ${CODIGO_MIN_LENGTH} caracteres.`)
      return
    }
    if (configurado) {
      const ok = window.confirm('Trocar o código de acesso do salão? Os terminais conectados precisarão informar o código novo — as sessões atuais serão encerradas.')
      if (!ok) return
    }
    salvandoRef.current = true
    setSalvando(true)
    setErroCodigo('')
    setMensagemCodigo('')
    try {
      const r = await fetch('/api/admin/salao/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: valor }),
      })
      if (r.status === 401) { router.push('/login?callbackUrl=/admin/salao'); return }
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data?.ok) {
        setErroCodigo(data?.error || 'Não foi possível salvar agora. Tente de novo.')
        return
      }
      setConfigurado(true)
      setAtualizadoEm(new Date().toISOString())
      setCodigoRecemSalvo(valor)
      setMensagemCodigo('Novo código configurado com sucesso.')
    } catch {
      setErroCodigo('Não foi possível salvar agora. Verifique a conexão e tente de novo.')
    } finally {
      salvandoRef.current = false
      setSalvando(false)
    }
  }

  async function copiarCodigo() {
    if (!codigoRecemSalvo) return
    try {
      await navigator.clipboard.writeText(codigoRecemSalvo)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2500)
    } catch {
      // Sem permissão de clipboard — o código continua visível na tela para copiar manualmente.
    }
  }

  async function revogarSessoes() {
    if (revogandoRef.current) return
    const ok = window.confirm('Revogar todas as sessões ativas do Salão? Os terminais precisarão informar o código novamente. Comandas e pedidos não são afetados.')
    if (!ok) return
    revogandoRef.current = true
    setRevogando(true)
    setMensagemRevogar('')
    try {
      const r = await fetch('/api/admin/salao/revogar', { method: 'POST' })
      if (r.status === 401) { router.push('/login?callbackUrl=/admin/salao'); return }
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data?.ok) {
        setMensagemRevogar('Não foi possível revogar agora. Tente de novo.')
        return
      }
      setMensagemRevogar('Sessões do salão revogadas. Os terminais precisarão informar o código novamente.')
    } catch {
      setMensagemRevogar('Não foi possível revogar agora. Verifique a conexão e tente de novo.')
    } finally {
      revogandoRef.current = false
      setRevogando(false)
    }
  }

  return (
    <PanelShell showGestaoNav>
      <div style={{ padding: 24, maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20, fontFamily: "'Archivo', sans-serif" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 900, color: 'var(--foreground)', margin: 0 }}>Acesso do salão</h1>
          <p style={{ fontSize: 13, color: 'var(--foreground-secondary)', margin: '4px 0 0' }}>
            Configure o código usado pelo terminal ou tablet do salão.
          </p>
        </div>

        {carregando ? (
          <div style={cardStyle}>
            <p style={{ color: 'var(--foreground-secondary)', fontSize: 13, margin: 0 }}>Carregando...</p>
          </div>
        ) : erroCarregar ? (
          <div style={cardStyle}>
            <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 700, margin: 0 }}>
              Não foi possível carregar. Recarregue a página e tente de novo.
            </p>
          </div>
        ) : (
          <>
            {/* Status */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 10, height: 10, borderRadius: 5, flexShrink: 0,
                    background: configurado ? 'var(--success)' : 'var(--foreground-muted)',
                  }}
                />
                <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--foreground)' }}>
                  {configurado ? 'Acesso configurado' : 'Acesso ainda não configurado'}
                </p>
              </div>
              {configurado && atualizadoEm && (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--foreground-muted)' }}>
                  Última alteração: {formatarData(atualizadoEm)}
                </p>
              )}
            </div>

            {/* Código */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--foreground)' }}>
                {configurado ? 'Trocar código de acesso' : 'Criar código de acesso'}
              </p>
              <div>
                <label style={labelStyle} htmlFor="salao-codigo">Código do terminal</label>
                <input
                  id="salao-codigo"
                  className="cbInput"
                  value={codigo}
                  onChange={(e) => { setCodigo(e.target.value); setCodigoRecemSalvo(null); setCopiado(false) }}
                  placeholder={`Mínimo ${CODIGO_MIN_LENGTH} caracteres`}
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
              {erroCodigo && (
                <p role="alert" style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--danger)' }}>{erroCodigo}</p>
              )}
              {mensagemCodigo && (
                <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--success)' }}>{mensagemCodigo}</p>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={gerarCodigo} style={botaoSecundario}>Gerar código</button>
                <button
                  type="button"
                  onClick={salvarCodigo}
                  disabled={salvando || codigo.trim().length < CODIGO_MIN_LENGTH}
                  style={{ ...botaoPrimario, opacity: salvando || codigo.trim().length < CODIGO_MIN_LENGTH ? 0.5 : 1 }}
                >
                  {salvando ? 'Salvando...' : 'Salvar código'}
                </button>
                {codigoRecemSalvo && (
                  <button type="button" onClick={copiarCodigo} style={botaoSecundario}>
                    {copiado ? 'Copiado!' : 'Copiar código'}
                  </button>
                )}
              </div>
              {codigoRecemSalvo && (
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>
                  Anote ou copie agora — por segurança, o código não fica visível depois de recarregar a página.
                </p>
              )}
              <a href={SALAO_LOGIN_URL} target="_blank" rel="noopener noreferrer" style={{ ...botaoSecundario, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', width: 'fit-content' }}>
                Abrir login do salão ↗
              </a>
            </div>

            {/* Dispositivos conectados */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--foreground)' }}>Dispositivos conectados</p>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--foreground-secondary)', lineHeight: 1.5 }}>
                Revogue o acesso dos terminais do salão. Eles precisarão informar o código novamente.
              </p>
              {mensagemRevogar && (
                <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: mensagemRevogar.startsWith('Sessões') ? 'var(--success)' : 'var(--danger)' }}>
                  {mensagemRevogar}
                </p>
              )}
              <button type="button" onClick={revogarSessoes} disabled={revogando} style={{ ...botaoDestrutivo, opacity: revogando ? 0.5 : 1, width: 'fit-content' }}>
                {revogando ? 'Revogando...' : 'Revogar sessões'}
              </button>
            </div>
          </>
        )}
      </div>
    </PanelShell>
  )
}
