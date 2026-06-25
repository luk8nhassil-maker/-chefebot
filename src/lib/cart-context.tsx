"use client";
import { createContext, useContext, useReducer, useEffect, ReactNode } from 'react'
import type { CartItem } from '@/types/loja'

interface CartState {
  items: CartItem[]
}

type CartAction =
  | { type: 'ADD_ITEM'; item: CartItem }
  | { type: 'REMOVE_ITEM'; cartId: string }
  | { type: 'UPDATE_QUANTITY'; cartId: string; qty: number }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; items: CartItem[] }

interface CartContextValue extends CartState {
  addItem: (item: CartItem) => void
  removeItem: (cartId: string) => void
  updateQuantity: (cartId: string, qty: number) => void
  clearCart: () => void
  totalItems: number
  totalPrice: number
}

const CartContext = createContext<CartContextValue | null>(null)

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existingIdx = state.items.findIndex(
        i =>
          i.produtoId === action.item.produtoId &&
          i.tamanho === action.item.tamanho &&
          (i.borda ?? '') === (action.item.borda ?? '')
      )
      if (existingIdx >= 0) {
        const items = [...state.items]
        const existing = items[existingIdx]
        const newQty = existing.quantidade + action.item.quantidade
        items[existingIdx] = { ...existing, quantidade: newQty, total: existing.precoUnitario * newQty }
        return { items }
      }
      return { items: [...state.items, action.item] }
    }
    case 'REMOVE_ITEM':
      return { items: state.items.filter(i => i.cartId !== action.cartId) }
    case 'UPDATE_QUANTITY': {
      if (action.qty <= 0) return { items: state.items.filter(i => i.cartId !== action.cartId) }
      return {
        items: state.items.map(i =>
          i.cartId === action.cartId
            ? { ...i, quantidade: action.qty, total: i.precoUnitario * action.qty }
            : i
        ),
      }
    }
    case 'CLEAR':
      return { items: [] }
    case 'LOAD':
      return { items: action.items }
    default:
      return state
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { items: [] })

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chefe-cart')
      if (saved) dispatch({ type: 'LOAD', items: JSON.parse(saved) })
    } catch {}
  }, [])

  useEffect(() => {
    localStorage.setItem('chefe-cart', JSON.stringify(state.items))
  }, [state.items])

  const totalItems = state.items.reduce((s, i) => s + i.quantidade, 0)
  const totalPrice = state.items.reduce((s, i) => s + i.total, 0)

  return (
    <CartContext.Provider
      value={{
        ...state,
        addItem: item => dispatch({ type: 'ADD_ITEM', item }),
        removeItem: cartId => dispatch({ type: 'REMOVE_ITEM', cartId }),
        updateQuantity: (cartId, qty) => dispatch({ type: 'UPDATE_QUANTITY', cartId, qty }),
        clearCart: () => dispatch({ type: 'CLEAR' }),
        totalItems,
        totalPrice,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
