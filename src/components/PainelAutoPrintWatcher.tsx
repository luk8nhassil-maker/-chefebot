"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

type PedidoObservado = {
  id?: string;
  origem?: string;
  pixConfirmado?: boolean;
  pix?: { status?: string };
};

export function pixConfirmadoNoPedido(pedido: PedidoObservado): boolean {
  return pedido.pixConfirmado === true || pedido.pix?.status === "confirmado";
}

export function detectarPedidosParaAutoPrint(
  anteriores: ReadonlyMap<string, boolean>,
  atuais: PedidoObservado[],
): string[] {
  const candidatos: string[] = [];
  for (const pedido of atuais) {
    if (!pedido.id || pedido.origem !== "painel") continue;
    const pixAgora = pixConfirmadoNoPedido(pedido);
    if (!anteriores.has(pedido.id) || (anteriores.get(pedido.id) === false && pixAgora)) {
      candidatos.push(pedido.id);
    }
  }
  return candidatos;
}

function imprimirPedidoSilencioso(id: string) {
  const iframe = document.createElement("iframe");
  iframe.src = `/pedidos/${encodeURIComponent(id)}/imprimir?auto=1&embedded=1`;
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 20_000);
}

export default function PainelAutoPrintWatcher() {
  const pathname = usePathname();
  const anterioresRef = useRef<Map<string, boolean>>(new Map());
  const inicializadoRef = useRef(false);
  const emAndamentoRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (pathname !== "/pedidos") {
      anterioresRef.current = new Map();
      inicializadoRef.current = false;
      emAndamentoRef.current.clear();
      return;
    }

    let ativo = true;

    async function tentarImprimir(id: string) {
      if (emAndamentoRef.current.has(id)) return;
      emAndamentoRef.current.add(id);
      try {
        const res = await fetch("/api/orders/auto-print-painel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (ativo && data?.podeImprimirAutomaticamente === true) {
          imprimirPedidoSilencioso(id);
        }
      } catch {
        // Best-effort: o proximo polling pode tentar de novo. O servidor
        // garante idempotencia antes de autorizar qualquer impressao.
      } finally {
        emAndamentoRef.current.delete(id);
      }
    }

    async function atualizar() {
      try {
        const res = await fetch("/api/orders", { cache: "no-store" });
        if (!res.ok || !ativo) return;
        const data = (await res.json()) as PedidoObservado[];
        if (!Array.isArray(data) || !ativo) return;

        const mapaAtual = new Map<string, boolean>();
        for (const pedido of data) {
          if (!pedido.id || pedido.origem !== "painel") continue;
          mapaAtual.set(pedido.id, pixConfirmadoNoPedido(pedido));
        }

        if (!inicializadoRef.current) {
          // Nunca reimprime pedidos antigos ao abrir/recarregar o painel.
          anterioresRef.current = mapaAtual;
          inicializadoRef.current = true;
          return;
        }

        const candidatos = detectarPedidosParaAutoPrint(anterioresRef.current, data);
        anterioresRef.current = mapaAtual;
        candidatos.forEach((id) => void tentarImprimir(id));
      } catch {
        // O painel continua funcional mesmo se uma leitura de polling falhar.
      }
    }

    void atualizar();
    const timer = window.setInterval(() => void atualizar(), 3_000);
    return () => {
      ativo = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  return null;
}
