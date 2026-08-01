'use client'
import type { ButtonHTMLAttributes, CSSProperties } from 'react'

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> {
  selected?: boolean
  esgotado?: boolean
}

/**
 * Elemento selecionável (categoria, filtro, sabor, forma de pagamento).
 * Estados: normal, hover, selecionado, desabilitado, esgotado — nunca só
 * cor: "esgotado" também troca o texto/aparência, não só a tonalidade.
 * Tokens em src/app/globals.css (--cb-chip-*).
 */
export function Chip({ selected = false, esgotado = false, disabled, children, style, ...rest }: ChipProps) {
  const isDisabled = disabled || esgotado

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 36,
    padding: '0 14px',
    borderRadius: 'var(--cb-chip-radius)',
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    transition: 'var(--cb-button-transition)',
    background: 'var(--cb-chip-bg)',
    color: 'var(--cb-chip-text)',
    border: '1.5px solid var(--cb-chip-border)',
    textDecoration: 'none',
    ...style,
  }

  if (selected && !isDisabled) {
    base.background = 'var(--cb-chip-selected-bg)'
    base.color = 'var(--cb-chip-selected-text)'
    base.borderColor = 'var(--cb-chip-selected-border)'
  }

  if (esgotado) {
    base.background = 'var(--cb-chip-esgotado-bg)'
    base.color = 'var(--cb-chip-esgotado-text)'
    base.borderColor = 'transparent'
    base.textDecoration = 'line-through'
  } else if (disabled) {
    base.background = 'var(--cb-chip-disabled-bg)'
    base.color = 'var(--cb-chip-disabled-text)'
    base.borderColor = 'transparent'
  }

  return (
    <button
      type="button"
      role="button"
      aria-pressed={selected}
      disabled={isDisabled}
      style={base}
      onMouseEnter={(e) => {
        if (!isDisabled && !selected) e.currentTarget.style.borderColor = 'var(--cb-chip-hover-border)'
      }}
      onMouseLeave={(e) => {
        if (!isDisabled && !selected) e.currentTarget.style.borderColor = 'var(--cb-chip-border)'
      }}
      {...rest}
    >
      {children}
      {esgotado && <span style={{ fontSize: 11, fontWeight: 600 }}>(esgotado)</span>}
    </button>
  )
}
