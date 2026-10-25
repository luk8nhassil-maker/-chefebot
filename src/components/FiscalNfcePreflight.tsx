"use client";

import { useState } from "react";
import type { PreparoNfce } from "@/lib/fiscal/nfcePreflight";

type Resposta = ({ ok: true } & PreparoNfce) | { ok: false; error: string };

const brl = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);

/**
 * Proposta de UX fiscal, atrás de flag desligada por padrão.
 * Sem cadastro/credenciais e homologação fiscal, o operador jamais vê
 * um botão que pareça ter emitido documento autorizado.
 */
export default function FiscalNfcePreflight({ pedidoId }: { pedidoId: string }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [resposta, setResposta] = useState<Resposta | null>(null);

  async function abrir() {
    setAberto(true);
    setCarregando(true);
    setResposta(null);
    try {
      const response = await fetch(
        `/api/fiscal/nfce/preparar?pedidoId=${encodeURIComponent(pedidoId)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const json = await response.json() as Resposta;
      setResposta(json);
    } catch {
      setResposta({ ok: false, error: "Não foi possível conferir os dados do pedido." });
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        style={{
          minHeight: 44, padding: "10px 14px", borderRadius: 14,
          border: "1px solid var(--border)", background: "var(--surface)",
          color: "var(--foreground)", fontSize: 14, fontWeight: 800,
          cursor: "pointer",
        }}
      >
        Emitir NF
      </button>
      {aberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Conferir nota fiscal"
          style={{
            position: "fixed", inset: 0, zIndex: 1100,
            background: "rgba(0, 0, 0, .66)", padding: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <section style={{
            width: "100%", maxWidth: 450, maxHeight: "85vh", overflowY: "auto",
            background: "var(--surface)", color: "var(--foreground)",
            border: "1px solid var(--border)", borderRadius: 20,
            padding: 20, display: "grid", gap: 16,
          }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 22 }}>Nota fiscal</h2>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--foreground-secondary)" }}>
                  Pré-conferência do pedido — ainda não é uma nota emitida.
                </p>
              </div>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar conferência fiscal"
                style={{ background: "transparent", border: "none", color: "var(--foreground)", fontSize: 24, cursor: "pointer" }}>
                ×
              </button>
            </header>
            {carregando && <p role="status">Conferindo pedido…</p>}
            {!carregando && resposta && !resposta.ok && (
              <p role="alert" style={{ color: "var(--danger)" }}>{resposta.error}</p>
            )}
            {!carregando && resposta?.ok && (
              <>
                <div style={{
                  padding: 12, borderRadius: 12, background: "var(--surface-secondary)",
                  display: "grid", gap: 8,
                }}>
                  <strong style={{ fontSize: 13 }}>Conferência do pedido</strong>
                  {resposta.resumo ? (
                    <>
                      {resposta.resumo.itens.map((item, index) => (
                        <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                          <span>{item.quantidade}× {item.nome}</span>
                          <span style={{ whiteSpace: "nowrap" }}>{brl(item.totalCentavos)}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "flex", justifyContent: "space-between", fontWeight: 900 }}>
                        <span>Total do pedido</span>
                        <span>{brl(resposta.resumo.totalCentavos)}</span>
                      </div>
                    </>
                  ) : <p style={{ margin: 0, fontSize: 13 }}>Dados insuficientes para conferir a composição fiscal.</p>}
                </div>
                <div role="status" style={{
                  background: "var(--attention-surface)", color: "var(--attention-text)",
                  borderRadius: 12, padding: 12, fontSize: 13,
                }}>
                  <strong>Emissão ainda indisponível</strong>
                  <p style={{ margin: "6px 0 0" }}>Antes de emitir, falta concluir o credenciamento e conferir as regras fiscais.</p>
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: "var(--foreground-secondary)", display: "grid", gap: 6 }}>
                  {resposta.motivos.map(motivo => <li key={motivo}>{motivo}</li>)}
                </ul>
              </>
            )}
            <button type="button" disabled style={{
              height: 48, width: "100%", border: 0, borderRadius: 12,
              background: "var(--surface-secondary)", color: "var(--foreground-muted)",
              fontSize: 14, fontWeight: 900, cursor: "not-allowed",
            }}>Emitir NFC-e — aguardando habilitação fiscal</button>
            <button type="button" onClick={() => setAberto(false)} style={{
              minHeight: 44, border: "1px solid var(--border)", borderRadius: 12,
              background: "transparent", color: "var(--foreground)", fontWeight: 800,
            }}>Fechar</button>
          </section>
        </div>
      )}
    </>
  );
}
