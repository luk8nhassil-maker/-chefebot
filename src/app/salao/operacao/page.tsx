"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, ReceiptText, RotateCcw, UtensilsCrossed } from "lucide-react";

type StatusConta = "aberta" | "conta_solicitada" | "fechando" | "fechada";

type Envio = {
  rodadaId: string;
  numero: number;
  pedidoId?: string;
  subtotalCentavos: number;
  status?: "novo" | "em_preparo" | "saiu_entrega" | "entregue" | "cancelado";
  estado: {
    rotulo: string;
    orientacao: string;
    tom: "neutro" | "atencao" | "sucesso" | "perigo";
  };
};

type Comanda = {
  id: string;
  numero: number;
  cliente: string;
  mesa?: string;
  complemento?: string;
  abertaEm: string;
  conta: { status: StatusConta; contaSolicitadaEm?: string };
  totalAtivoCentavos: number;
  todosServidos: boolean;
  temRodadaEmAndamento: boolean;
  envios: Envio[];
};

function moeda(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

function identificacaoMesa(comanda: Comanda) {
  if (!comanda.mesa) return "Sem mesa";
  return `Mesa ${comanda.mesa}${comanda.complemento ? ` · ${comanda.complemento}` : ""}`;
}

function corEstado(tom: Envio["estado"]["tom"]) {
  if (tom === "perigo") return "var(--danger)";
  if (tom === "sucesso") return "var(--success)";
  if (tom === "atencao") return "var(--attention-text)";
  return "var(--foreground-secondary)";
}

export default function SalaoOperacaoPage() {
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [processando, setProcessando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const response = await fetch("/api/salao/operacao", { cache: "no-store", credentials: "same-origin" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !Array.isArray(data.comandas)) {
        setErro(data?.error || "Não foi possível atualizar as comandas.");
        return;
      }
      setComandas(data.comandas);
      setErro("");
    } catch {
      setErro("Sem conexão com a operação agora. Os dados antigos não serão tratados como atuais.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
    const timer = window.setInterval(() => void carregar(), 4000);
    const onFocus = () => void carregar();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [carregar]);

  const ordenadas = useMemo(() => [...comandas].sort((a, b) => {
    const aPronto = a.envios.some((envio) => envio.status === "saiu_entrega") ? 0 : 1;
    const bPronto = b.envios.some((envio) => envio.status === "saiu_entrega") ? 0 : 1;
    if (aPronto !== bPronto) return aPronto - bPronto;
    return new Date(a.abertaEm).getTime() - new Date(b.abertaEm).getTime();
  }), [comandas]);

  async function agir(chave: string, url: string, body?: unknown) {
    if (processando) return;
    setProcessando(chave);
    setErro("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        credentials: "same-origin",
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setErro(data?.error || "A ação não pôde ser concluída.");
        return;
      }
      await carregar();
    } catch {
      setErro("Não foi possível confirmar a ação. Atualize antes de tentar de novo.");
    } finally {
      setProcessando(null);
    }
  }

  if (carregando) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--background)" }}><LoaderCircle className="animate-spin" /></main>;
  }

  return (
    <main style={{ minHeight: "100dvh", background: "var(--background)", color: "var(--foreground)", padding: "20px 16px 96px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 900, color: "var(--brand-text)", letterSpacing: ".08em", textTransform: "uppercase" }}>Salão</p>
            <h1 style={{ margin: "4px 0 0", fontSize: 28, lineHeight: 1.05 }}>Operação das mesas</h1>
            <p style={{ margin: "7px 0 0", color: "var(--foreground-secondary)", fontSize: 14 }}>Acompanhe cozinha, serviço e conta sem misturar o Salão com Delivery.</p>
          </div>
          <Link href="/salao" style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 12, padding: "11px 14px", color: "var(--foreground)", fontWeight: 800 }}>Fazer pedido</Link>
        </header>

        {erro && (
          <div role="alert" style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: 12, borderRadius: 12, background: "var(--danger-soft)", color: "var(--danger)", fontWeight: 700 }}>
            <CircleAlert size={18} style={{ flexShrink: 0 }} /> {erro}
          </div>
        )}

        {ordenadas.length === 0 ? (
          <section style={{ padding: 28, border: "1px solid var(--border)", borderRadius: 18, background: "var(--surface)", textAlign: "center" }}>
            <UtensilsCrossed size={28} style={{ marginBottom: 8 }} />
            <strong style={{ display: "block" }}>Nenhuma comanda aberta</strong>
            <span style={{ color: "var(--foreground-secondary)", fontSize: 13 }}>Quando uma mesa iniciar atendimento, ela aparecerá aqui.</span>
          </section>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {ordenadas.map((comanda) => {
              const contaSolicitada = comanda.conta.status === "conta_solicitada";
              const fechando = comanda.conta.status === "fechando";
              const podePedirConta = comanda.todosServidos && !comanda.temRodadaEmAndamento && comanda.conta.status === "aberta";
              return (
                <section key={comanda.id} style={{ border: "1px solid var(--border)", borderRadius: 20, background: "var(--surface)", overflow: "hidden" }}>
                  <div style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 900, color: "var(--brand-text)", textTransform: "uppercase" }}>Comanda #{comanda.numero}</span>
                      <h2 style={{ margin: "4px 0 0", fontSize: 20 }}>{comanda.cliente}</h2>
                      <p style={{ margin: "3px 0 0", color: "var(--foreground-secondary)", fontSize: 13 }}>{identificacaoMesa(comanda)}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ display: "block", fontSize: 11, color: "var(--foreground-secondary)", fontWeight: 800, textTransform: "uppercase" }}>Total ativo</span>
                      <strong style={{ fontSize: 21 }}>{moeda(comanda.totalAtivoCentavos)}</strong>
                    </div>
                  </div>

                  <div style={{ padding: "0 16px 16px", display: "grid", gap: 9 }}>
                    {comanda.envios.map((envio) => (
                      <div key={envio.rodadaId} style={{ padding: 12, borderRadius: 14, background: "var(--background)", display: "grid", gap: 7 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                          <div>
                            <strong style={{ fontSize: 13 }}>{envio.numero === 1 ? "Pedido inicial" : `Complemento ${envio.numero - 1}`}</strong>
                            <span style={{ marginLeft: 8, color: corEstado(envio.estado.tom), fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{envio.estado.rotulo}</span>
                          </div>
                          <strong style={{ fontSize: 13 }}>{moeda(envio.subtotalCentavos)}</strong>
                        </div>
                        <span style={{ fontSize: 12.5, color: "var(--foreground-secondary)", lineHeight: 1.4 }}>{envio.estado.orientacao}</span>
                        {envio.status === "saiu_entrega" && envio.pedidoId && !contaSolicitada && !fechando && (
                          <button
                            type="button"
                            disabled={processando !== null}
                            onClick={() => void agir(`servir:${envio.pedidoId}`, `/api/salao/comandas/${comanda.id}/envios/${envio.pedidoId}/servir`)}
                            style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 10, padding: "9px 12px", background: "var(--success)", color: "white", fontWeight: 900, cursor: "pointer" }}
                          >
                            <CheckCircle2 size={16} /> {processando === `servir:${envio.pedidoId}` ? "Confirmando…" : "Marcar como servido"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ borderTop: "1px solid var(--border)", padding: 14, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {contaSolicitada ? (
                      <>
                        <span style={{ marginRight: "auto", display: "inline-flex", alignItems: "center", gap: 7, color: "var(--attention-text)", fontSize: 13, fontWeight: 800 }}><ReceiptText size={16} /> Conta solicitada. Aguardando o caixa.</span>
                        <button type="button" disabled={processando !== null} onClick={() => void agir(`reabrir:${comanda.id}`, `/api/salao/comandas/${comanda.id}/conta`, { acao: "reabrir" })} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", background: "transparent", color: "var(--foreground)", fontWeight: 900, cursor: "pointer" }}>
                          <RotateCcw size={16} /> {processando === `reabrir:${comanda.id}` ? "Reabrindo…" : "Continuar atendimento"}
                        </button>
                      </>
                    ) : fechando ? (
                      <span style={{ marginRight: "auto", display: "inline-flex", alignItems: "center", gap: 7, color: "var(--attention-text)", fontSize: 13, fontWeight: 800 }}><Clock3 size={16} /> Pagamento em processamento no caixa.</span>
                    ) : (
                      <button type="button" disabled={!podePedirConta || processando !== null} title={!podePedirConta ? "Todos os pedidos precisam estar servidos e sem pedido em edição." : undefined} onClick={() => void agir(`conta:${comanda.id}`, `/api/salao/comandas/${comanda.id}/conta`, { acao: "solicitar" })} style={{ border: 0, borderRadius: 10, padding: "10px 14px", background: podePedirConta ? "var(--primary)" : "var(--border)", color: "var(--foreground)", fontWeight: 900, cursor: podePedirConta ? "pointer" : "not-allowed" }}>
                        {processando === `conta:${comanda.id}` ? "Solicitando…" : "Pedir conta"}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
