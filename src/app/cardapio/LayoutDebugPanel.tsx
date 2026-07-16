"use client";
import { useEffect, useRef, useState } from "react";

// Instrumentação opt-in para o incidente de layout corrompido no /cardapio em
// alguns aparelhos. Só ativa com ?layoutDebug=1 na URL — nunca aparece para
// clientes normais, não altera visual, não toca carrinho/Pix/pedido, e não
// coleta nenhum dado pessoal (nome, telefone, endereço, itens do pedido).
//
// O vídeo real do incidente mostra a corrupção EVOLUINDO durante o scroll
// (cards sem caixa, ícones/textos duplicados ou fantasmas, faixas
// comprimidas) — não é um estado único. Por isso este painel mantém uma
// linha do tempo de eventos (não só um snapshot inicial), disparada por
// scroll, resize, mudanças de visualViewport, ResizeObserver nos próprios
// cards e MutationObserver no grid e nas tags <style>.

type CardSnapshot = {
  index: number;
  selector: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  display: string;
  position: string;
  gridColumn: string;
  gridRow: string;
  minWidth: string;
  maxWidth: string;
  flexShrink: string;
  transform: string;
  opacity: string;
  visibility: string;
  overflow: string;
  writingMode: string;
  className: string;
  styleAttr: string;
  visuallyEmpty: boolean;
};

type TimelineEntry = {
  tMs: number;
  at: string;
  trigger: string;
  innerWidth: number;
  innerHeight: number;
  documentClientWidth: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  visualViewportScale: number | null;
  devicePixelRatio: number;
  orientation: string;
  userAgent: string;
  styleTagCount: number;
  cardapioStyleTagLength: number | null;
  gridRect: { x: number; y: number; width: number; height: number } | null;
  gridTemplateColumns: string | null;
  gridChildCount: number | null;
  duplicatedTexts: string[];
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

function takeSnapshot(trigger: string, startedAt: number, consoleLog: string[]): TimelineEntry {
  const cardEls = Array.from(document.querySelectorAll<HTMLElement>(".home-grid .home-cat"));
  const gridEl = document.querySelector<HTMLElement>(".home-grid");
  const styleTags = Array.from(document.querySelectorAll("style"));
  const cardapioStyleTag = styleTags.find((s) => (s.textContent || "").includes(".home-grid"));

  const gridCs = gridEl ? getComputedStyle(gridEl) : null;
  const gridRectRaw = gridEl ? gridEl.getBoundingClientRect() : null;
  const expectedWidth = gridRectRaw ? gridRectRaw.width / 2 : 0;

  const rects = cardEls.map((el) => el.getBoundingClientRect());
  const textCounts = new Map<string, number>();

  const cards: CardSnapshot[] = cardEls.map((el, i) => {
    const cs = getComputedStyle(el);
    const rect = rects[i];
    const text = (el.textContent || "").trim();
    if (text) textCounts.set(text, (textCounts.get(text) || 0) + 1);
    const visuallyEmpty = rect.width < 4 || rect.height < 4 || cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0;
    return {
      index: i,
      selector: `.home-grid .home-cat:nth-child(${i + 1})`,
      text,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: cs.display,
      position: cs.position,
      gridColumn: cs.gridColumn,
      gridRow: cs.gridRow,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
      flexShrink: cs.flexShrink,
      transform: cs.transform,
      opacity: cs.opacity,
      visibility: cs.visibility,
      overflow: cs.overflow,
      writingMode: cs.writingMode,
      className: el.className,
      styleAttr: el.getAttribute("style") || "",
      visuallyEmpty,
    };
  });

  const duplicatedTexts = Array.from(textCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([text, count]) => `"${text}" aparece ${count}x`);

  const anomalies: string[] = [];
  cards.forEach((c) => {
    if (c.visuallyEmpty) anomalies.push(`card #${c.index} ("${c.text || "vazio"}") está com dimensão zero/oculto`);
    if (expectedWidth > 0 && c.rect.width > 0 && c.rect.width < expectedWidth * 0.5) {
      anomalies.push(`card #${c.index} ("${c.text}") está comprimido (${c.rect.width.toFixed(0)}px, esperado ~${expectedWidth.toFixed(0)}px)`);
    }
  });
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) {
        anomalies.push(`cards #${i} ("${cards[i].text}") e #${j} ("${cards[j].text}") estão sobrepostos`);
      }
    }
  }
  const domButtonCount = document.querySelectorAll(".home-grid button.home-cat").length;
  if (domButtonCount !== cardEls.length) {
    anomalies.push(`DOM tem ${domButtonCount} botões .home-cat mas só ${cardEls.length} foram encontrados na varredura`);
  }
  if (duplicatedTexts.length > 0) {
    anomalies.push(`texto duplicado detectado: ${duplicatedTexts.join(", ")}`);
  }

  const vv = typeof window.visualViewport !== "undefined" ? window.visualViewport : null;

  return {
    tMs: Math.round(performance.now() - startedAt),
    at: new Date().toISOString(),
    trigger,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    visualViewportWidth: vv ? vv.width : null,
    visualViewportHeight: vv ? vv.height : null,
    visualViewportScale: vv ? vv.scale : null,
    devicePixelRatio: window.devicePixelRatio,
    orientation: window.screen?.orientation?.type || "desconhecida",
    userAgent: navigator.userAgent,
    styleTagCount: styleTags.length,
    cardapioStyleTagLength: cardapioStyleTag ? (cardapioStyleTag.textContent || "").length : null,
    gridRect: gridRectRaw ? { x: gridRectRaw.x, y: gridRectRaw.y, width: gridRectRaw.width, height: gridRectRaw.height } : null,
    gridTemplateColumns: gridCs ? gridCs.gridTemplateColumns : null,
    gridChildCount: gridEl ? gridEl.childElementCount : null,
    duplicatedTexts,
    cards,
    anomalies: [...anomalies, ...consoleLog.slice(-6).map((l) => `console: ${l}`)],
  };
}

const MAX_TIMELINE_ENTRIES = 300;

export default function LayoutDebugPanel() {
  const [enabled] = useState(() => isLayoutDebugEnabled());
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const consoleLogRef = useRef<string[]>([]);
  const lastRectsRef = useRef<string>("");
  const lastAnomalyKeyRef = useRef<string>("");

  useEffect(() => {
    if (!enabled) return;
    const startedAt = performance.now();

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
      const entry = takeSnapshot(trigger, startedAt, consoleLogRef.current);
      // Evita inundar a linha do tempo: só grava de novo se algo relevante
      // (retângulos dos cards ou lista de anomalias) realmente mudou desde o
      // último registro, exceto para os marcos fixos (mount/t+1s/t+3s/t+6s).
      const rectsKey = JSON.stringify(entry.cards.map((c) => c.rect));
      const anomalyKey = entry.anomalies.join("|");
      const isMilestone = trigger.startsWith("t+") || trigger === "mount";
      if (!isMilestone && rectsKey === lastRectsRef.current && anomalyKey === lastAnomalyKeyRef.current) {
        return;
      }
      lastRectsRef.current = rectsKey;
      lastAnomalyKeyRef.current = anomalyKey;
      setTimeline((prev) => [...prev.slice(-(MAX_TIMELINE_ENTRIES - 1)), entry]);
    };

    record("mount");
    const milestones = [1000, 3000, 6000, 10000].map((ms) => setTimeout(() => record(`t+${ms / 1000}s`), ms));

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRecord = (label: string, delay = 120) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => record(label), delay);
    };

    const onTouch = (e: Event) => debouncedRecord(`interacao:${e.type}`);
    const onScroll = () => debouncedRecord("scroll");
    const onResize = () => debouncedRecord("resize");
    const onVisibility = () => record("visibilitychange");

    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("touchmove", onTouch, { passive: true });
    document.addEventListener("touchend", onTouch, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    const vv = window.visualViewport;
    const onVvResize = () => debouncedRecord("visualViewport:resize");
    const onVvScroll = () => debouncedRecord("visualViewport:scroll");
    vv?.addEventListener("resize", onVvResize);
    vv?.addEventListener("scroll", onVvScroll);

    // Detecta card mudando de tamanho independentemente de scroll/resize
    // (ex.: repintura assíncrona, layer de composição dessincronizado).
    const resizeObserver = new ResizeObserver(() => debouncedRecord("resize-observer:card", 60));
    document.querySelectorAll(".home-grid .home-cat").forEach((el) => resizeObserver.observe(el));
    const gridEl = document.querySelector(".home-grid");
    if (gridEl) resizeObserver.observe(gridEl);

    // Detecta remontagem/duplicação de nós no grid e mudança na quantidade
    // de tags <style> (ex.: reinjeção do CSS de ~2300 linhas em re-render).
    const mutationObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) => m.type === "childList" || m.type === "attributes");
      if (relevant) debouncedRecord("mutation-observer:grid", 60);
    });
    if (gridEl) mutationObserver.observe(gridEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    const headMutationObserver = new MutationObserver(() => debouncedRecord("mutation-observer:style-tags", 60));
    headMutationObserver.observe(document.head, { childList: true });
    headMutationObserver.observe(document.body, { childList: true });

    return () => {
      console.error = origError;
      console.warn = origWarn;
      milestones.forEach(clearTimeout);
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("touchmove", onTouch);
      document.removeEventListener("touchend", onTouch);
      document.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      vv?.removeEventListener("resize", onVvResize);
      vv?.removeEventListener("scroll", onVvScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      headMutationObserver.disconnect();
    };
  }, [enabled]);

  if (!enabled) return null;

  const last = timeline[timeline.length - 1];
  const totalAnomalies = timeline.reduce((acc, s) => acc + s.anomalies.length, 0);

  function copyReport() {
    const report = JSON.stringify({ geradoEm: new Date().toISOString(), totalEventos: timeline.length, linhaDoTempo: timeline }, null, 2);
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
      <div>eventos na linha do tempo: {timeline.length}</div>
      <div>cards: {last?.cards.length ?? 0} · style tags: {last?.styleTagCount ?? 0}</div>
      <div>anomalias acumuladas: {totalAnomalies}</div>
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
