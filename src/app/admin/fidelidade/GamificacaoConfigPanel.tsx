'use client'

import { useEffect, useState } from 'react'

type Config = {
  missaoSemanalAtiva: boolean
  missaoSemanalMultiplicador: number
  missaoSemanalCooldownDias: number
  missaoIndicacaoAtiva: boolean
  missaoIndicacaoBonus: number
  missaoFotoPerfilAtiva: boolean
  missaoFotoPerfilBonus: number
  missaoDivulgacaoDiariaAtiva: boolean
  missaoDivulgacaoDiariaBonus: number
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
    case 'divulgacao': return { missaoDivulgacaoDiariaAtiva: config.missaoDivulgacaoDiariaAtiva, missaoDivulgacaoDiariaBonus: config.missaoDivulgacaoDiariaBonus }
    case 'impulso': return { impulsoPodioAtivo: config.impulsoPodioAtivo, impulsoPodioBonus: config.impulsoPodioBonus, impulsoPodioCapTemporada: config.impulsoPodioCapTemporada }
    case 'carryover': return { carryoverAtivo: config.carryoverAtivo, carryoverTabela: config.carryoverTabela }
    case 'nivel': return { nivelChefAtivo: config.nivelChefAtivo, nivelChefLimiares: config.nivelChefLimiares }
  }
}

const caixa = { border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'grid', gap: 10 } as const
const campo = { display: 'grid', gap: 4, fontSize: 12, color: 'var(--foreground-secondary)' } as const
const entrada = { padding: '8px', borderRadius: 6, border: '1px solid var(--border)', maxWidth: 170 } as const

export default function GamificacaoConfigPanel() {
  const [config, setConfig] = useState<Config | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState<Grupo | null>(null)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    let cancelado = false
    fetch('/api/admin/ranking/gamificacao', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Config> })
      .then((dados) => { if (!cancelado) setConfig(dados) })
      .catch(() => { if (!cancelado) setAviso('Não foi possível carregar a configuração. Nenhuma alteração foi feita.') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [])

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
    return <label style={campo}>{titulo}<input style={entrada} type="number" min={min} max={max} step="1" value={Number.isFinite(valor) ? valor : ''}
      onChange={(e) => alterar(chave, e.target.value === '' ? NaN : Number(e.target.value))} /></label>
  }
  function alternar(chave: keyof Config, titulo: string, valor: boolean) {
    return <label style={{ fontSize: 13 }}><input type="checkbox" checked={valor} onChange={(e) => alterar(chave, e.target.checked)} /> {titulo}</label>
  }
  function botao(grupo: Grupo) {
    return <button type="button" disabled={!!salvando} onClick={() => salvar(grupo)} style={{ justifySelf: 'start', padding: '8px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 700, cursor: salvando ? 'wait' : 'pointer' }}>
      {salvando === grupo ? 'Salvando…' : 'Salvar este módulo'}
    </button>
  }

  return <section aria-label="Configuração da gamificação" style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 20 }}>
    <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Gamificação do Ranking</h2>
    <p style={{ fontSize: 12, color: 'var(--foreground-muted)', lineHeight: 1.5 }}>Mecânicas independentes. Desligadas permanecem invisíveis ao cliente e não concedem bônus. Defina valores aprovados antes de ativar; bônus de competição não são Estrelas da fidelidade.</p>
    {aviso && <p role="status" style={{ fontSize: 12, color: aviso.startsWith('Não') ? 'var(--danger, #dc2626)' : 'var(--foreground-secondary)' }}>{aviso}</p>}
    {carregando ? <p>Carregando…</p> : !config ? <button type="button" onClick={() => window.location.reload()}>Tentar novamente</button> : <fieldset disabled={!!salvando} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      <div style={caixa}>
        <strong>Caçada ao Pódio · próximo pedido 2x</strong>
        {alternar('missaoSemanalAtiva', 'Ativar missão semanal', config.missaoSemanalAtiva)}
        {numero('missaoSemanalCooldownDias', 'Intervalo em dias', config.missaoSemanalCooldownDias, 1, 90)}
        <small>Multiplicador fixo aprovado: {config.missaoSemanalMultiplicador}x no Ranking; Estrelas reais não dobram.</small>
        {botao('semanal')}
      </div>
      <div style={caixa}>
        <strong>Missão de indicação</strong>
        {alternar('missaoIndicacaoAtiva', 'Ativar bônus de competição', config.missaoIndicacaoAtiva)}
        {numero('missaoIndicacaoBonus', 'Bônus aprovado no Ranking', config.missaoIndicacaoBonus)}
        <small>Só após a primeira compra válida; não altera a indicação da fidelidade.</small>
        {botao('indicacao')}
      </div>
      <div style={caixa}>
        <strong>Missão de foto do perfil</strong>
        {alternar('missaoFotoPerfilAtiva', 'Ativar missão de foto', config.missaoFotoPerfilAtiva)}
        {numero('missaoFotoPerfilBonus', 'Pontos no Ranking', config.missaoFotoPerfilBonus)}
        <small>Bônus único por cliente. A foto só vira pública se o cliente autorizar essa finalidade no Ranking.</small>
        {botao('foto')}
      </div>
      <div style={caixa}>
        <strong>Embaixador do dia · divulgação orgânica</strong>
        {alternar('missaoDivulgacaoDiariaAtiva', 'Ativar missão diária de divulgação', config.missaoDivulgacaoDiariaAtiva)}
        {numero('missaoDivulgacaoDiariaBonus', 'Pontos no Ranking por dia', config.missaoDivulgacaoDiariaBonus)}
        <small>Credita no máximo 1x por expediente e somente quando o link do cliente traz uma pessoa sem pedido comercial anterior para o funil. Compartilhar sozinho não gera ponto.</small>
        {botao('divulgacao')}
      </div>
      <div style={caixa}>
        <strong>Impulso do Pódio</strong>
        {alternar('impulsoPodioAtivo', 'Ativar impulso', config.impulsoPodioAtivo)}
        {numero('impulsoPodioBonus', 'Bônus aprovado', config.impulsoPodioBonus)}
        {numero('impulsoPodioCapTemporada', 'Teto por temporada', config.impulsoPodioCapTemporada)}
        {botao('impulso')}
      </div>
      <div style={caixa}>
        <strong>Vantagem de largada · Top 10</strong>
        {alternar('carryoverAtivo', 'Ativar carryover', config.carryoverAtivo)}
        <small>Preencha as 10 posições em ordem estritamente decrescente antes de ativar.</small>
        {Array.from({ length: 10 }, (_, i) => {
          const posicao = i + 1
          const atual = config.carryoverTabela.find((item) => item.posicao === posicao)
          return <label key={posicao} style={campo}>#{posicao}<input style={entrada} type="number" min="0" step="1" value={atual?.bonus ?? ''} placeholder="Não configurado" onChange={(e) => {
            const tabela = config.carryoverTabela.filter((item) => item.posicao !== posicao)
            if (e.target.value !== '') tabela.push({ posicao, bonus: Number(e.target.value) })
            alterar('carryoverTabela', tabela.sort((a, b) => a.posicao - b.posicao))
          }} /></label>
        })}
        {botao('carryover')}
      </div>
      <div style={caixa}>
        <strong>Nível de Chef</strong>
        {alternar('nivelChefAtivo', 'Ativar progressão', config.nivelChefAtivo)}
        {config.nivelChefLimiares.map((item, index) => <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <label style={campo}>Nível<input style={{ ...entrada, maxWidth: 65 }} type="number" min="1" step="1" value={item.nivel} onChange={(e) => alterar('nivelChefLimiares', config.nivelChefLimiares.map((v, i) => i === index ? { ...v, nivel: Number(e.target.value) } : v))} /></label>
          <label style={campo}>Nome<input style={{ ...entrada, maxWidth: 110 }} maxLength={40} value={item.nome} onChange={(e) => alterar('nivelChefLimiares', config.nivelChefLimiares.map((v, i) => i === index ? { ...v, nome: e.target.value } : v))} /></label>
          <label style={campo}>XP mínimo<input style={{ ...entrada, maxWidth: 100 }} type="number" min="0" step="1" value={item.xpMinimo} onChange={(e) => alterar('nivelChefLimiares', config.nivelChefLimiares.map((v, i) => i === index ? { ...v, xpMinimo: Number(e.target.value) } : v))} /></label>
          <button type="button" aria-label={`Remover nível ${index + 1}`} onClick={() => alterar('nivelChefLimiares', config.nivelChefLimiares.filter((_, i) => i !== index))}>Remover</button>
        </div>)}
        <button type="button" onClick={() => alterar('nivelChefLimiares', [...config.nivelChefLimiares, { nivel: 0, nome: '', xpMinimo: 0 }])}>Adicionar nível</button>
        {botao('nivel')}
      </div>
      <div style={caixa}>
        <strong>Coroa ameaçada</strong>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-secondary)', lineHeight: 1.45 }}>
          Automática. Toda semana o sistema usa o ticket médio elegível da semana anterior completa,
          converte esse valor pela regra oficial de Estrelas e usa o resultado como distância de ameaça
          entre o líder e o #2. Sem dados válidos, a ameaça fica desligada.
        </p>
      </div>
    </fieldset>}
  </section>
}
