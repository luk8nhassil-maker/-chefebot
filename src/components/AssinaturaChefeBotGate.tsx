"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ehRotaOperacionalAssinatura,
  estadoCtaAssinatura,
  planoIndisponivelPorPendencia,
  temSessaoOperacionalAssinatura,
} from "@/lib/assinaturaChefeBotUi";

type Plano = {
  id: "basic" | "plus" | "pro";
  nome: string;
  valorCentavos: number;
  creditosEvolucaoMensais: number;
};

type StatusResponse = {
  ok: boolean;
  configured?: boolean;
  status?: "regular" | "warning" | "due" | "grace" | "blocked";
  blocked?: boolean;
  daysUntilDue?: number;
  daysLate?: number;
  dueDate?: string;
  currentPlanId?: Plano["id"];
  pendingDowngradePlanId?: Plano["id"] | null;
  paidThroughDate?: string | null;
  plans?: Plano[];
  canManage?: boolean;
};

const ROTAS_GESTAO = ["/admin", "/financeiro", "/configuracoes"] as const;

function moeda(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

function dataBr(data?: string) {
  if (!data) return "";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

function ehRotaGestao(pathname: string) {
  return ROTAS_GESTAO.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`));
}

/** Rotas de cupom/impressão — Gate não monta aqui (cobre window.print, iframe e agente local). */
function ehRotaImpressao(pathname: string) {
  return pathname.includes("/imprimir");
}

export default function AssinaturaChefeBotGate() {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [planoSelecionado, setPlanoSelecionado] = useState<Plano["id"] | null>(null);
  const [message, setMessage] = useState("");
  const [gestaoAberta, setGestaoAberta] = useState(false);
  const [bannerDispensado, setBannerDispensado] = useState(false);
  const [planosAbertos, setPlanosAbertos] = useState(false);

  const sessaoOperacional = typeof document !== "undefined" && temSessaoOperacionalAssinatura(document.cookie);
  // Nunca ativar em rotas de impressão — guard primário, cobre todos os caminhos de impressão.
  const ativo = sessaoOperacional && ehRotaOperacionalAssinatura(pathname) && !ehRotaImpressao(pathname);

  const carregar = useCallback(async () => {
    if (!ativo) return;
    try {
      const res = await fetch("/api/assinatura/status", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      if (data.ok) setStatus(data);
    } catch {
      // Cobrança indisponível não derruba a operação.
    }
  }, [ativo]);

  useEffect(() => {
    if (!ativo) return;
    const inicial = window.setTimeout(() => void carregar(), 0);
    const timer = window.setInterval(() => void carregar(), 15_000);
    const onFocus = () => void carregar();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(inicial);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [ativo, carregar]);

  useEffect(() => {
    if (!ativo || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("assinatura_retorno") !== "1") return;
    const orderNsu = params.get("order_nsu") || "";
    const transactionNsu = params.get("transaction_nsu") || "";
    const slug = params.get("slug") || "";
    if (!orderNsu || !transactionNsu || !slug) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/assinatura/confirmar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ orderNsu, transactionNsu, slug }),
        });
        if (!cancelled && res.ok) {
          setMessage("Pagamento confirmado. Acesso liberado.");
          setPlanoSelecionado(null);
          await carregar();
        }
      } finally {
        if (!cancelled) router.replace(pathname);
      }
    })();
    return () => { cancelled = true; };
  }, [ativo, carregar, pathname, router]);

  const planoAtual = useMemo(
    () => status?.plans?.find((plano) => plano.id === status.currentPlanId),
    [status],
  );

  async function escolherPlano(planId: Plano["id"]) {
    if (!status?.canManage || loadingPlan) return;
    setLoadingPlan(planId);
    setMessage("");
    try {
      const res = await fetch("/api/assinatura/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ planId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error === "real_checkout_blocked_in_preview"
          ? "Preview seguro: cobrança real está bloqueada neste ambiente."
          : data.error === "pay_overdue_before_plan_change"
            ? "Quite primeiro a mensalidade do plano atual. Depois da confirmação, a troca fica disponível."
            : data.error === "billing_not_configured"
              ? "A cobrança ainda não foi ativada para esta instalação."
              : "Não foi possível abrir o pagamento agora. Tente novamente em instantes.");
        return;
      }
      if (data.kind === "downgrade") {
        setMessage(`Plano menor agendado para ${dataBr(data.effectiveOn)}. Não haverá reembolso do ciclo atual.`);
        setPlanoSelecionado(null);
        await carregar();
        return;
      }
      if (data.kind === "same") {
        setMessage("Esse já é o plano ativo e não há cobrança adicional agora.");
        setPlanoSelecionado(null);
        await carregar();
        return;
      }
      if (typeof data.checkoutUrl === "string" && data.checkoutUrl.startsWith("https://")) {
        window.location.assign(data.checkoutUrl);
      }
    } finally {
      setLoadingPlan(null);
    }
  }

  if (!ativo || !status?.ok || !status.configured) return null;

  // ── Branch WARNING: banner liquid glass + modal de pagamento antecipado ──
  if (status.status === "warning") {
    const estiloGlass = {
      background: "rgba(20,20,22,0.70)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      border: "1px solid rgba(255,255,255,0.10)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
    };
    const cssPrint = `@media print { .cb-sub-ui { display: none !important; } }`;

    if (bannerDispensado && !planosAbertos) return null;

    if (!planosAbertos) {
      return (
        <>
          <style>{cssPrint}</style>
          <div className="cb-sub-ui fixed inset-x-0 top-0 z-[9998] flex justify-center p-3 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-2xl rounded-2xl p-4 sm:p-5" style={estiloGlass}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">
                    Pagar antecipado
                  </p>
                  <p className="mt-1 text-base font-bold text-white">
                    Sua assinatura vence em {Math.max(0, status.daysUntilDue ?? 0)} dia{status.daysUntilDue === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    Plano {planoAtual?.nome ?? "Básico"}
                    {planoAtual ? ` · ${moeda(planoAtual.valorCentavos)}/mês` : ""}
                    {status.dueDate ? ` · vence em ${dataBr(status.dueDate)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {status.canManage && (
                    <button
                      type="button"
                      onClick={() => { setMessage(""); setPlanoSelecionado(null); setPlanosAbertos(true); }}
                      className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-300 transition-colors"
                    >
                      Pagar antecipado
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBannerDispensado(true)}
                    aria-label="Dispensar aviso"
                    className="rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      );
    }

    // planosAbertos: modal de pagamento antecipado
    return (
      <>
        <style>{cssPrint}</style>
        <div
          className="cb-sub-ui fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-xl rounded-3xl p-5 sm:p-7" style={estiloGlass}>
            <button
              type="button"
              onClick={() => { setPlanosAbertos(false); setMessage(""); setPlanoSelecionado(null); }}
              aria-label="Fechar"
              className="absolute right-4 top-4 rounded-full p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M14 4L4 14M4 4l10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>

            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400">Pagar antecipado</p>
            <h2 className="mt-2 text-xl font-black text-white sm:text-2xl">Escolha seu plano</h2>
            <p className="mt-1.5 text-sm text-zinc-400">
              Vencimento em {dataBr(status.dueDate)}. Pagar agora evita o aviso nos próximos dias.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {status.plans?.map((plano) => {
                const atual = plano.id === status.currentPlanId;
                const selecionado = plano.id === planoSelecionado;
                const recomendado = plano.id === "plus";
                const downgradeAgendado = plano.id === status.pendingDowngradePlanId;
                const bloqueadoPorPendencia = planoIndisponivelPorPendencia({
                  blocked: false,
                  daysLate: status.daysLate ?? 0,
                  isCurrent: atual,
                });
                return (
                  <button
                    key={plano.id}
                    type="button"
                    disabled={!status.canManage || loadingPlan !== null || bloqueadoPorPendencia}
                    onClick={() => { setMessage(""); setPlanoSelecionado(plano.id); }}
                    className={`relative rounded-2xl border p-4 text-left transition ${
                      selecionado
                        ? "border-amber-500 ring-2 ring-amber-300"
                        : atual
                          ? "border-amber-500/60 ring-2 ring-amber-400/30"
                          : recomendado
                            ? "border-white/20"
                            : "border-white/10"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                    style={{ background: atual ? "rgba(255,205,0,0.08)" : "rgba(255,255,255,0.04)" }}
                  >
                    {atual && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-400 px-3 py-0.5 text-[10px] font-black uppercase text-zinc-950">
                        Seu plano
                      </span>
                    )}
                    {!atual && recomendado && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-zinc-600 px-3 py-0.5 text-[10px] font-black uppercase text-white">
                        Recomendado
                      </span>
                    )}
                    <span className="block text-sm font-bold text-white">{plano.nome}</span>
                    <span className="mt-1 block text-xl font-black tabular-nums text-white">{moeda(plano.valorCentavos)}</span>
                    <span className="mt-2 block text-xs font-medium leading-5 text-zinc-400">
                      {plano.creditosEvolucaoMensais > 0
                        ? `Até ${plano.creditosEvolucaoMensais} créditos/mês`
                        : "Evoluções à parte"}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      {selecionado
                        ? "Selecionado"
                        : downgradeAgendado
                          ? "Agendado"
                          : atual
                            ? "Pagar mensalidade"
                            : bloqueadoPorPendencia
                              ? "Quite a pendência primeiro"
                              : "Selecionar"}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={!status.canManage || loadingPlan !== null || !planoSelecionado}
              onClick={() => { if (planoSelecionado) void escolherPlano(planoSelecionado); }}
              className="mt-5 w-full rounded-2xl bg-amber-400 px-4 py-3.5 text-sm font-black text-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              {loadingPlan ? "Abrindo pagamento..." : !planoSelecionado ? "Escolha um plano" : "Continuar para o pagamento"}
            </button>

            {!status.canManage && (
              <p className="mt-3 text-sm font-semibold text-amber-400">Entre com uma conta administrativa para pagar ou trocar o plano.</p>
            )}
            {message && (
              <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white">{message}</p>
            )}
          </div>
        </div>
      </>
    );
  }
  // ── Fim branch WARNING ──

  const bloqueado = status.blocked === true;
  const regular = status.status === "regular";
  const mensalidadeVencida = (status.daysLate ?? 0) > 0;
  const podeAbrirGestaoRegular = regular && status.canManage === true && ehRotaGestao(pathname);
  const cta = estadoCtaAssinatura({
    planoSelecionado: planoSelecionado !== null,
    regular,
    canManage: status.canManage === true,
    loading: loadingPlan !== null,
  });

  if (regular && !gestaoAberta) {
    if (!podeAbrirGestaoRegular) return null;
    return (
      <button
        type="button"
        onClick={() => { setMessage(""); setPlanoSelecionado(null); setGestaoAberta(true); }}
        className="fixed bottom-5 right-5 z-[9997] rounded-full border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-900 shadow-xl"
      >
        Plano do sistema
      </button>
    );
  }

  const titulo = regular
    ? "Plano do sistema"
    : bloqueado
      ? "Assinatura pendente"
      : status.status === "warning"
        ? `Vencimento em ${Math.max(0, status.daysUntilDue ?? 0)} dia${status.daysUntilDue === 1 ? "" : "s"}`
        : status.status === "due"
          ? "A assinatura vence hoje"
          : `Pagamento pendente — ${status.daysLate ?? 0} dia${status.daysLate === 1 ? "" : "s"}`;

  const conteudo = (
    <div className="relative w-full max-w-3xl rounded-3xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-2xl sm:p-7">
      {regular && (
        <button
          type="button"
          onClick={() => { setPlanoSelecionado(null); setGestaoAberta(false); }}
          className="absolute right-4 top-4 rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-bold text-zinc-600"
        >
          Fechar
        </button>
      )}
      <div className="mb-5 pr-16">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Assinatura do ChefeBot</p>
        <h2 className="mt-2 text-2xl font-black sm:text-3xl">{titulo}</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Plano atual: <strong>{planoAtual?.nome ?? "Básico"}</strong>. Vencimento: <strong>{dataBr(status.dueDate)}</strong>.
          {regular
            ? " Sua assinatura está em dia. Você pode trocar de plano quando quiser."
            : mensalidadeVencida
              ? " A mensalidade pendente mantém o valor do plano daquele ciclo. Quite a pendência antes de trocar de plano."
              : bloqueado
                ? " O acesso operacional será liberado automaticamente após a confirmação do pagamento."
                : " Você pode pagar agora ou trocar de plano."}
        </p>
        <p className="mt-2 text-xs leading-5 text-zinc-500">
          Todos os planos mantêm as funcionalidades disponíveis e a gestão autônoma do cardápio/configurações. Projetos de maior complexidade são orçados à parte.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {status.plans?.map((plano) => {
          const atual = plano.id === status.currentPlanId;
          const selecionado = plano.id === planoSelecionado;
          const recomendado = plano.id === "plus";
          const downgradeAgendado = plano.id === status.pendingDowngradePlanId;
          const trocaBloqueadaPorPendencia = planoIndisponivelPorPendencia({
            blocked: bloqueado,
            daysLate: status.daysLate ?? 0,
            isCurrent: atual,
          });
          const descricaoEvolucao = plano.creditosEvolucaoMensais > 0
            ? `Evoluções personalizadas: até ${plano.creditosEvolucaoMensais} créditos/mês`
            : "Evoluções personalizadas: cobradas à parte";
          return (
            <button
              key={plano.id}
              type="button"
              disabled={!status.canManage || loadingPlan !== null || trocaBloqueadaPorPendencia}
              onClick={() => { setMessage(""); setPlanoSelecionado(plano.id); }}
              className={`relative rounded-2xl border p-4 text-left transition ${
                selecionado
                  ? "border-amber-500 ring-2 ring-amber-300 shadow-md"
                  : atual
                    ? "border-zinc-950 ring-2 ring-zinc-950/10"
                    : recomendado
                      ? "border-amber-400 ring-2 ring-amber-200/70 shadow-md"
                      : "border-zinc-200"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {recomendado && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-3 py-1 text-[10px] font-black uppercase text-zinc-950">Recomendado</span>}
              <span className="block text-sm font-bold">{plano.nome}</span>
              <span className="mt-1 block text-xl font-black">{moeda(plano.valorCentavos)}</span>
              <span className="mt-2 block text-xs font-medium leading-5 text-zinc-600">{descricaoEvolucao}</span>
              <span className="mt-2 block text-xs text-zinc-500">
                {selecionado
                  ? "Selecionado"
                  : downgradeAgendado
                    ? "Agendado para o próximo vencimento"
                    : atual && (mensalidadeVencida || bloqueado)
                      ? "Pagar mensalidade atual"
                      : atual
                        ? "Plano atual"
                        : trocaBloqueadaPorPendencia
                          ? "Disponível após quitar a pendência"
                          : "Selecionar plano"}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={cta.disabled}
        onClick={() => { if (planoSelecionado) void escolherPlano(planoSelecionado); }}
        className="mt-4 w-full rounded-2xl bg-amber-400 px-4 py-3.5 text-sm font-black text-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
      >
        {loadingPlan ? "Abrindo pagamento..." : cta.label}
      </button>

      <p className="mt-4 text-xs leading-5 text-zinc-500">
        Upgrade com ciclo já pago: diferença proporcional aos dias restantes, cobrada na hora. Downgrade: entra no próximo vencimento, sem reembolso.
      </p>
      {!status.canManage && <p className="mt-3 text-sm font-semibold text-amber-700">Entre com uma conta administrativa para pagar ou trocar o plano.</p>}
      {message && <p className="mt-3 rounded-xl bg-zinc-100 px-3 py-2 text-sm font-semibold">{message}</p>}
    </div>
  );

  if (bloqueado) {
    return <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">{conteudo}</div>;
  }
  if (regular) {
    return <div className="fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">{conteudo}</div>;
  }
  return <div className="fixed inset-x-0 top-0 z-[9998] flex justify-center p-3 pointer-events-none"><div className="pointer-events-auto w-full max-w-3xl">{conteudo}</div></div>;
}
