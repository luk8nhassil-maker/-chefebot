"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Banknote, CircleAlert, LoaderCircle, ReceiptText, RefreshCw } from "lucide-react";
import { gerarClientRequestId } from "@/survival/clientRequestId";
import { norm } from "@/lib/pedidoAppItens";

type Conta = {
  status: "aberta" | "conta_solicitada" | "fechando" | "fechada";
  contaSolicitadaEm?: string;
};

type Comanda = {
  id: string;
  numero: number;
  cliente: string;
  mesa?: string;
  complemento?: string;
  conta: Conta;
  totalAtivoCentavos: number;
  todosServidos: boolean;
  temRodadaEmAndamento: boolean;
};

type FormPagamento = {
  forma: string;
  troco: string;
  valorPix: string;
  valorDinheiro: string;
};

const VAZIO: FormPagamento = { forma: "", troco: "", valorPix: "", valorDinheiro: "" };

function moeda(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

function ehDinheiro(valor: string) {
  return norm(valor).includes("dinheiro");
}

function ehMisto(valor: string) {
  const n = norm(valor);
  return n.includes("misto") || (n.includes("pix") && n.includes("dinheiro"));
}

export default function CaixaSalaoPage() {
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [pagamentos, setPagamentos] = useState<string[]>([]);
  const [formularios, setFormularios] = useState<Record<string, FormPagamento>>({});
  const [carregando, setCarregando] = useState(true);
  const [processando, setProcessando] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const requestIds = useRef<Record<string, string>>({});

  const carregar = useCallback(async () => {
    try {
      const [operacaoRes, cardapioRes] = await Promise.all([
        fetch("/api/salao/operacao", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/cardapio", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const [operacao, cardapio] = await Promise.all([
        operacaoRes.json().catch(() => null),
        cardapioRes.json().catch(() => null),
      ]);
      if (!operacaoRes.ok || !operacao?.ok || !Array.isArray(operacao.comandas)) {
        setErro(operacao?.error || "Não foi possível carregar as comandas do Salão.");
        return;
      }
      if (!cardapioRes.ok || !Array.isArray(cardapio?.payments)) {
        setErro("Não foi possível carregar as formas oficiais de pagamento.");
        return;
      }
      setComandas(operacao.comandas);
      setPagamentos(cardapio.payments.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0));
      setErro("");
    } catch {
      setErro("Não foi possível atualizar o caixa agora.");
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

  const aguardando = useMemo(
    () => comandas.filter((comanda) => comanda.conta.status === "conta_solicitada" || comanda.conta.status === "fechando"),
    [comandas],
  );

  function atualizarFormulario(id: string, patch: Partial<FormPagamento>) {
    setFormularios((atuais) => ({ ...atuais, [id]: { ...(atuais[id] ?? VAZIO), ...patch } }));
  }

  async function fechar(comanda: Comanda) {
    if (processando) return;
    const formulario = formularios[comanda.id] ?? VAZIO;
    if (!formulario.forma) {
      setErro("Escolha a forma de pagamento antes de fechar a conta.");
      return;
    }

    let requestId = requestIds.current[comanda.id];
    if (!requestId) {
      try {
        requestId = gerarClientRequestId();
      } catch {
        setErro("Não foi possível gerar uma identificação segura para o fechamento.");
        return;
      }
      requestIds.current[comanda.id] = requestId;
    }

    setProcessando(comanda.id);
    setErro("");
    try {
      const response = await fetch(`/api/salao/caixa/${comanda.id}/fechar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId,
          totalEsperadoCentavos: comanda.totalAtivoCentavos,
          pagamento: formulario.forma,
          ...(ehDinheiro(formulario.forma) && !ehMisto(formulario.forma) ? { troco: formulario.troco || "Sem troco" } : {}),
          ...(ehMisto(formulario.forma) ? { valorPix: formulario.valorPix, valorDinheiro: formulario.valorDinheiro } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setErro(data?.error || "Não foi possível fechar esta conta.");
        // Erros determinísticos significam que nenhum fechamento ficou
        // pendente. Em falha 5xx/rede, mantemos o mesmo requestId para retry.
        if (response.status < 500) delete requestIds.current[comanda.id];
        await carregar();
        return;
      }
      delete requestIds.current[comanda.id];
      setFormularios((atuais) => {
        const novos = { ...atuais };
        delete novos[comanda.id];
        return novos;
      });
      await carregar();
    } catch {
      setErro("Não foi possível confirmar se o fechamento terminou. Não repita com outro pagamento; tente novamente nesta mesma tela.");
    } finally {
      setProcessando(null);
    }
  }

  if (carregando) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "var(--background)" }}><LoaderCircle className="animate-spin" /></main>;
  }

  return (
    <main style={{ minHeight: "100dvh", background: "var(--background)", color: "var(--foreground)", padding: "20px 16px 90px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, color: "var(--brand-text)", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>Caixa · Salão</p>
            <h1 style={{ margin: "4px 0 0", fontSize: 28 }}>Contas aguardando pagamento</h1>
            <p style={{ margin: "7px 0 0", color: "var(--foreground-secondary)", fontSize: 14 }}>O total é relido no servidor antes de fechar. Nenhum preço desta tela é aceito como autoridade.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => void carregar()} style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 11, padding: "10px 12px", color: "var(--foreground)", fontWeight: 800, cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}><RefreshCw size={15} /> Atualizar</button>
            <Link href="/pedidos" style={{ border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 11, padding: "10px 12px", color: "var(--foreground)", fontWeight: 800, textDecoration: "none" }}>Pedidos</Link>
          </div>
        </header>

        {erro && <div role="alert" style={{ padding: 12, borderRadius: 12, background: "var(--danger-soft)", color: "var(--danger)", fontWeight: 700, display: "flex", gap: 8 }}><CircleAlert size={18} /> {erro}</div>}

        {aguardando.length === 0 ? (
          <section style={{ border: "1px solid var(--border)", borderRadius: 18, background: "var(--surface)", padding: 28, textAlign: "center" }}>
            <ReceiptText size={28} style={{ marginBottom: 8 }} />
            <strong style={{ display: "block" }}>Nenhuma conta aguardando</strong>
            <span style={{ color: "var(--foreground-secondary)", fontSize: 13 }}>As comandas aparecem aqui somente depois de “Pedir conta” no Salão.</span>
          </section>
        ) : aguardando.map((comanda) => {
          const form = formularios[comanda.id] ?? VAZIO;
          const misto = ehMisto(form.forma);
          const dinheiro = ehDinheiro(form.forma) && !misto;
          const emFechamento = comanda.conta.status === "fechando";
          return (
            <section key={comanda.id} style={{ border: "1px solid var(--border)", borderRadius: 20, background: "var(--surface)", overflow: "hidden" }}>
              <div style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <span style={{ color: "var(--brand-text)", fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>Comanda #{comanda.numero}</span>
                  <h2 style={{ margin: "4px 0 0", fontSize: 21 }}>{comanda.cliente}</h2>
                  <p style={{ margin: "3px 0 0", color: "var(--foreground-secondary)", fontSize: 13 }}>{comanda.mesa ? `Mesa ${comanda.mesa}${comanda.complemento ? ` · ${comanda.complemento}` : ""}` : "Sem mesa"}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ display: "block", color: "var(--foreground-secondary)", fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>Total da conta</span>
                  <strong style={{ fontSize: 25 }}>{moeda(comanda.totalAtivoCentavos)}</strong>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", padding: 16, display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>
                  Forma de pagamento
                  <select value={form.forma} disabled={emFechamento || processando !== null} onChange={(event) => atualizarFormulario(comanda.id, { forma: event.target.value, troco: "", valorPix: "", valorDinheiro: "" })} style={{ height: 46, borderRadius: 11, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "0 12px", fontWeight: 700 }}>
                    <option value="">Selecione</option>
                    {pagamentos.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
                  </select>
                </label>

                {dinheiro && (
                  <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>
                    Troco
                    <input value={form.troco} onChange={(event) => atualizarFormulario(comanda.id, { troco: event.target.value })} placeholder="Sem troco ou valor recebido" inputMode="decimal" style={{ height: 46, borderRadius: 11, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "0 12px", fontWeight: 700 }} />
                  </label>
                )}

                {misto && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>Valor no Pix<input value={form.valorPix} onChange={(event) => atualizarFormulario(comanda.id, { valorPix: event.target.value })} inputMode="decimal" style={{ height: 46, borderRadius: 11, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "0 12px", fontWeight: 700 }} /></label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 900 }}>Valor em Dinheiro<input value={form.valorDinheiro} onChange={(event) => atualizarFormulario(comanda.id, { valorDinheiro: event.target.value })} inputMode="decimal" style={{ height: 46, borderRadius: 11, border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", padding: "0 12px", fontWeight: 700 }} /></label>
                  </div>
                )}

                {emFechamento && <p style={{ margin: 0, color: "var(--attention-text)", fontWeight: 800, fontSize: 13 }}>Um fechamento já foi iniciado. Use o mesmo botão para reconciliar a tentativa, não registre outro pagamento.</p>}

                <button disabled={!form.forma || processando !== null} onClick={() => void fechar(comanda)} style={{ height: 48, border: 0, borderRadius: 12, background: form.forma ? "var(--primary)" : "var(--border)", color: "var(--foreground)", fontWeight: 900, cursor: form.forma ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Banknote size={18} /> {processando === comanda.id ? "Fechando conta…" : "Confirmar pagamento e fechar"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
