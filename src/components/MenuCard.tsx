"use client";

import { MENU } from "@/lib/menu";

export function MenuCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="bg-red-700 text-white px-4 py-3">
        <h2 className="font-bold text-lg">🍕 Cardápio</h2>
        <p className="text-red-200 text-xs">Chefe da Pizza</p>
      </div>

      <div className="p-4 space-y-4 text-sm">
        {/* Sizes */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">Tamanhos</h3>
          <div className="grid grid-cols-2 gap-2">
            {MENU.sizes.map((s) => (
              <div
                key={s.code}
                className="bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 flex justify-between items-center"
              >
                <span className="font-medium text-gray-700">
                  {s.code} — {s.label}
                </span>
                <span className="text-green-700 font-bold">
                  R$ {s.price},00
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Salty Flavors */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">
            🧀 Sabores Salgados
          </h3>
          <div className="grid grid-cols-2 gap-1">
            {MENU.saltyFlavors.map((f) => (
              <div
                key={f}
                className="text-gray-600 bg-gray-50 rounded px-2 py-1 text-xs"
              >
                • {f}
              </div>
            ))}
          </div>
        </div>

        {/* Sweet Flavors */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">
            🍫 Sabores Doces
          </h3>
          <div className="grid grid-cols-2 gap-1">
            {MENU.sweetFlavors.map((f) => (
              <div
                key={f}
                className="text-gray-600 bg-pink-50 rounded px-2 py-1 text-xs"
              >
                • {f}
              </div>
            ))}
          </div>
        </div>

        {/* Borders */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">Bordas</h3>
          <div className="space-y-1 text-xs text-gray-600">
            <div className="flex justify-between bg-yellow-50 rounded px-2 py-1">
              <span>Borda recheada P/M</span>
              <span className="font-semibold">R$ 8,00</span>
            </div>
            <div className="flex justify-between bg-yellow-50 rounded px-2 py-1">
              <span>Borda recheada G/F</span>
              <span className="font-semibold">R$ 10,00</span>
            </div>
          </div>
        </div>

        {/* Delivery */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">
            🛵 Taxa de Entrega
          </h3>
          <div className="space-y-1 text-xs">
            {MENU.neighborhoods.map((n) => (
              <div
                key={n.group}
                className="flex justify-between bg-blue-50 rounded px-2 py-1 text-gray-600"
              >
                <span>{n.group}</span>
                <span className="font-semibold text-blue-700">
                  R$ {n.fee},00
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Payments */}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">💳 Pagamento</h3>
          <div className="flex gap-2 flex-wrap">
            {MENU.payments.map((p) => (
              <span
                key={p}
                className="bg-green-50 border border-green-100 text-green-700 text-xs font-medium px-3 py-1 rounded-full"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
