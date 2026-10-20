// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Ranking3Preview from '../dev/ranking3-preview/Ranking3Preview'
import { destinoNextPermitido } from '@/lib/clientePedidos'
afterEach(cleanup)
describe('Ranking3 — experiência móvel e Preview sem efeitos', () => {
  it('mostra liga, posição e próxima ação sem inventar prêmio', () => {
    const rede = vi.spyOn(globalThis, 'fetch')
    render(<Ranking3Preview />)
    expect(screen.getByText(/Nível 1 · Ranking Normal/)).toBeInTheDocument()
    expect(screen.getByText(/Você está em 4º lugar/)).toBeInTheDocument()
    expect(screen.queryByText(/Sua pizza Família está disponível/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })
    expect(screen.getByText(/Meta para o Nível 3: 20/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '12')
    expect(rede).not.toHaveBeenCalled(); rede.mockRestore()
  })
  it('Nível 3 é só reconhecimento; prêmio no Preview não abre checkout', () => {
    render(<Ranking3Preview />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '3' } })
    expect(screen.getByText(/nenhum benefício extra está prometido/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Prévia — sem pedido real' })).toBeDisabled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/Seu prêmio não vence/)).toBeInTheDocument()
  })
  it('login retorna somente ao deep link interno aprovado', () => {
    expect(destinoNextPermitido('/cliente/premios')).toBe('/cliente/premios')
    expect(destinoNextPermitido('//externo.example/cliente/premios')).toBeNull()
    expect(destinoNextPermitido('/cliente/premios?cliente=outro')).toBeNull()
  })
})
