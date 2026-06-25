import type { Metadata, Viewport } from 'next'
import { CartProvider } from '@/lib/cart-context'

export const metadata: Metadata = {
  title: 'Chefe da Pizza',
  description: 'Peça sua pizza favorita com delivery ou retirada',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Chefe da Pizza',
  },
}

export const viewport: Viewport = {
  themeColor: '#DC2626',
}

export default function LojaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="manifest" href="/loja-manifest.json" />
      <div className="min-h-screen bg-white text-gray-900 max-w-md mx-auto relative">
        <CartProvider>{children}</CartProvider>
      </div>
    </>
  )
}
