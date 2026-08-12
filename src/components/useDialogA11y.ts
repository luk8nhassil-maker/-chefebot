"use client";

import { useEffect, useRef } from "react";

const FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Comportamento de acessibilidade comum a qualquer diálogo modal: ESC fecha,
 * Tab circula dentro do diálogo, o foco entra no elemento certo ao abrir e
 * volta para quem abriu ao fechar.
 *
 * É só isso que os modais do ChefeBot realmente têm em comum — o conteúdo e o
 * formato de cada um continuam próprios da sua função. Vários overlays da
 * mão (painel, conversas, cardápio) não tinham nenhum desses comportamentos:
 * o ESC não fechava, o Tab passeava pela página atrás do backdrop e, ao
 * fechar, o foco caía no início do documento.
 *
 * `onFechar` é lido por ref, então o hook não precisa que o chamador
 * memorize o callback.
 */
export function useDialogA11y(
  aberto: boolean,
  onFechar: () => void,
  opts?: { focoInicial?: React.RefObject<HTMLElement | null>; travarScroll?: boolean }
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  const focoInicial = opts?.focoInicial;
  const travarScroll = opts?.travarScroll !== false;

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const container = containerRef.current;

    // Foco inicial: o alvo pedido pelo chamador (normalmente a ação
    // principal, ou o primeiro campo num formulário) ou o próprio diálogo.
    const alvo = focoInicial?.current ?? container?.querySelector<HTMLElement>(FOCAVEIS) ?? container;
    alvo?.focus?.();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        fecharRef.current();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const focaveis = [...container.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const overflowAnterior = document.body.style.overflow;
    if (travarScroll) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (travarScroll) document.body.style.overflow = overflowAnterior;
      anterior?.focus?.();
    };
  }, [aberto, focoInicial, travarScroll]);

  return containerRef;
}
