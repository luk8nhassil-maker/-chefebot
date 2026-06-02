import { Simulator } from "@/components/Simulator";
import { MenuCard } from "@/components/MenuCard";
import Link from "next/link";

export default function SimuladorPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🍕</span>
            <div>
              <h1 className="font-bold text-gray-800 text-lg leading-none">
                ChefBot
              </h1>
              <p className="text-gray-400 text-xs">Chefe da Pizza</p>
            </div>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link
              href="/"
              className="text-gray-500 hover:text-gray-700 transition"
            >
              Dashboard
            </Link>
            <Link
              href="/simulador"
              className="text-green-700 font-semibold border-b-2 border-green-600"
            >
              Simulador
            </Link>
          </nav>
        </div>
      </header>

      {/* Main layout */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-120px)]">
          {/* Chat Simulator */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <Simulator />
          </div>

          {/* Menu Reference */}
          <div className="overflow-y-auto">
            <MenuCard />
          </div>
        </div>
      </main>
    </div>
  );
}
