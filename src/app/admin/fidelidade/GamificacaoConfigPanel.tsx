'use client'

import { useEffect, useMemo, useState } from 'react'

type Config = {
  missaoSemanalAtiva: boolean
  missaoSemanalMultiplicador: number
  missaoSemanalCooldownDias: number
  missaoIndicacaoAtiva: boolean
  missaoIndicacaoBonus: number
  missaoFotoPerfilAtiva: boolean
  missaoFotoPerfilBonus: number
  missaoDivulgacaoAtiva: boolean
  missaoDivulgacaoBonus: number
  impulsoPodioAtivo: boolean
  impulsoPodioBonus: number
  impulsoPodioCapTemporada: number
  carryoverAtivo: boolean
  carryoverTabela: { posicao: number; bonus: number }[]
  nivelChefAtivo: boolean
  nivelChefLimiares: { nivel: number; nome: string; xpMinimo: number }[]
  ameacaPodioMaxGap: number
}

type Grupo = 'semanal' | 'indicacao' | 'foto' | 'divulgacao' | 'impulso' | 'carryover' | 'nivel'

function camposDoGrupo(config: Config, grupo: Grupo): Partial<Config> {
  switch (grupo) {
    case 'semanal': return { missaoSemanalAtiva: config.missaoSemanalAtiva, missaoSemanalMultiplicador: config.missaoSemanalMultiplicador, missaoSemanalCooldownDias: config.missaoSemanalCooldownDias }
    case 'indicacao': return { missaoIndicacaoAtiva: config.missaoIndicacaoAtiva, missaoIndicacaoBonus: config.missaoIndicacaoBonus }
    case 'foto': return { missaoFotoPerfilAtiva: config.missaoFotoPerfilAtiva, missaoFotoPerfilBonus: config.missaoFotoPerfilBonus }
    case 'divulgacao': return { missaoDivulgacaoAtiva: config.missaoDivulgacaoAtiva, missaoDivulgacaoBonus: config.missaoDivulgacaoBonus }
    case 'impulso': return { impulsoPodioAtivo: config.impulsoPodioAtivo, impulsoPodioBonus: config.impulsoPodioBonus, impulsoPodioCapTemporada: config.impulsoPodioCapTemporada }
    case 'carryover': return { carryoverAtivo: config.carryoverAtivo, carryoverTabela: config.carryoverTabela }
    case 'nivel': return { nivelChefAtivo: config.nivelChefAtivo, nivelChefLimiares: config.nivelChefLimiares }
  }
}

const colors = {
  border: 'var(--border, #e5e7eb)',
  muted: 'var(--foreground-muted, #667085)',
  secondary: 'var(--foreground-secondary, #475467)',
  surface: 'var(--surface, #fff)',
  page: 'var(--background, #f8fafc)',
  yellow: '#f5c400',
  yellowSoft: '#fff8d6',
  green: '#137a4b',
}

const card: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 16,
  padding: 20,
  display: 'grid',
  gap: 14,
  background: colors.surface,
  minWidth: 0,
}

const field: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  color: colors.secondary,
}

const input: React.CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 44,
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: 'inherit',
  font: 'inherit',
  maxWidth: 220,
}

const primaryButton: React.CSSProperties = {
  minHeight: 44,
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid #d3a900',
  background: colors.yellow,
  color: '#161616',
  fontWeight: 700,
  cursor: 'pointer',
}

const secondaryButton: React.CSSProperties = {
  minHeight: 44,
  padding: '10px 14px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  color: 'inherit',
  fontWeight: 700,
  cursor: 'pointer',
}

export default function GamificacaoConfigPanel() {
  const [config, setConfig] = useState<Config | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<Grupo | null>(null)
  const [aviso, setAviso] = useState('')
  const [avancadoAberto, setAvancadoAberto] = useState(false)

  useEffect(() => {
    let cancelado = false
    fetch('/api/admin/ranking/gamificacao', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Config> })
      .then((dados) => { if (!cancelado) setConfig(dados) })
      .catch(() => { if (!cancelado) setAviso('Não foi possível carregar a configuração. Nenhuma alteração foi feita.') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [])

  const modulosAtivos = useMemo(() => {
    if (!config) return 0
    return [config.missaoSemanalAtiva, config.missaoIndicacaoAtiva, config.missaoFotoPerfilAtiva,
      config.missaoDivulgacaoAtiva, config.impulsoPodioAtivo, config.carryoverAtivo, config.nivelChefAtivo]
      .filter(Boolean).length
  }, [config])

  function alterar<K extends keyof Config>(chave: K, valor: Config[K]) {
    setConfig((atual) => atual ? { ...atual, [chave]: valor } : atual)
    setAviso('')
  }

  async function salvar(grupo: Grupo) {
    if (!config || salvando) return
    setSalvando(grupo)
    setAviso('')
    try {
      // A API aceita patch parcial: editar uma mecânica não regrava as demais.
      const r = await fetch('/api/admin/ranking/gamificacao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(camposDoGrupo(config, grupo)),
      })
      const dados = await r.json()
      if (!r.ok || !dados.ok) throw new Error(dados.detalhes?.join('; ') || dados.error || `HTTP ${r.status}`)
      // Não descartar edições ainda não salvas em outros módulos enquanto a
      // requisição estava em trânsito.
      setConfig((atual) => atual ? { ...atual, ...camposDoGrupo(dados.config, grupo) } : dados.config)
      setAviso('Configuração salva. Os demais módulos não foram alterados.')
    } catch (e) {
      setAviso(`Não foi salvo: ${e instanceof Error ? e.message : 'erro desconhecido'}`)
    } finally {
      setSalvando(null)
    }
  }

  function numero(chave: keyof Config, titulo: string, valor: number, min = 0, max?: number) {
    return <label style={field}>{titulo}<input style={input} type="number" min={min} max={max} step="1" value={Number.isFinite(valor) ? valor : ''}
      onChange={(e) => alterar(chave, e.target.value === '' ? NaN : Number(e.target.value))} /></label>
  }

  function alternar(chave: keyof Config, titulo: string, valor: boolean) {
    return <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 13, fontWeight: 600, color: '#1d2939' }}><input type="checkbox" checked={valor} onChange={(e) => alterar(chave, e.target.checked)} /> {titulo}</label>
  }

  function botao(grupo: Grupo) {
    return <button type="button" disabled={!!salvando} onClick={() => salvar(grupo)} style={{ ...primaryButton, justifySelf: 'start', opacity: salvando && salvando !== grupo ? 0.6 : 1, cursor: salvando ? 'wait' : 'pointer' }}>
      {salvando === grupo ? 'Salvando…' : 'Salvar este módulo'}
    </button>
  }

  return <section aria-label="Configuração da gamificação" style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: colors.page, padding: '28px 24px', display: 'grid', gap: 24, fontFamily: "'Archivo', system-ui, sans-serif" }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <span style={{ color: colors.muted, fontSize: 11, letterSpacing: '0.12em', fontWeight: 800 }}>RANKING</span>
        <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: '-0.02em' }}>Gamificação</h2>
        <p style={{ margin: 0, maxWidth: 650, fontSize: 14, color: colors.secondary, lineHeight: 1.55 }}>Missões e vantagens para incentivar novas compras. As regras atuais continuam as mesmas; esta tela só ficou mais simples de acompanhar.</p>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 32, padding: '0 12px', borderRadius: 999, background: colors.yellowSoft, color: '#735b00', fontSize: 12, fontWeight: 800 }}>● Em observação</span>
    </header>

    {aviso && <p role="status" style={{ margin: 0, padding: '12px 14px', borderRadius: 10, background: aviso.startsWith('Não') ? '#fff1f0' : '#eefaf4', color: aviso.startsWith('Não') ? '#b42318' : colors.green, fontSize: 13 }}>{aviso}</p>}

    {carregando ? <p style={{ margin: 0, color: colors.muted }}>Carregando…</p> : !config ? <button type="button" onClick={() => window.location.reload()} style={secondaryButton}>Tentar novamente</button> : <>
      <div style={{ ...card, background: '#111827', color: '#fff', borderColor: '#111827', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Automação de vendas</h3>
            <p style={{ margin: 0, maxWidth: 640, color: '#d0d5dd', fontSize: 13, lineHeight: 1.5 }}>O robô está em modo seguro: observa os dados e não ativa promoções pagas sozinho. Assim nenhuma missão gera gasto sem regra e limite aprovados.</p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 30, padding: '0 11px', borderRadius: 999, background: '#344054', color: '#f2f4f7', fontSize: 12, fontWeight: 800 }}>Sem gasto automático</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div style={{ padding: 14, borderRadius: 12, background: '#1d2939' }}><strong style={{ display: 'block', fontSize: 22 }}>{modulosAtivos}</strong><span style={{ color: '#d0d5dd', fontSize: 12 }}>módulos ativos</span></div>
          <div style={{ padding: 14, borderRadius: 12, background: '#1d2939' }}><strong style={{ display: 'block', fontSize: 22 }}>{config.carryoverTabela.length}/10</strong><span style={{ color: '#d0d5dd', fontSize: 12 }}>posições do Top 10</span></div>
          <div style={{ padding: 14, borderRadius: 12, background: '#1d2939' }}><strong style={{ display: 'block', fontSize: 22 }}>0</strong><span style={{ color: '#d0d5dd', fontSize: 12 }}>regras pagas automáticas</span></div>
        </div>
        <button type="button" onClick={() => setAvancadoAberto((aberto) => !aberto)} style={{ ...secondaryButton, justifySelf: 'start', background: '#fff', color: '#111827' }}>{avancadoAberto ? 'Esconder configurações' : 'Abrir configurações avançadas'}</button>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
          <div><h3 style={{ margin: 0, fontSize: 18 }}>Regras do Ranking</h3><p style={{ margin: '6px 0 0', color: colors.muted, fontSize: 13 }}>Cada grupo fica separado para você encontrar tudo rápido.</p></div>
          <span style={{ color: colors.muted, fontSize: 12 }}>{modulosAtivos} de 7 módulos ativos</span>
        </div>
        <details open={avancadoAberto} onToggle={(e) => setAvancadoAberto((e.currentTarget as HTMLDetailsElement).open)} style={{ display: 'grid', gap: 16 }}>
          <summary style={{ cursor: 'pointer', color: colors.secondary, fontSize: 13, fontWeight: 700, minHeight: 28, display: 'flex', alignItems: 'center' }}>Configuração avançada (compatível com as regras atuais)</summary>
          <fieldset disabled={!!salvando} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Caçada ao Pódio · próximo pedido 2x</strong>
              {alternar('missaoSemanalAtiva', 'Ativar missão semanal', config.missaoSemanalAtiva)}
              {numero('missaoSemanalCooldownDias', 'Intervalo em dias', config.missaoSemanalCooldownDias, 1, 90)}
              <small style={{ color: colors.muted, lineHeight: 1.5 }}>Multiplicador fixo aprovado: {config.missaoSemanalMultiplicador}x no Ranking; Estrelas reais não dobram.</small>
              {botao('semanal')}
            </div>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Missão de indicação</strong>
              {alternar('missaoIndicacaoAtiva', 'Ativar bônus de competição', config.missaoIndicacaoAtiva)}
              {numero('missaoIndicacaoBonus', 'Bônus aprovado no Ranking', config.missaoIndicacaoBonus)}
              <small style={{ color: colors.muted, lineHeight: 1.5 }}>Só após a primeira compra válida; não altera a indicação da fidelidade.</small>
              {botao('indicacao')}
            </div>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Missão de foto do perfil</strong>
              {alternar('missaoFotoPerfilAtiva', 'Ativar missão de foto', config.missaoFotoPerfilAtiva)}
              {numero('missaoFotoPerfilBonus', 'Pontos no Ranking', config.missaoFotoPerfilBonus)}
              <small style={{ color: colors.muted, lineHeight: 1.5 }}>Bônus único por cliente. A foto só vira pública se o cliente autorizar essa finalidade no Ranking.</small>
              {botao('foto')}
            </div>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Story do Dia · divulgação orgânica</strong>
              {alternar('missaoDivulgacaoAtiva', 'Ativar missão diária', config.missaoDivulgacaoAtiva)}
              {numero('missaoDivulgacaoBonus', 'Pontos no Ranking por dia', config.missaoDivulgacaoBonus, 0, 100000)}
              <small style={{ color: colors.muted, lineHeight: 1.5 }}>O bônus só é confirmado quando outra pessoa abre o link rastreado. Máximo de 1 bônus por expediente.</small>
              {botao('divulgacao')}
            </div>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Impulso do Pódio</strong>
              {alternar('impulsoPodioAtivo', 'Ativar impulso', config.impulsoPodioAtivo)}
              {numero('impulsoPodioBonus', 'Bônus aprovado', config.impulsoPodioBonus)}
              {numero('impulsoPodioCapTemporada', 'Teto por temporada', config.impulsoPodioCapTemporada)}
              {botao('impulso')}
            </div>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Vantagem de largada · Top 10</strong>
              {alternar('carryoverAtivo', 'Ativar carryover', config.carryoverAtivo)}
              <small style={{ color: colors.muted, lineHeight: 1.5 }}>Preencha as 10 posições em ordem estritamente decrescente antes de ativar.</small>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {Array.from({ length: 10 }, (_, i) => {
                  const posicao = i + 1
                  const atual = config.carryoverTabela.find((item) => item.posicao === posicao)
                  return <label key={posicao} style={field}>#{posicao}<input style={{ ...input, maxWidth: 'none' }} type="number" min="0" step="1" value={atual?.bonus ?? ''} placeholder="Não configurado" onChange={(e) => {
                    const tabela = config.carryoverTabela.filter((item) => item.posicao !== posicao)
                    if (e.target.value !== '') tabela.push({ posicao, bonus: Number(e.target.value) })
                    alterar('carryoverTabela', tabela.sort((a, b) => a.posicao - b.posicao))
                  }} /></label>
                })}
              </div>
              {botao('carryover')}
            </div>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Nível de Chef</strong>
              {alternar('nivelChefAtivo', 'Ativar progressão', config.nivelChefAtivo)}
              {config.nivelChefLimiares.map((item, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '70px minmax(100px, 1fr) 100px auto', alignItems: 'end', gap: 8 }}>
                <label style={field}>Nível<input style={{ ...input, maxWidth: 70 }} type="number" min="1" step="1" value={item.nivel} onChange={(e) => alterar('nivelChefLimiares', config.nivelChefLimiares.map((v, i) => i === index ? { ...v, nivel: Number(e.target.value) } : v))} /></label>
                <label style={field}>Nome<input style={{ ...input, maxWidth: 'none' }} maxLength={40} value={item.nome} onChange={(e) => alterar('nivelChefLimiares', config.nivelChefLimiares.map((v, i) => i === index ? { ...v, nome: e.target.value } : v))} /></label>
                <label style={field}>XP mínimo<input style={{ ...input, maxWidth: 100 }} type="number" min="0" step="1" value={item.xpMinimo} onChange={(e) => alterar('nivelChefLimiares', config.nivelChefLimiares.map((v, i) => i === index ? { ...v, xpMinimo: Number(e.target.value) } : v))} /></label>
                <button type="button" aria-label={`Remover nível ${index + 1}`} onClick={() => alterar('nivelChefLimiares', config.nivelChefLimiares.filter((_, i) => i !== index))} style={secondaryButton}>Remover</button>
              </div>)}
              <button type="button" onClick={() => alterar('nivelChefLimiares', [...config.nivelChefLimiares, { nivel: 0, nome: '', xpMinimo: 0 }])} style={{ ...secondaryButton, justifySelf: 'start' }}>Adicionar nível</button>
              {botao('nivel')}
            </div>
            <div style={card}>
              <strong style={{ fontSize: 16 }}>Coroa ameaçada</strong>
              <p style={{ margin: 0, fontSize: 13, color: colors.secondary, lineHeight: 1.55 }}>Automática. Toda semana o sistema usa o ticket médio elegível da semana anterior completa. Sem dados válidos, a ameaça fica desligada.</p>
              <span style={{ color: colors.muted, fontSize: 12 }}>Nenhum preenchimento manual necessário.</span>
            </div>
          </fieldset>
        </details>
      </div>
    </>}
  </section>
}
