'use client'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'danger-soft'
  | 'success'
  | 'warning'
  | 'ghost'
  | 'icon'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  fullWidth?: boolean
}

const VARIANT_STYLE: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: 'var(--cb-button-primary-bg)',
    color: 'var(--cb-button-primary-text)',
    border: '1.5px solid var(--cb-button-primary-border)',
    boxShadow: 'var(--cb-button-shadow-primary)',
  },
  secondary: {
    background: 'var(--cb-button-secondary-bg)',
    color: 'var(--cb-button-secondary-text)',
    border: '1.5px solid var(--cb-button-secondary-border)',
  },
  danger: {
    background: 'var(--cb-button-danger-bg)',
    color: 'var(--cb-button-danger-text)',
    border: '1.5px solid var(--cb-button-danger-border)',
  },
  'danger-soft': {
    background: 'var(--cb-button-danger-soft-bg)',
    color: 'var(--cb-button-danger-soft-text)',
    border: '1.5px solid transparent',
  },
  success: {
    background: 'var(--cb-button-success-bg)',
    color: 'var(--cb-button-success-text)',
    border: '1.5px solid var(--cb-button-success-border)',
  },
  warning: {
    background: 'var(--cb-button-warning-bg)',
    color: 'var(--cb-button-warning-text)',
    border: '1.5px solid var(--cb-button-warning-border)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--cb-button-ghost-text)',
    border: '1.5px solid transparent',
  },
  icon: {
    background: 'transparent',
    color: 'var(--cb-button-icon-text)',
    border: '1.5px solid transparent',
  },
}

// Cor de fundo no hover/active — só as variantes com estado sólido definido
// entram aqui; ghost/icon usam overlay translúcido (ver handlers abaixo).
const HOVER_BG: Partial<Record<ButtonVariant, string>> = {
  primary: 'var(--cb-button-primary-hover)',
  secondary: 'var(--cb-button-secondary-hover)',
  danger: 'var(--cb-button-danger-hover)',
  success: 'var(--cb-button-success-hover)',
  warning: 'var(--cb-button-warning-hover)',
}
const ACTIVE_BG: Partial<Record<ButtonVariant, string>> = {
  primary: 'var(--cb-button-primary-active)',
  secondary: 'var(--cb-button-secondary-active)',
  danger: 'var(--cb-button-danger-active)',
  success: 'var(--cb-button-success-active)',
  warning: 'var(--cb-button-warning-active)',
}
const OVERLAY_HOVER: Partial<Record<ButtonVariant, string>> = {
  ghost: 'var(--cb-button-ghost-hover)',
  icon: 'var(--cb-button-icon-hover)',
  'danger-soft': 'var(--cb-button-danger-soft-bg)',
}
const OVERLAY_ACTIVE: Partial<Record<ButtonVariant, string>> = {
  ghost: 'var(--cb-button-ghost-active)',
  icon: 'var(--cb-button-icon-active)',
}

const SIZE_STYLE: Record<ButtonSize, CSSProperties> = {
  sm: { height: 'var(--cb-button-height-sm)', padding: '0 var(--cb-button-padding-x-sm)', fontSize: 'var(--cb-button-font-sm)' },
  md: { height: 'var(--cb-button-height-md)', padding: '0 var(--cb-button-padding-x-md)', fontSize: 'var(--cb-button-font-md)' },
  lg: { height: 'var(--cb-button-height-lg)', padding: '0 var(--cb-button-padding-x-lg)', fontSize: 'var(--cb-button-font-lg)' },
}
const ICON_SIZE_STYLE: Record<ButtonSize, CSSProperties> = {
  sm: { width: 'var(--cb-button-icon-size-sm)', height: 'var(--cb-button-icon-size-sm)', padding: 0 },
  md: { width: 'var(--cb-button-icon-size-md)', height: 'var(--cb-button-icon-size-md)', padding: 0 },
  lg: { width: 'var(--cb-button-icon-size-lg)', height: 'var(--cb-button-icon-size-lg)', padding: 0 },
}
const SPINNER_PX: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 }

/**
 * Botão premium unificado do ChefeBot — variantes e tokens em
 * src/app/globals.css (--cb-button-*). Ver docs/DESIGN_SYSTEM.md.
 *
 * variant="icon" exige aria-label (ou children de texto visível) — sem os
 * dois, o botão fica mudo para leitor de tela.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconPosition = 'left',
    fullWidth = false,
    disabled,
    children,
    style,
    onMouseEnter,
    onMouseLeave,
    onMouseDown,
    onMouseUp,
    'aria-label': ariaLabel,
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading
  const isIconOnly = variant === 'icon'

  if (process.env.NODE_ENV !== 'production' && isIconOnly && !ariaLabel && !children) {
    console.warn('<Button variant="icon"> precisa de aria-label (ou texto visível) para acessibilidade.')
  }

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--cb-button-gap)',
    width: fullWidth ? '100%' : undefined,
    borderRadius: 'var(--cb-button-radius)',
    fontWeight: 'var(--cb-button-font-weight)' as unknown as number,
    fontFamily: 'inherit',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    transition: 'var(--cb-button-transition)',
    opacity: disabled && !loading ? 'var(--cb-button-disabled-opacity)' as unknown as number : loading ? ('var(--cb-button-loading-opacity)' as unknown as number) : 1,
    ...VARIANT_STYLE[variant],
    ...(isIconOnly ? ICON_SIZE_STYLE[size] : SIZE_STYLE[size]),
    ...style,
  }

  if (disabled) {
    base.background = 'var(--cb-button-disabled-bg)'
    base.color = 'var(--cb-button-disabled-text)'
    base.borderColor = 'transparent'
    base.boxShadow = 'none'
  }

  const solidHover = HOVER_BG[variant]
  const solidActive = ACTIVE_BG[variant]
  const overlayHover = OVERLAY_HOVER[variant]
  const overlayActive = OVERLAY_ACTIVE[variant]

  return (
    <button
      ref={ref}
      type="button"
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      style={base}
      onMouseEnter={(e) => {
        if (!isDisabled) {
          if (solidHover) e.currentTarget.style.background = solidHover
          else if (overlayHover) e.currentTarget.style.background = overlayHover
        }
        onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) e.currentTarget.style.background = VARIANT_STYLE[variant].background as string
        onMouseLeave?.(e)
      }}
      onMouseDown={(e) => {
        if (!isDisabled) {
          if (solidActive) e.currentTarget.style.background = solidActive
          else if (overlayActive) e.currentTarget.style.background = overlayActive
        }
        onMouseDown?.(e)
      }}
      onMouseUp={(e) => {
        if (!isDisabled) {
          if (solidHover) e.currentTarget.style.background = solidHover
          else if (overlayHover) e.currentTarget.style.background = overlayHover
        }
        onMouseUp?.(e)
      }}
      {...rest}
    >
      {isIconOnly ? (
        loading ? <Loader2 className="cb-spin" size={SPINNER_PX[size]} strokeWidth={2.4} aria-hidden="true" /> : icon ?? children
      ) : (
        <>
          {loading ? (
            <Loader2 className="cb-spin" size={SPINNER_PX[size]} strokeWidth={2.4} aria-hidden="true" />
          ) : (
            icon && iconPosition === 'left' && (
              <span style={{ display: 'inline-flex' }} aria-hidden="true">
                {icon}
              </span>
            )
          )}
          {children}
          {!loading && icon && iconPosition === 'right' && (
            <span style={{ display: 'inline-flex' }} aria-hidden="true">
              {icon}
            </span>
          )}
        </>
      )}
    </button>
  )
})
