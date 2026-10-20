"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Queue = {
  queuedTotal: number; doneTotal: number; ambiguousTotal: number; unresolved: number;
  pending: number; inFlight: number; lastWorkerAt: number;
};
type Readiness = {
  status: "saudavel" | "observando" | "problema";
  motivos: string[];
  processamentoLocalConfirmado: boolean;
  recuperacaoConfigurada: boolean;
  capacidadeGeralComprovada: false;
  liberacaoGeralAutorizada: false;
};
type Traffic = {
  total7d: number;
  coberturaDias: number;
  suficienteParaRepresentatividade: boolean;
  desde: number | null;
  fuso: string;
  observacao: string;
  picoHora: { data: string; hora: number; mensagens: number } | null;
  picoMinuto: { quando: string; mensagens: number } | null;
  dias: Array<{ data: string; total: number; picoMinuto: number; picoMinutoEm: string | null; horas: number[] }>;
};
type Monitor = {
  checkedAt: number;
  active: boolean;
  rollout: string;
  allowedPhoneCount: number;
  agendaRecuperacao: string;
  queue: Queue;
  trafego: Traffic;
  avaliacao: Readiness;
  note: string;
};

const panel: React.CSSProperties = {
  background: "var(--card, #171717)", border: "1px solid var(--border, #414141)",
  borderRadius: 14, padding: 20,
};
const toNumber = (n: number) => Number.isFinite(n) ? n.toLocaleString("pt-BR") : "—";

export default function MonitorFilaWhatsappDevPage() {
  const [data, setData] = useState<Monitor | null>(null);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dev/whatsapp/inbox-status", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403
        ? "Acesso exclusivo para desenvolvedores autenticados."
        : "Não foi possível ler a fila com segurança.");
      const json: Monitor = await res.json();
      if (!json.queue || !json.avaliacao || !json.trafego) throw new Error("Diagnóstico incompleto.");
      setData(json);
      setError("");
      setUpdatedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dados indisponíveis.");
      setData(null); // Nunca exibir situação antiga como se fosse atual.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const queue = data?.queue;
  const readiness = data?.avaliacao;
  const trafego = data?.trafego;
  const horas = trafego ? Array.from({ length: 24 }, (_, hora) => ({
    hora, quantidade: trafego.dias.reduce((total, dia) => total + (dia.horas[hora] || 0), 0),
  })) : [];
  const maiorHora = Math.max(1, ...horas.map(h => h.quantidade));
  const summary = !readiness ? "Sem dados confiáveis"
    : readiness.status === "saudavel" ? "Fila funcionando — capacidade geral ainda não comprovada"
    : readiness.status === "problema" ? "Problema identificado — não ampliar"
    : "Em observação — não ampliar";
  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", minHeight: "100vh", padding: "24px 16px", color: "var(--foreground, #f5f5f5)" }}>
      <nav style={{ marginBottom: 20 }}><Link href="/dev" style={{ color: "var(--info, #60a5fa)" }}>← Voltar ao DEV</Link></nav>
      <h1 style={{ fontSize: 25, marginBottom: 6 }}>Saúde da fila do WhatsApp</h1>
      <p style={{ opacity: .7, marginTop: 0 }}>Somente leitura, sem mensagens de teste. Atualiza automaticamente a cada minuto.</p>
      <section style={panel} aria-live="polite">
        <h2 style={{ fontSize: 18, marginTop: 0 }}>{summary}</h2>
        {error && <p role="alert" style={{ color: "var(--danger, #f87171)" }}>{error}</p>}
        {data && <>
          <p>Nova fila: <strong>{data.active ? "Ativa" : "Inativa"}</strong> · Alcance: <strong>{data.rollout === "all" ? "Todos" : data.rollout === "allowlist" ? "Somente números autorizados" : "Desligada"}</strong></p>
          <p>Agenda de recuperação: <strong>{data.agendaRecuperacao === "ok" ? "Confirmada no QStash" : "Não confirmada (" + data.agendaRecuperacao + ")"}</strong></p>
          <p>Processamento local: <strong>{readiness?.processamentoLocalConfirmado ? "Confirmado por contadores" : "Não comprovado"}</strong></p>
          <p>Capacidade para todos: <strong>Não comprovada; exige pico real, limite QStash e margem de recuperação.</strong></p>
        </>}
      </section>

      {trafego && <section style={{ ...panel, marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Horários de pico reais</h2>
        <p>Mensagens dos clientes nos últimos 7 dias: <strong>{toNumber(trafego.total7d)}</strong></p>
        <p>Coleta: <strong>{trafego.coberturaDias} de 7 dias completos</strong>.
          {" "}{trafego.suficienteParaRepresentatividade
            ? "Janela mínima de observação atingida. Ainda é preciso avaliar quotas e dias de maior movimento."
            : "Ainda não há uma semana completa de dados; não extrapolar a demanda."}
        </p>
        <p>Pico em uma hora: <strong>{trafego.picoHora
          ? `${toNumber(trafego.picoHora.mensagens)} mensagens às ${String(trafego.picoHora.hora).padStart(2, "0")}h em ${trafego.picoHora.data}`
          : "Sem dados"}</strong></p>
        <p>Pico em um minuto: <strong>{trafego.picoMinuto
          ? `${toNumber(trafego.picoMinuto.mensagens)} mensagens em ${trafego.picoMinuto.quando}`
          : "Sem dados"}</strong></p>
        <p style={{ fontSize: 12, opacity: .7 }}>Fuso: {trafego.fuso}. Horários abaixo somam os sete dias disponíveis.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 7 }}>
          {horas.map(({ hora, quantidade }) => <div key={hora} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 27 }}>{String(hora).padStart(2, "0")}h</span>
            <div style={{ flex: 1, height: 10, background: "var(--border, #333)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${quantidade / maiorHora * 100}%`, height: "100%", background: "var(--info, #60a5fa)" }} />
            </div>
            <span style={{ width: 24, textAlign: "right" }}>{quantidade}</span>
          </div>)}
        </div>
        <p style={{ fontSize: 13, marginTop: 20, fontWeight: 650 }}>Movimento por dia</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {trafego.dias.map(d => <div key={d.data} style={{ border: "1px solid var(--border, #333)", borderRadius: 9, padding: 10, fontSize: 12 }}>
            <div>{d.data}</div><strong>{toNumber(d.total)} mensagens</strong>
          </div>)}
        </div>
        <p style={{ fontSize: 12, opacity: .7, marginTop: 14 }}>{trafego.observacao}</p>
        <p style={{ fontSize: 12, opacity: .75 }}>Uso diário da cota QStash: <strong>não disponível nesta leitura</strong>.
          {" "}Sem essa informação, o painel não autoriza liberar para todos.</p>
      </section>}
      {queue && <>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 16 }}>
          {[
            ["Recebidas na fila", queue.queuedTotal],
            ["Processadas localmente", queue.doneTotal],
            ["Aguardando", queue.pending],
            ["Em processamento", queue.inFlight],
            ["Resultado incerto", queue.ambiguousTotal],
            ["Exigem investigação", queue.unresolved],
          ].map(([label, value]) => <div key={String(label)} style={panel}>
            <div style={{ opacity: .75, fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 27, fontWeight: 750, marginTop: 8 }}>{toNumber(value as number)}</div>
          </div>)}
        </section>
        <section style={{ ...panel, marginTop: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 17 }}>O que falta para liberar a todos?</h2>
          <ul style={{ paddingLeft: 22, lineHeight: 1.7 }}>
            {readiness?.motivos.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
          <p style={{ opacity: .8, fontSize: 13 }}>
            Uma mensagem marcada como concluída significa processamento interno, não entrega confirmada no celular.
            Os contadores são acumulados desde a ativação desta fila; não representam o histórico do WhatsApp antigo.
          </p>
          <p style={{ opacity: .7, fontSize: 12 }}>
            Último processamento: {queue.lastWorkerAt > 0 ? new Date(queue.lastWorkerAt).toLocaleString("pt-BR") : "sem informação"}.
            {" "}Atualizado: {updatedAt ? new Date(updatedAt).toLocaleTimeString("pt-BR") : "aguardando"}.
          </p>
        </section>
      </>}
    </main>
  );
}
