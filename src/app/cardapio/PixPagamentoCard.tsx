"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, CheckCircle2, ChevronDown, Clock, Copy, KeyRound, QrCode, Smartphone } from "lucide-react";
import { copiarTexto } from "@/lib/clipboard";

// Card premium do pagamento Pix (tela "Pedido recebido!" do /cardapio).
// Reorganização visual apenas — todos os dados vêm de fora (props) e a
// origem/lógica de geração do Pix, auto-verificação e conciliação
// continuam intocadas em PublicCardapio (page.tsx). Este componente não
// busca dados, não chama APIs e não introduz nenhum estado persistido.
export type PixPagamentoCardStatus = "aguardando_pix" | "pago" | "em_revisao" | "conferencia_manual" | "nao_pix";

export type PixPagamentoCardProps = {
  statusPix: PixPagamentoCardStatus;
  statusLabel: string;
  pixPedido?: { chavePix?: string; beneficiario?: string };
  pixCodigoCopiaECola: string;
  temPixCopiaECola: boolean;
  isHibrido: boolean;
  hibridoAtual: { pix: number; dinheiro: number } | null;
  trocoConfirmadoTexto: string | null;
  money: (v: number) => string;
  onToast: (mensagem: string) => void;
};

const PASSOS_COMO_FUNCIONA = [
  { Icon: Smartphone, texto: "Abra o app do banco" },
  { Icon: QrCode, texto: "Pague com o QR Code ou código Pix" },
  { Icon: CheckCircle2, texto: "Aguarde a confirmação automática" },
];

export default function PixPagamentoCard({
  statusPix,
  statusLabel,
  pixPedido,
  pixCodigoCopiaECola,
  temPixCopiaECola,
  isHibrido,
  hibridoAtual,
  trocoConfirmadoTexto,
  money,
  onToast,
}: PixPagamentoCardProps) {
  const [copiado, setCopiado] = useState(false);
  const [mostrarChaveManual, setMostrarChaveManual] = useState(false);
  const pago = statusPix === "pago";
  const temChaveManual = !!(pixPedido?.chavePix || pixPedido?.beneficiario);

  async function handleCopiar() {
    const ok = await copiarTexto(pixCodigoCopiaECola);
    onToast(ok ? "Pix copiado" : "Não consegui copiar. Toque no código e copie manualmente.");
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    }
  }

  return (
    <div className={`pix-premium ${pago ? "is-pago" : ""}`}>
      {/* Card de status — nunca depende só da cor: sempre tem ícone + texto */}
      <div className={`pix-status-card ${pago ? "pago" : "aguardando"}`} role="status" aria-live="polite">
        <div className="pix-status-icon" aria-hidden="true">
          {pago ? <CheckCircle2 size={22} /> : <Clock size={22} />}
        </div>
        <div className="pix-status-copy">
          <span className="pix-status-titulo">{pago ? "Pagamento confirmado" : "Aguardando pagamento"}</span>
          <span className="pix-status-sub">
            {pago ? statusLabel : "Estamos verificando seu pagamento automaticamente"}
          </span>
        </div>
        <span className={`pix-status-badge ${pago ? "pago" : "aguardando"}`}>{statusLabel}</span>
      </div>

      {/* Mensagem principal — não pode deixar dúvida sobre a regra do Pix */}
      {!pago ? (
        <div className="pix-mensagem-principal">
          <p className="pix-mensagem-titulo">
            Seu pedido será confirmado somente <span className="pix-destaque">após o pagamento do Pix</span>.
          </p>
          <p className="pix-mensagem-sub">Assim que o pagamento for identificado, a confirmação acontece automaticamente.</p>
        </div>
      ) : (
        <div className="pix-mensagem-principal pago">
          <p className="pix-mensagem-titulo">Pagamento confirmado com sucesso! ✅</p>
          <p className="pix-mensagem-sub">Seu pedido já está com a pizzaria.</p>
        </div>
      )}

      {isHibrido && hibridoAtual && (
        <div className="pix-hibrido-card">
          <p><strong>Pix:</strong> {money(hibridoAtual.pix)} — {statusLabel}</p>
          <p><strong>Dinheiro:</strong> {money(hibridoAtual.dinheiro)} na hora de receber o pedido</p>
          {trocoConfirmadoTexto && <p><strong>Troco:</strong> {trocoConfirmadoTexto}</p>}
        </div>
      )}

      {!pago && temPixCopiaECola && (
        <>
          <div className="pix-qr-card">
            <div className="pix-qr-glow">
              <QRCodeSVG className="pix-qr-svg" value={pixCodigoCopiaECola} size={220} level="M" aria-label="QR Code Pix" />
            </div>
            <p className="pix-qr-legenda">Escaneie com o aplicativo do seu banco</p>
          </div>

          <div className="pix-copia-cola-card">
            <span className="pix-copia-cola-label">Pix copia e cola</span>
            <div className="pix-copia-cola-campo" title={pixCodigoCopiaECola}>{pixCodigoCopiaECola}</div>
            <button
              type="button"
              className={`pix-copiar-btn ${copiado ? "copiado" : ""}`}
              onClick={handleCopiar}
              aria-label="Copiar código Pix copia e cola"
            >
              {copiado ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              <span>{copiado ? "Código copiado" : "Copiar código Pix"}</span>
            </button>
          </div>

          {temChaveManual && (
            <div className="pix-chave-manual">
              <button
                type="button"
                className="pix-chave-manual-toggle"
                onClick={() => setMostrarChaveManual((v) => !v)}
                aria-expanded={mostrarChaveManual}
              >
                <span className="pix-chave-manual-toggle-label"><KeyRound size={16} aria-hidden="true" /> Prefiro pagar pela chave Pix</span>
                <ChevronDown size={16} className={`pix-chave-manual-chevron ${mostrarChaveManual ? "open" : ""}`} aria-hidden="true" />
              </button>
              {mostrarChaveManual && (
                <div className="pix-chave-manual-conteudo">
                  {pixPedido?.beneficiario && <p><strong>Nome:</strong> {pixPedido.beneficiario}</p>}
                  {pixPedido?.chavePix && <p style={{ wordBreak: "break-word" }}><strong>Chave Pix:</strong> {pixPedido.chavePix}</p>}
                </div>
              )}
            </div>
          )}

          <div className="pix-como-funciona">
            <span className="pix-como-funciona-titulo">Como funciona</span>
            <div className="pix-como-funciona-passos">
              {PASSOS_COMO_FUNCIONA.map(({ Icon, texto }, i) => (
                <div className="pix-passo" key={texto}>
                  <div className="pix-passo-icone" aria-hidden="true"><Icon size={18} /></div>
                  <span className="pix-passo-num">{i + 1}</span>
                  <span className="pix-passo-texto">{texto}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!pago && !temPixCopiaECola && temChaveManual && (
        <div className="pix-copia-cola-card">
          <span className="pix-copia-cola-label">Pague pela chave Pix</span>
          {pixPedido?.beneficiario && <p><strong>Nome:</strong> {pixPedido.beneficiario}</p>}
          {pixPedido?.chavePix && <p style={{ wordBreak: "break-word" }}><strong>Chave Pix:</strong> {pixPedido.chavePix}</p>}
        </div>
      )}
    </div>
  );
}
