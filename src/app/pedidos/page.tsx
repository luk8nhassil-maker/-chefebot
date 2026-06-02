import { NavBar } from "@/components/NavBar";

export default function PedidosPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar currentPage="pedidos" />

      <main className="flex-1 max-w-7xl mx-auto px-4 py-12 w-full">
        <div className="flex items-center gap-3 mb-8">
          <span className="text-3xl">📋</span>
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Gestão de Pedidos</h2>
            <p className="text-gray-400 text-sm">Acompanhe os pedidos em tempo real</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <div className="text-5xl mb-4">🚧</div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Em construção</h3>
          <p className="text-gray-400 text-sm max-w-sm mx-auto">
            O painel de pedidos estará disponível em breve. Aqui você verá todos os pedidos
            recebidos via WhatsApp em tempo real.
          </p>
        </div>
      </main>
    </div>
  );
}
