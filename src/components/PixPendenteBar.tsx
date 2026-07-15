"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { CLIENT_BOTTOM_NAV_HEIGHT_PX } from "@/components/ClientBottomNav";
import {
  lerReferenciaPixPendenteDoStorage,
  limparReferenciaPixPendente,
  resolverPixPendenteAPartirDaResposta,
  type PixPendenteResolvido,
  type ReferenciaPixPendente,
} from "@/lib/pixPendenteLocal";

// Altura real renderizada da barra (sem safe-area, que entra só no
// deslocamento `bottom`) — medida via getBoundingClientRect em 390×844,
// 390×667 e 1440×900 com uma pendência real: 60.5px. Layout de duas linhas
// (badge "Pagamento pendente" + linha de contexto/valor) é o elemento mais
// alto, não o CTA. Mantida como constante para o espaçador nunca
// dessincronizar do CSS real caso o conteúdo da barra mude.
export const PIX_PENDENTE_BAR_HEIGHT_PX = 61;

export type PixPendente = PixPendenteResolvido;

type RespostaPagamentoPix = {
  ok?: boolean;
  numero?: number;
  valorPix?: number;
  estado?: "aguardando" | "confirmado" | "em_analise" | "indisponivel";
};

// Hook central do fluxo de "Pix pendente" (Etapa 2). Nunca confia na
// referência local como prova de pendência — ela só indica QUAL pedido
// checar. O backend (GET /api/pedido-app/pagamento-pix) é sempre quem
// decide se a barra deve aparecer. Usar uma vez por página e repassar o
// resultado tanto para <PixPendenteBar /> quanto para o indicador do
// ClientBottomNav, evitando duas checagens de rede na mesma tela.
export function usePixPendente() {
  const [pendente, setPendente] = useState<PixPendente | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const verificar = useCallback(async () => {
    let ref: ReferenciaPixPendente | null = null;
    try {
      ref = lerReferenciaPixPendenteDoStorage(localStorage);
    } catch {
      ref = null;
    }
    if (!ref) {
      setPendente(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/pedido-app/pagamento-pix?token=${encodeURIComponent(ref.statusToken)}`, {
        cache: "no-store",
      });
      // Token inválido/pedido não encontrado (404) é representado como
      // `resposta: null` — mesma regra pura usada pelos testes (nunca fica
      // presa exibindo uma pendência que o backend não confirma).
      const data = res.ok ? ((await res.json()) as RespostaPagamentoPix) : null;
      const { pendente: resolvido, deveLimpar } = resolverPixPendenteAPartirDaResposta(ref, data);
      if (deveLimpar) limparReferenciaPixPendente(localStorage);
      setPendente(resolvido);
    } catch {
      // Falha de rede: mantém o estado anterior, tenta de novo no próximo
      // ciclo — nunca limpa a referência por causa de um erro transitório.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    verificar();

    function tick() {
      if (document.visibilityState === "visible") verificar();
    }
    intervalRef.current = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [verificar]);

  return { pendente, loading };
}

function money(v: number) {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

// Fixa imediatamente acima do ClientBottomNav (nunca sobrepõe: usa a altura
// real do nav, CLIENT_BOTTOM_NAV_HEIGHT_PX, como offset de `bottom`) e some
// por completo da árvore quando não há pendência — inclusive o espaçador,
// que só existe para abrir espaço no fluxo normal da página enquanto a
// barra (fixa, fora do fluxo) está de fato visível.
//
// Visual "glass" (vidro escuro translúcido, sempre sobre --secondary/navy
// independente do tema Light/Dark do site): resolve o problema de a barra
// se confundir com cards claros atrás dela — um painel escuro com blur real
// garante contraste alto de texto sobre qualquer conteúdo. Só a camada
// visual muda aqui; posicionamento, hook, dados e navegação são os mesmos.
export default function PixPendenteBar({ pendente }: { pendente: PixPendente | null }) {
  if (!pendente) return null;

  // Mostra o valor efetivamente pendente no Pix (valorPix) — em pedido
  // misto é só a parcela do Pix, nunca o total do pedido; em Pix integral
  // coincide com o total (ver calcularDivisaoPixDinheiro/valorPixEsperado).
  const contexto = pendente.numero ? `Pedido #${pendente.numero}` : "Seu pedido";

  return (
    <>
      <div className="pix-pendente-bar-spacer" aria-hidden="true" />
      <a
        className="pix-pendente-bar"
        href={`/pedido/pagamento/${pendente.statusToken}`}
        role="status"
        aria-live="polite"
      >
        <span className="pix-pendente-bar-icon" aria-hidden="true">
          <Zap size={14} />
        </span>
        <span className="pix-pendente-bar-content">
          <span className="pix-pendente-bar-badge">
            <span className="pix-pendente-bar-dot" aria-hidden="true" />
            Pagamento pendente
          </span>
          <span className="pix-pendente-bar-info">
            {contexto} <span className="pix-pendente-bar-sep">·</span>{" "}
            <strong className="pix-pendente-bar-valor">{money(pendente.valorPix)}</strong>
          </span>
        </span>
        <span className="pix-pendente-bar-cta">Pagar agora</span>
      </a>
      <style>{`
        .pix-pendente-bar-spacer{flex-shrink:0;height:${PIX_PENDENTE_BAR_HEIGHT_PX}px}
        .pix-pendente-bar{
          position:fixed;left:50%;transform:translateX(-50%);
          bottom:calc(${CLIENT_BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom));
          display:flex;align-items:center;gap:11px;
          width:100%;max-width:540px;box-sizing:border-box;
          padding:9px 13px;
          background:color-mix(in srgb, var(--secondary) 86%, transparent);
          -webkit-backdrop-filter:blur(20px) saturate(160%);
          backdrop-filter:blur(20px) saturate(160%);
          border-top:1px solid color-mix(in srgb, var(--secondary-foreground) 14%, transparent);
          border-left:1px solid color-mix(in srgb, var(--secondary-foreground) 14%, transparent);
          border-right:1px solid color-mix(in srgb, var(--secondary-foreground) 14%, transparent);
          box-shadow:0 -12px 28px -12px color-mix(in srgb, var(--secondary) 60%, transparent), inset 0 1px 0 color-mix(in srgb, var(--secondary-foreground) 8%, transparent);
          color:var(--secondary-foreground);
          text-decoration:none;
          z-index:55;
        }
        .pix-pendente-bar-icon{
          width:30px;height:30px;border-radius:999px;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;
          background:color-mix(in srgb, var(--secondary-foreground) 13%, transparent);
          border:1px solid color-mix(in srgb, var(--secondary-foreground) 18%, transparent);
          color:var(--primary);
        }
        .pix-pendente-bar-content{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
        .pix-pendente-bar-badge{
          align-self:flex-start;display:inline-flex;align-items:center;gap:5px;
          background:color-mix(in srgb, var(--attention) 46%, transparent);
          color:var(--secondary-foreground);
          font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;
          padding:2px 8px 2px 6px;border-radius:999px;line-height:1.5;
        }
        .pix-pendente-bar-dot{width:5px;height:5px;border-radius:999px;background:var(--secondary-foreground);flex-shrink:0}
        .pix-pendente-bar-info{
          font-size:12.5px;font-weight:600;
          color:color-mix(in srgb, var(--secondary-foreground) 88%, transparent);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .pix-pendente-bar-sep{opacity:.55}
        .pix-pendente-bar-valor{font-size:13.5px;font-weight:800;color:var(--secondary-foreground)}
        .pix-pendente-bar-cta{
          flex-shrink:0;background:var(--primary);color:var(--primary-foreground);
          font-size:12.5px;font-weight:800;padding:8px 14px;border-radius:999px;white-space:nowrap;
        }
      `}</style>
    </>
  );
}
