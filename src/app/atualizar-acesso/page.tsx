import Image from "next/image";
import Link from "next/link";

export default function AtualizarAcessoPage() {
  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-white sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl items-center justify-center">
        <section className="w-full rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl sm:p-9">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/logo-chefe-da-pizza.jpg"
              alt="Chefe da Pizza"
              width={88}
              height={88}
              priority
              className="rounded-2xl object-contain"
            />

            <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-amber-400">
              Atualização de acesso
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              O endereço do ChefeBot mudou
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-300 sm:text-lg">
              Este computador ainda pode estar usando um endereço antigo. A partir de agora,
              use somente o acesso oficial da Chefe da Pizza.
            </p>
          </div>

          <div className="mt-7 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5">
            <p className="text-sm font-bold text-amber-300">Novo acesso oficial</p>
            <p className="mt-2 break-all text-lg font-black text-white">
              chefedapizza.com.br/pedidos
            </p>
          </div>

          <div className="mt-7 space-y-3 text-sm leading-6 text-zinc-300">
            <p><strong className="text-white">1.</strong> Clique no botão abaixo para abrir o painel correto.</p>
            <p><strong className="text-white">2.</strong> Se o sistema pedir, faça login novamente.</p>
            <p><strong className="text-white">3.</strong> Remova o favorito antigo e salve o novo endereço no navegador.</p>
          </div>

          <Link
            href="/pedidos"
            className="mt-8 flex w-full items-center justify-center rounded-2xl bg-amber-400 px-5 py-4 text-base font-black text-zinc-950 transition hover:bg-amber-300 focus:outline-none focus:ring-4 focus:ring-amber-300/40"
          >
            Abrir painel oficial
          </Link>

          <p className="mt-5 text-center text-xs leading-5 text-zinc-500">
            O endereço antigo não deve mais ser usado para operar pedidos, conversas ou configurações.
          </p>
        </section>
      </div>
    </main>
  );
}
