'use client'
import { useCallback, useSyncExternalStore } from 'react'
import { Sun, Moon } from 'lucide-react'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'chefebot-theme'
const EVENT = 'chefebot-themechange'

function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(EVENT, callback)
  }
}

/**
 * Hook de tema do ChefeBot.
 * - Padrão FIXO: Light. Nunca segue o tema do SO/navegador.
 * - Só ativa Dark quando o usuário escolheu explicitamente (persistido em localStorage).
 * - A inicialização anti-flash acontece no <script> inline do layout; useSyncExternalStore
 *   evita erro de hidratação (servidor sempre 'light') e re-renderiza no cliente.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'light' as Theme)

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(EVENT))
  }, [])

  const toggle = useCallback(() => {
    setTheme(readTheme() === 'dark' ? 'light' : 'dark')
  }, [setTheme])

  return { theme, setTheme, toggle }
}

/**
 * Seletor de aparência Light / Dark.
 * Segmented control acessível — cada opção é um <button> com estado ativo
 * claro (fundo primary suave). Colocar em Configurações / menu do usuário.
 */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
  ]

  return (
    <div
      role="radiogroup"
      aria-label="Aparência"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background: 'var(--surface-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = theme === value
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 9,
              border: active ? '1px solid var(--primary)' : '1px solid transparent',
              background: active ? 'var(--primary-soft)' : 'transparent',
              color: active ? 'var(--foreground)' : 'var(--foreground-muted)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background .15s, color .15s, border-color .15s',
            }}
          >
            <Icon size={16} strokeWidth={2.4} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
