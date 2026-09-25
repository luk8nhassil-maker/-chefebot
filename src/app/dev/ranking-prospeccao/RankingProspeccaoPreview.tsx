"use client";

import { useState } from "react";
import RankingInviteModal from "@/components/RankingInviteModal";
import { deveMostrarConviteRankingPosPedido, type RankingProspeccaoStatusPagamento } from "@/lib/rankingProspeccao";

type Cenario = {
  id: string;
  titulo: string;
  detalhe: string;
  participaCampanha: boolean | null;
  pagamentoStatus: RankingProspeccaoStatusPagamento;
};

const CENARIOS: Cenario[] = [
  { id: "nao-pix", titulo: "Pedido concluído · não Pix", detalhe: "Momento principal do convite.", participaCampanha: false, pagamentoStatus: "nao_pix" },
  { id: "pix-pendente", titulo: "Pix aguardando pagamento", detalhe: "Ranking fica silencioso para não competir com o pagamento.", participaCampanha: false, pagamentoStatus: "aguardando_pix" },
  { id: "pix-pago", titulo: "Pix confirmado", detalhe: "Com o pagamento resolvido, o convite pode aparecer.", participaCampanha: false, pagamentoStatus: "pago" },
  { id: "participante", titulo: "Cliente já participante", detalhe: "Nunca é prospectado novamente.", participaCampanha: true, pagamentoStatus: "nao_pix" },
];

export default function RankingProspeccaoPreview() {
  const [cenario, setCenario] = useState(CENARIOS[0]);
  const [adiou, setAdiou] = useState(false);
  const [modalAberto, setModalAberto] = useState(false);
  const [aviso, setAviso] = useState("");

  function simular(proximo: Cenario) {
    setCenario(proximo);
    setAdiou(false);
    setAviso("");
    setModalAberto(deveMostrarConviteRankingPosPedido({
      pedidoConcluido: true,
      participaCampanha: proximo.participaCampanha,
      adiouNestaSessao: false,
      pagamentoStatus: proximo.pagamentoStatus,
    }));
  }

  return (
    <main style={{ minHeight: "100dvh", background: "#f4f6f9", padding: 24, fontFamily: "Arial, sans-serif", color: "#172945" }}>
      <section style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 800, color: "#3972d7" }}>PREVIEW ISOLADO</p>
        <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>Prospecção do Ranking no pedido</h1>
        <p style={{ margin: "0 0 18px", color: "#61738b", lineHeight: 1.5 }}>
          Dados fictícios e ações locais. Este Preview não cria pedido, Pix, WhatsApp, impressão, estoque, fidelidade ou escrita em Redis.
        </p>

        <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
          {CENARIOS.map((item) => (
            <button key={item.id} type="button" onClick={() => simular(item)} style={{ textAlign: "left", padding: 14, borderRadius: 14, border: item.id === cenario.id ? "2px solid #4f86ed" : "1px solid #d7deea", background: "#fff", cursor: "pointer" }}>
              <strong style={{ display: "block" }}>{item.titulo}</strong>
              <span style={{ display: "block", marginTop: 4, color: "#61738b", fontSize: 13 }}>{item.detalhe}</span>
            </button>
          ))}
        </div>

        <section style={{ padding: 16, borderRadius: 16, background: "#fff", border: "1px solid #dfe5ef" }}>
          <strong>Jornada protegida</strong>
          <p style={{ margin: "8px 0 0", color: "#61738b", lineHeight: 1.5 }}>
            Itens → Sacola → Entrega → Pagamento ficam sem modal. A decisão de participação só aparece depois que o pedido está concluído e, no Pix, somente depois da confirmação do pagamento.
          </p>
          <p style={{ margin: "10px 0 0", fontSize: 13 }}>Cenário atual: <strong>{cenario.titulo}</strong></p>
          <p style={{ margin: "4px 0 0", fontSize: 13 }}>Convite: <strong>{modalAberto ? "aparece" : "não aparece"}</strong>{adiou ? " · adiado nesta sessão" : ""}</p>
          {aviso && <p role="status" style={{ margin: "10px 0 0", color: "#2d609f" }}>{aviso}</p>}
        </section>
      </section>

      {modalAberto && (
        <RankingInviteModal
          onParticipar={() => {
            setModalAberto(false);
            setAviso("Simulação concluída: no fluxo real, abriria /cliente?fromOrder=1 para autenticar e validar o consentimento no servidor.");
          }}
          onDepois={() => {
            setModalAberto(false);
            setAdiou(true);
            setAviso("Simulação: novas abordagens ficam suprimidas nesta sessão.");
          }}
        />
      )}
    </main>
  );
}
