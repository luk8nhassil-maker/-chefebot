import { Simulator } from "@/components/Simulator";
import { MenuCard } from "@/components/MenuCard";
import { NavBar } from "@/components/NavBar";

export default function SimuladorPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar currentPage="simulador" />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-120px)]">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <Simulator />
          </div>
          <div className="overflow-y-auto">
            <MenuCard />
          </div>
        </div>
      </main>
    </div>
  );
}
