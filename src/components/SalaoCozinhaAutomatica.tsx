"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  ehPedidoSalaoParaInicioAutomatico,
  payloadInicioAutomaticoSalao,
  processarFilaImpressaoSalao,
  urlImpressaoAutomaticaSalao,
  type PedidoMinimoSalaoCozinha,
} from "@/lib/salaoCozinhaAutomatica";

const INTERVALO_VERIFICACAO_MS = 2_000;
const TIMEOUT_IMPRESSAO_MS = 30_000;

type PedidoPainelSalao = PedidoMinimoSalaoCozinha & {
  id: string;
};

function imprimirPedidoSilencioso(pedidoId: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  return new Promise((resolve, reject) => {
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

    let finalizado = false;
    let timeoutId: number | undefined;

    const remover = () => {
      window.setTimeout(() => {
        try { iframe.remove(); } catch {}
      }, 1_000);
    };

    const finalizar = (erro?: Error) => {
      if (finalizado) return;
      finalizado = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      remover();
      if (erro) reject(erro);
      else resolve();
    };

    iframe.onload = () => {
      try {
        const conteudo = iframe.contentWindow;
        if (!conteudo) {
          finalizar(new Error("iframe_de_impressao_indisponivel"));
          return;
        }
        conteudo.addEventListener("afterprint", () => finalizar(), { once: true });
      } catch {
        finalizar(new Error("falha_ao_monitorar_impressao"));
      }
    };

    iframe.onerror = () => finalizar(new Error("falha_ao_carregar_cupom"));
    timeoutId = window.setTimeout(
      () => finalizar(new Error("timeout_de_impressao")),
      TIMEOUT_IMPRESSAO_MS,
    );

    document.body.appendChild(iframe);
  });
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
 *
 * Quando há vários pedidos pendentes, cada claim + impressão é processado em
 * série. Isso evita chamadas concorrentes de window.print(), que o navegador
 * pode descartar, e mantém pedidos ainda não processados em "novo" caso a aba
 * seja fechada no meio da fila.
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
        await processarFilaImpressaoSalao(
          pendentes.map((pedido) => pedido.id),
          async (pedidoId) => {
            if (cancelado || processandoRef.current.has(pedidoId)) return;
            processandoRef.current.add(pedidoId);
            try {
              const aceite = await fetch("/api/orders", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify(payloadInicioAutomaticoSalao(pedidoId)),
              });
              const resultado = await aceite.json().catch(() => null);
              if (aceite.ok && resultado?.podeImprimirAutomaticamente === true) {
                await imprimirPedidoSilencioso(pedidoId);
              }
            } finally {
              processandoRef.current.delete(pedidoId);
            }
          },
        );
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
