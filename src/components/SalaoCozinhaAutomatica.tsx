"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  ehPedidoSalaoParaInicioAutomatico,
  payloadInicioAutomaticoSalao,
  urlImpressaoAutomaticaSalao,
  type PedidoMinimoSalaoCozinha,
} from "@/lib/salaoCozinhaAutomatica";

const INTERVALO_VERIFICACAO_MS = 2_000;

type PedidoPainelSalao = PedidoMinimoSalaoCozinha & {
  id: string;
};

function imprimirPedidoSilencioso(pedidoId: string) {
  if (typeof window === "undefined") return;

  const iframe = document.createElement("iframe");
  iframe.src = urlImpressaoAutomaticaSalao(pedidoId);
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const remover = () => {
    window.setTimeout(() => {
      try { iframe.remove(); } catch {}
    }, 1_000);
  };

  iframe.onload = () => {
    try { iframe.contentWindow?.addEventListener("afterprint", remover); } catch {}
  };

  window.setTimeout(remover, 30_000);
}

/**
 * Ponte operacional do Salão para a cozinha.
 *
 * O pedido já é criado pelo motor oficial do ChefeBot. Este componente roda
 * somente no /pedidos de Production, no navegador operacional visível/focado,
 * aceita automaticamente apenas pedidos de comanda ainda em "novo" e usa o
 * MESMO PATCH novo -> em_preparo já existente. O servidor continua sendo a
 * autoridade do status e do claim Redis de impressão; só quem recebe
 * `podeImprimirAutomaticamente` dispara o cupom, evitando duplicação entre
 * abas/dispositivos concorrentes.
 */
export default function SalaoCozinhaAutomatica({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const processandoRef = useRef(new Set<string>());
  const cicloEmAndamentoRef = useRef(false);

  useEffect(() => {
    if (!enabled || pathname !== "/pedidos") return;

    let cancelado = false;

    const ciclo = async () => {
      if (cancelado || cicloEmAndamentoRef.current) return;
      if (document.hidden || !document.hasFocus()) return;

      cicloEmAndamentoRef.current = true;
      try {
        const resposta = await fetch("/api/orders", { cache: "no-store", credentials: "same-origin" });
        if (!resposta.ok) return;

        const dados = await resposta.json().catch(() => null);
        if (!Array.isArray(dados)) return;

        const pendentes = (dados as PedidoPainelSalao[]).filter(ehPedidoSalaoParaInicioAutomatico);
        for (const pedido of pendentes) {
          if (cancelado || processandoRef.current.has(pedido.id)) continue;
          processandoRef.current.add(pedido.id);
          try {
            const aceite = await fetch("/api/orders", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify(payloadInicioAutomaticoSalao(pedido.id)),
            });
            const resultado = await aceite.json().catch(() => null);
            if (aceite.ok && resultado?.podeImprimirAutomaticamente === true) {
              imprimirPedidoSilencioso(pedido.id);
            }
          } finally {
            processandoRef.current.delete(pedido.id);
          }
        }
      } catch {
        // Best-effort: uma falha desta automação nunca derruba o painel.
        // O pedido permanece em "novo" e continua recuperável manualmente.
      } finally {
        cicloEmAndamentoRef.current = false;
      }
    };

    const aoFocar = () => { void ciclo(); };
    const aoMudarVisibilidade = () => { if (!document.hidden) void ciclo(); };

    void ciclo();
    const intervalo = window.setInterval(() => { void ciclo(); }, INTERVALO_VERIFICACAO_MS);
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [enabled, pathname]);

  return null;
}
