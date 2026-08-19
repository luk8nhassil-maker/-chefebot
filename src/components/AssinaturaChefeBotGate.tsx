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
  temporaryAccess?: {
    active: boolean;
    available: boolean;
    used: boolean;
    endsAt: string | null;
    remainingMs: number;
    durationMinutes: number;
  };
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

function formatarContagem(segundos: number) {
  const total = Math.max(0, Math.floor(segundos));
  const minutos = Math.floor(total / 60);
  const segundosRestantes = total % 60;
  return `${String(minutos).padStart(2, "0")}:${String(segundosRestantes).padStart(2, "0")}`;
}

export default function AssinaturaChefeBotGate() {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [planoSelecionado, setPlanoSelecionado] = useState<Plano["id"] | null>(null);
  const [message, setMessage] = useState("");
  const [gestaoAberta, setGestaoAberta] = useState(false);
  const [iniciandoTemporario, setIniciandoTemporario] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const sessaoOperacional = typeof document !== "undefined" && temSessaoOperacionalAssinatura(document.cookie);
  const ativo = sessaoOperacional && ehRotaOperacionalAssinatura(pathname);

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
    const endsAt = status?.temporaryAccess?.active ? status.temporaryAccess.endsAt : null;
    if (!endsAt) {
      setRemainingSeconds(0);
      return;
    }

    const atualizar = () => {
      const restante = Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 1000));
      setRemainingSeconds(restante);
      if (restante === 0) void carregar();
    };

    atualizar();
    const timer = window.setInterval(atualizar, 1000);
    return () => window.clearInterval(timer);
  }, [status?.temporaryAccess?.active, status?.temporaryAccess?.endsAt, carregar]);

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

  async function iniciarAcessoTemporario() {
    if (!status?.canManage || iniciandoTemporario) return;
    setIniciandoTemporario(true);
    setMessage("");
    try {
      const res = await fetch("/api/assinatura/acesso-temporario", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error === "temporary_access_already_used"
          ? "Os 60 minutos já foram usados nesta mensalidade. O sistema fica bloqueado até o pagamento."
          : data.error === "temporary_access_blocked_outside_production"
            ? "Preview seguro: a liberação real de 60 minutos está bloqueada neste ambiente."
            : "Não foi possível liberar os 60 minutos agora.");
        return;
      }
      setGestaoAberta(false);
      await carregar();
    } finally {
      setIniciandoTemporario(false);
    }
  }

  if (!ativo || !status?.ok || !status.configured) return null;

  const segundosDoServidor = status.temporaryAccess?.endsAt
    ? Math.max(0, Math.ceil((Date.parse(status.temporaryAccess.endsAt) - Date.now()) / 1000))
    : 0;
  const segundosExibidos = remainingSeconds > 0 ? remainingSeconds : segundosDoServidor;
  const acessoTemporarioAtivo = status.temporaryAccess?.active === true && segundosExibidos > 0;
  const temporarioExpirouNoCliente = status.temporaryAccess?.active === true && segundosExibidos <= 0;
  const bloqueado = status.blocked === true || temporarioExpirouNoCliente;
  const regular = status.status === "regular";
  const mensalidadeVencida = (status.daysLate ?? 0) > 0;
  const podeAbrirGestaoRegular = regular && status.canManage === true && ehRotaGestao(pathname);
  const podeFecharGestao = regular || acessoTemporarioAtivo;
  const cta = estadoCtaAssinatura({
    planoSelecionado: planoSelecionado !== null,
    regular,
    canManage: status.canManage === true,
    loading: loadingPlan !== null,
  });

  if (acessoTemporarioAtivo && !gestaoAberta) {
    return (
      <div className="fixed inset-x-0 top-0 z-[9998] flex justify-center p-3 pointer-events-none">
        <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-amber-300 bg-white p-4 text-zinc-950 shadow-2xl sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Acesso temporário ativo</p>
            <p className="mt-1 text-sm font-semibold text-zinc-700">
              Você pode usar o sistema por mais <strong className="text-zinc-950">{formatarContagem(segundosExibidos)}</strong>. Quando zerar, a tela de cobrança ficará bloqueada até o pagamento ser confirmado.
            </p>
          </div>
          {status.canManage && (
            <button
              type="button"
              onClick={() => { setMessage(""); setPlanoSelecionado(null); setGestaoAberta(true); }}
              className="shrink-0 rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-zinc-950"
            >
              Pagar agora
            </button>
          )}
        </div>
      </div>
    );
  }

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
    : acessoTemporarioAtivo
      ? `Acesso temporário — ${formatarContagem(segundosExibidos)}`
      : bloqueado
        ? "Assinatura pendente"
        : status.status === "warning"
          ? `Vencimento em ${Math.max(0, status.daysUntilDue ?? 0)} dia${status.daysUntilDue === 1 ? "" : "s"}`
          : status.status === "due"
            ? "A assinatura vence hoje"
            : `Pagamento pendente — ${status.daysLate ?? 0} dia${status.daysLate === 1 ? "" : "s"}`;

  const conteudo = (
    <div className="relative w-full max-w-3xl rounded-3xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-2xl sm:p-7">
      {podeFecharGestao && (
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
            : acessoTemporarioAtivo
              ? ` O acesso temporário termina em ${formatarContagem(segundosExibidos)}. O pagamento continua pendente e o bloqueio volta automaticamente quando o contador zerar.`
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

      {bloqueado && status.temporaryAccess?.available && status.canManage && (
        <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-black text-zinc-950">Precisa terminar alguma operação antes de pagar?</p>
          <p className="mt-1 text-xs leading-5 text-zinc-600">
            Você pode liberar o sistema uma única vez por 60 minutos nesta mensalidade. O contador continua mesmo se fechar ou atualizar a página. Depois disso, a cobrança fica bloqueante até o pagamento ser confirmado.
          </p>
          <button
            type="button"
            disabled={iniciandoTemporario}
            onClick={() => void iniciarAcessoTemporario()}
            className="mt-3 w-full rounded-xl border border-zinc-950 bg-zinc-950 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {iniciandoTemporario ? "Liberando..." : "USAR O SISTEMA POR 60 MINUTOS"}
          </button>
        </div>
      )}

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
  if (regular || acessoTemporarioAtivo) {
    return <div className="fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">{conteudo}</div>;
  }
  return <div className="fixed inset-x-0 top-0 z-[9998] flex justify-center p-3 pointer-events-none"><div className="pointer-events-auto w-full max-w-3xl">{conteudo}</div></div>;
}
