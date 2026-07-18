// Server layout da área do cliente com um único propósito: impedir que o
// HTML de /cliente e /cliente/pedidos seja prerendered e servido do cache do
// CDN. Incidente comprovado (Perfil 3.0, 3ª validação): logo após um deploy,
// o CDN da Vercel ainda servia o HTML prerendered do deploy ANTERIOR
// (x-vercel-cache: HIT com age de horas + x-nextjs-stale-time: 300), então o
// aparelho carregava o bundle JS antigo e reproduzia o bug já corrigido.
// force-dynamic faz o HTML ser renderizado a cada request, sempre apontando
// para os chunks do deployment vigente. Custo aceitável: são páginas leves,
// e todo o conteúdo real já vinha de fetches client-side.
export const dynamic = "force-dynamic";

export default function ClienteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
