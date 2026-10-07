// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import GamificacaoConfigPanel from './GamificacaoConfigPanel'

const inicial = {
  missaoSemanalAtiva: false, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7,
  missaoIndicacaoAtiva: false, missaoIndicacaoBonus: 0,
  missaoFotoPerfilAtiva: false, missaoFotoPerfilBonus: 0,
  impulsoPodioAtivo: false, impulsoPodioBonus: 0, impulsoPodioCapTemporada: 0,
  carryoverAtivo: false, carryoverTabela: [],
  nivelChefAtivo: false, nivelChefLimiares: [], ameacaPodioMaxGap: 0,
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('admin da gamificação', () => {
  test('somente leitura ao abrir: nunca ativa mecânica automaticamente', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => inicial })
    vi.stubGlobal('fetch', fetch)
    render(<GamificacaoConfigPanel />)
    expect(await screen.findByText('Caçada ao Pódio · próximo pedido 2x')).toBeTruthy()
    expect((screen.getByLabelText('Ativar missão semanal') as HTMLInputElement).checked).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toEqual({ cache: 'no-store' })
  })

  test('salvar missão envia somente seus campos; não altera indicação, Pix ou fidelidade', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => inicial })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, config: { ...inicial, missaoSemanalAtiva: true } }) })
    vi.stubGlobal('fetch', fetch)
    render(<GamificacaoConfigPanel />)
    fireEvent.click(await screen.findByLabelText('Ativar missão semanal'))
    fireEvent.click(screen.getAllByText('Salvar este módulo')[0])
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const [url, opcoes] = fetch.mock.calls[1]
    expect(url).toBe('/api/admin/ranking/gamificacao')
    expect(opcoes.method).toBe('POST')
    expect(JSON.parse(opcoes.body)).toEqual({ missaoSemanalAtiva: true, missaoSemanalMultiplicador: 2, missaoSemanalCooldownDias: 7 })
    expect(await screen.findByText(/Configuração salva/)).toBeTruthy()
  })

  test('missão de foto salva somente ativação e bônus do Ranking', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => inicial })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, config: { ...inicial, missaoFotoPerfilAtiva: true, missaoFotoPerfilBonus: 7 } }) })
    vi.stubGlobal('fetch', fetch)
    render(<GamificacaoConfigPanel />)
    fireEvent.click(await screen.findByLabelText('Ativar missão de foto'))
    fireEvent.change(screen.getByLabelText('Pontos no Ranking'), { target: { value: '7' } })
    fireEvent.click(screen.getAllByText('Salvar este módulo')[2])
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      missaoFotoPerfilAtiva: true,
      missaoFotoPerfilBonus: 7,
    })
  })

  test('erro de validação é mostrado e não declara sucesso', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => inicial })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ detalhes: ['tabela incompleta'] }) })
    vi.stubGlobal('fetch', fetch)
    render(<GamificacaoConfigPanel />)
    fireEvent.click(await screen.findByLabelText('Ativar carryover'))
    fireEvent.click(screen.getAllByText('Salvar este módulo')[4])
    expect(await screen.findByText('Não foi salvo: tabela incompleta')).toBeTruthy()
    expect(screen.queryByText(/Configuração salva/)).toBeNull()
  })

  test('resposta de um módulo não apaga edição pendente de outro', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => inicial })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, config: { ...inicial, missaoSemanalAtiva: true } }) })
    vi.stubGlobal('fetch', fetch)
    render(<GamificacaoConfigPanel />)
    const bonus = await screen.findByLabelText('Bônus aprovado no Ranking') as HTMLInputElement
    fireEvent.change(bonus, { target: { value: '9' } })
    fireEvent.click(screen.getByLabelText('Ativar missão semanal'))
    fireEvent.click(screen.getAllByText('Salvar este módulo')[0])
    expect(await screen.findByText(/Configuração salva/)).toBeTruthy()
    expect(bonus.value).toBe('9')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty('missaoIndicacaoBonus')
  })
})
