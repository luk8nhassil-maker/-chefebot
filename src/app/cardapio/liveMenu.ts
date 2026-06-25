import { useEffect, useState } from "react";
import type { MenuType } from "./page";

// Polling leve do cardápio público: rebusca /api/cardapio a cada 3s enquanto a
// aba estiver visível, sempre sem cache. Mantém o cardápio atual entre buscas
// (sem piscar) e só sinaliza erro se a carga inicial falhar.
export function useLiveMenu() {
  const [menu, setMenu] = useState<MenuType | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load(initial: boolean) {
      try {
        const r = await fetch("/api/cardapio", { cache: "no-store" });
        if (!r.ok) throw new Error("api error");
        const data = await r.json();
        if (!alive) return;
        if (data && typeof data === "object") {
          setMenu(data);
          setErro(false);
        } else if (initial) {
          setErro(true);
        }
      } catch {
        // Erros durante o polling não interrompem o cliente: mantém o cardápio
        // atual. Só mostramos erro se a primeira carga falhar.
        if (initial && alive) setErro(true);
      }
    }

    load(true);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 3000);

    // Ao voltar a ficar visível, busca imediatamente (não espera o próximo tick).
    const onVisible = () => {
      if (document.visibilityState === "visible") load(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function retry() {
    setErro(false);
    fetch("/api/cardapio", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMenu(d))
      .catch(() => setErro(true));
  }

  return { menu, erro, retry };
}

// Um item do carrinho está esgotado se qualquer um dos seus "keys" (sabores
// e/ou borda da pizza, ou o nome do item simples) estiver na lista atual de
// esgotados.
export function cartItemEsgotado(keys: string[] | undefined, esgotados: string[]): boolean {
  return (keys ?? []).some((k) => esgotados.includes(k));
}
