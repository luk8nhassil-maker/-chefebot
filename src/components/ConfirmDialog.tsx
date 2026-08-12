"use client";

import { useId, useRef } from "react";
import { useDialogA11y } from "./useDialogA11y";

export type ConfirmTom = "perigo" | "sucesso" | "atencao" | "neutro";

const COR_POR_TOM: Record<ConfirmTom, string> = {
  perigo: "var(--danger)",
  sucesso: "var(--success)",
  atencao: "var(--attention)",
  neutro: "var(--primary)",
};

/**
 * Diálogo de confirmação: uma decisão de sim/não, resolvida sem rolar e sem
 * ler parágrafo.
 *
 * Substitui cinco bottom sheets feitos à mão (limpar histórico, arquivar
 * expediente, finalizar pedido, finalizar atendimento, esgotar/disponibilizar
 * em lote) que ocupavam ~380px de altura para uma pergunta de uma linha:
 * puxador de arrasto, bloco de ícone de 48px, dois ou três parágrafos e os
 * botões empilhados (principal em cima, "Cancelar" embaixo). Aqui:
 *
 * - diálogo centrado e compacto — o tamanho acompanha o texto;
 * - pergunta em Nível 1, consequência em Nível 2, nada mais competindo;
 * - ações lado a lado, com a principal à direita e colorida pelo tom, e a
 *   secundária visivelmente secundária;
 * - acessibilidade que os overlays da mão não tinham: role/aria-modal, ESC,
 *   armadilha de foco, foco inicial na ação principal e devolução do foco.
 *
 * O que é específico de cada caso continua do lado de fora: `aviso` aceita
 * qualquer conteúdo extra (ex.: o alerta de Pix pendente das conversas).
 */
export default function ConfirmDialog({
  aberto,
  titulo,
  descricao,
  aviso,
  confirmarLabel,
  cancelarLabel = "Cancelar",
  tom = "neutro",
  ocupado = false,
  ocupadoLabel,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean;
  titulo: string;
  descricao?: React.ReactNode;
  aviso?: React.ReactNode;
  confirmarLabel: string;
  cancelarLabel?: string;
  tom?: ConfirmTom;
  ocupado?: boolean;
  ocupadoLabel?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const tituloId = useId();
  const descricaoId = useId();
  const confirmarRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useDialogA11y(aberto, () => { if (!ocupado) onCancelar(); }, { focoInicial: confirmarRef });

  if (!aberto) return null;
  const cor = COR_POR_TOM[tom];

  return (
    <div
      className="cd-backdrop"
      role="presentation"
      onClick={() => { if (!ocupado) onCancelar(); }}
    >
      <div
        ref={containerRef}
        className="cd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        aria-describedby={descricao ? descricaoId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="cd-titulo" id={tituloId}>{titulo}</p>
        {descricao && <p className="cd-descricao" id={descricaoId}>{descricao}</p>}
        {aviso && <div className="cd-aviso">{aviso}</div>}
        <div className="cd-acoes">
          <button type="button" className="cd-cancelar" onClick={onCancelar} disabled={ocupado}>
            {cancelarLabel}
          </button>
          <button
            type="button"
            ref={confirmarRef}
            className="cd-confirmar"
            style={{ background: cor }}
            onClick={onConfirmar}
            disabled={ocupado}
          >
            {ocupado ? (ocupadoLabel ?? "Aguarde...") : confirmarLabel}
          </button>
        </div>
      </div>
      <style jsx>{`
        .cd-backdrop {
          position: fixed;
          inset: 0;
          z-index: 4000;
          background: rgba(0, 0, 0, 0.62);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: cdFade 0.16s ease both;
        }
        .cd-dialog {
          width: 100%;
          max-width: 400px;
          background: var(--surface, var(--background));
          border: 1px solid var(--surface-secondary);
          border-radius: 18px;
          padding: 20px;
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
          animation: cdPop 0.18s cubic-bezier(0.2, 0.9, 0.3, 1) both;
        }
        .cd-titulo {
          margin: 0;
          font-size: 17px;
          font-weight: 900;
          letter-spacing: -0.3px;
          line-height: 1.25;
          color: var(--foreground);
        }
        .cd-descricao {
          margin: 7px 0 0;
          font-size: 13.5px;
          font-weight: 600;
          line-height: 1.5;
          color: var(--foreground-secondary);
        }
        .cd-aviso {
          margin-top: 12px;
        }
        .cd-acoes {
          display: flex;
          gap: 10px;
          margin-top: 18px;
        }
        .cd-acoes > button {
          flex: 1;
          min-height: 48px;
          border-radius: 13px;
          font-family: inherit;
          font-size: 14.5px;
          font-weight: 900;
          cursor: pointer;
          padding: 0 12px;
        }
        .cd-acoes > button:disabled {
          opacity: 0.6;
          cursor: default;
        }
        .cd-cancelar {
          flex: 0 1 38%;
          border: 1px solid var(--surface-secondary);
          background: transparent;
          color: var(--foreground-secondary);
        }
        .cd-confirmar {
          border: none;
          color: var(--foreground);
        }
        .cd-acoes > button:focus-visible {
          outline: 2px solid var(--primary);
          outline-offset: 2px;
        }
        @keyframes cdFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cdPop {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cd-backdrop, .cd-dialog { animation: none; }
        }
      `}</style>
    </div>
  );
}
