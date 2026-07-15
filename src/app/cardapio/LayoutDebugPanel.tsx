"use client";
import { useEffect, useRef, useState } from "react";

// Instrumentação opt-in para o incidente de layout corrompido no /cardapio em
// alguns aparelhos. Só ativa com ?layoutDebug=1 na URL — nunca aparece para
// clientes normais, não altera visual, não toca carrinho/Pix/pedido, e não
// coleta nenhum dado pessoal (nome, telefone, endereço, itens do pedido).
// Coleta só: dimensões/posição dos cards de categoria, quantas tags <style>
// existem, tamanho do CSS injetado, viewport/DPR e erros de console.

type CardSnapshot = {
  index: number;
  label: string;
  rect: { x: number; y: number; width: number; height: number };
  display: string;
  position: string;
  gridColumn: string;
  gridRow: string;
  minWidth: string;
  maxWidth: string;
  flexShrink: string;
  transform: string;
  overflow: string;
  writingMode: string;
  visuallyEmpty: boolean;
};

type Snapshot = {
  at: string;
  trigger: string;
  innerWidth: number;
  innerHeight: number;
  documentClientWidth: number;
  visualViewportWidth: number | null;
  visualViewportScale: number | null;
  devicePixelRatio: number;
  orientation: string;
  userAgent: string;
  styleTagCount: number;
  cardapioStyleTagLength: number | null;
  cards: CardSnapshot[];
  anomalies: string[];
};

function isLayoutDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("layoutDebug") === "1";
  } catch {
    return false;
  }
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function takeSnapshot(trigger: string, consoleLog: string[]): Snapshot {
  const cardEls = Array.from(document.querySelectorAll<HTMLElement>(".home-grid .home-cat"));
  const gridEl = document.querySelector<HTMLElement>(".home-grid");
  const styleTags = Array.from(document.querySelectorAll("style"));
  const cardapioStyleTag = styleTags.find((s) => (s.textContent || "").includes(".home-grid"));

  const rects = cardEls.map((el) => el.getBoundingClientRect());
  const expectedWidth = gridEl ? gridEl.getBoundingClientRect().width / 2 : 0;

  const cards: CardSnapshot[] = cardEls.map((el, i) => {
    const cs = getComputedStyle(el);
    const rect = rects[i];
    const strong = el.querySelector("strong");
    const label = strong?.textContent?.trim() || `card-${i}`;
    const visuallyEmpty = rect.width < 4 || rect.height < 4 || cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0;
    return {
      index: i,
      label,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: cs.display,
      position: cs.position,
      gridColumn: cs.gridColumn,
      gridRow: cs.gridRow,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
      flexShrink: cs.flexShrink,
      transform: cs.transform,
      overflow: cs.overflow,
      writingMode: cs.writingMode,
      visuallyEmpty,
    };
  });

  const anomalies: string[] = [];
  cards.forEach((c) => {
    if (c.visuallyEmpty) anomalies.push(`card "${c.label}" (índice ${c.index}) está com dimensão zero/oculto`);
    if (expectedWidth > 0 && c.rect.width > 0 && c.rect.width < expectedWidth * 0.5) {
      anomalies.push(`card "${c.label}" está comprimido (${c.rect.width.toFixed(0)}px, esperado ~${expectedWidth.toFixed(0)}px)`);
    }
  });
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) {
        anomalies.push(`cards "${cards[i].label}" e "${cards[j].label}" estão sobrepostos`);
      }
    }
  }
  // Célula vazia no grid: menos cards visíveis do que botões existentes no DOM.
  const domButtonCount = document.querySelectorAll(".home-grid button.home-cat").length;
  if (domButtonCount !== cardEls.length) {
    anomalies.push(`DOM tem ${domButtonCount} botões .home-cat mas só ${cardEls.length} foram encontrados na varredura`);
  }

  const vv = typeof window.visualViewport !== "undefined" ? window.visualViewport : null;

  return {
    at: new Date().toISOString(),
    trigger,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    visualViewportWidth: vv ? vv.width : null,
    visualViewportScale: vv ? vv.scale : null,
    devicePixelRatio: window.devicePixelRatio,
    orientation: window.screen?.orientation?.type || "desconhecida",
    userAgent: navigator.userAgent,
    styleTagCount: styleTags.length,
    cardapioStyleTagLength: cardapioStyleTag ? (cardapioStyleTag.textContent || "").length : null,
    cards,
    anomalies: [...anomalies, ...consoleLog.slice(-10).map((l) => `console: ${l}`)],
  };
}

export default function LayoutDebugPanel() {
  const [enabled] = useState(() => isLayoutDebugEnabled());
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [copied, setCopied] = useState(false);
  const consoleLogRef = useRef<string[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...args: unknown[]) => {
      consoleLogRef.current.push(`[error] ${args.map(String).join(" ")}`);
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      consoleLogRef.current.push(`[warn] ${args.map(String).join(" ")}`);
      origWarn(...args);
    };

    const record = (trigger: string) => {
      setSnapshots((prev) => [...prev.slice(-19), takeSnapshot(trigger, consoleLogRef.current)]);
    };

    record("mount");
    const t1 = setTimeout(() => record("t+1s"), 1000);
    const t2 = setTimeout(() => record("t+3s"), 3000);

    let touchTimer: ReturnType<typeof setTimeout> | null = null;
    const onTouch = (e: Event) => {
      if (touchTimer) clearTimeout(touchTimer);
      touchTimer = setTimeout(() => record(`interacao:${e.type}`), 150);
    };
    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("touchend", onTouch, { passive: true });
    document.addEventListener("scroll", onTouch, { passive: true });
    document.addEventListener("visibilitychange", () => record("visibilitychange"));

    return () => {
      console.error = origError;
      console.warn = origWarn;
      clearTimeout(t1);
      clearTimeout(t2);
      if (touchTimer) clearTimeout(touchTimer);
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("touchend", onTouch);
      document.removeEventListener("scroll", onTouch);
    };
  }, [enabled]);

  if (!enabled) return null;

  const last = snapshots[snapshots.length - 1];
  const totalAnomalies = snapshots.reduce((acc, s) => acc + s.anomalies.length, 0);

  function copyReport() {
    const report = JSON.stringify(snapshots, null, 2);
    navigator.clipboard.writeText(report).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => {}
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 99999,
        maxWidth: 280,
        background: "rgba(20,20,25,0.94)",
        color: "#fff",
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 11,
        fontFamily: "monospace",
        lineHeight: 1.4,
        boxShadow: "0 4px 20px rgba(0,0,0,.4)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>layoutDebug</div>
      <div>cards: {last?.cards.length ?? 0} · style tags: {last?.styleTagCount ?? 0}</div>
      <div>anomalias detectadas: {totalAnomalies}</div>
      {last && last.anomalies.length > 0 && (
        <div style={{ color: "#ff6b6b", marginTop: 4 }}>{last.anomalies[0]}</div>
      )}
      <button
        onClick={copyReport}
        style={{ marginTop: 6, width: "100%", padding: "6px 8px", borderRadius: 8, border: "none", background: "#ffcd00", color: "#192230", fontWeight: 700, cursor: "pointer" }}
      >
        {copied ? "Copiado!" : "Copiar relatório"}
      </button>
    </div>
  );
}
