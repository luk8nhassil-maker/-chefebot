"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, CheckCircle2, ChevronDown, Copy, KeyRound, QrCode, Sparkles, Smartphone } from "lucide-react";
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
  pedidoNumero: number;
  pedidoTotal: number;
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
  pedidoNumero,
  pedidoTotal,
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
      {/* Bloco 1+2 — alerta principal. Nunca depende só de cor: título +
          badge + texto explícito sempre presentes. */}
      <div className={`pix-alerta ${pago ? "pago" : ""}`} role="status" aria-live="polite">
        <span className={`pix-alerta-eyebrow ${pago ? "pago" : ""}`}>
          {!pago && <span className="pix-alerta-dot" aria-hidden="true" />}
          {pago ? "Pagamento confirmado" : "Aguardando pagamento"}
        </span>

        {!pago ? (
          <>
            <p className="pix-alerta-headline">
              FALTA PAGAR <span className="destaque">O PIX</span>
            </p>
            <p className="pix-alerta-regra">Seu pedido ainda não foi confirmado.</p>
            <p className="pix-alerta-sub">A confirmação acontece somente após o pagamento do Pix.</p>
            {temPixCopiaECola && (
              <div className="pix-alerta-acao">
                <span>Escaneie o QR Code ou copie o código Pix abaixo</span>
                <ChevronDown size={18} className="pix-alerta-seta" aria-hidden="true" />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="pix-alerta-headline">Pagamento confirmado! ✅</p>
            <p className="pix-alerta-sub">Seu pedido já foi confirmado e a pizzaria já recebeu.</p>
          </>
        )}
      </div>

      {/* Bloco 3 — valor do pedido, logo abaixo do alerta */}
      <div className="pix-resumo-linha">
        <span>Pedido #{pedidoNumero}</span>
        <strong>{money(pedidoTotal)}</strong>
      </div>

      {isHibrido && hibridoAtual && (
        <div className="pix-hibrido-card">
          <p><strong>Pix:</strong> {money(hibridoAtual.pix)} — {statusLabel}</p>
          <p><strong>Dinheiro:</strong> {money(hibridoAtual.dinheiro)} na hora de receber o pedido</p>
          {trocoConfirmadoTexto && <p><strong>Troco:</strong> {trocoConfirmadoTexto}</p>}
        </div>
      )}

      {!pago && temPixCopiaECola && (
        <>
          {/* Bloco 4 — QR Code */}
          <div className="pix-qr-card">
            <div className="pix-qr-glow">
              <QRCodeSVG className="pix-qr-svg" value={pixCodigoCopiaECola} size={220} level="M" aria-label="QR Code Pix" />
            </div>
            <p className="pix-qr-legenda">Escaneie com o aplicativo do seu banco</p>
          </div>

          <div className="pix-copia-cola-card">
            <span className="pix-copia-cola-label">Pix copia e cola</span>
            <div className="pix-copia-cola-campo" title={pixCodigoCopiaECola}>{pixCodigoCopiaECola}</div>
            {/* Bloco 5 — botão principal de copiar */}
            <button
              type="button"
              className={`pix-copiar-btn ${copiado ? "copiado" : ""}`}
              onClick={handleCopiar}
              aria-label="Copiar código Pix copia e cola"
            >
              {copiado ? <Check size={20} aria-hidden="true" /> : <Copy size={20} aria-hidden="true" />}
              <span>{copiado ? "Código copiado" : "Copiar código Pix"}</span>
            </button>
          </div>

          {/* Bloco 4 (reforço final) — reafirma a confirmação automática */}
          <div className="pix-reforco">
            <Sparkles size={16} aria-hidden="true" />
            <span>Assim que o pagamento for identificado, seu pedido será confirmado automaticamente.</span>
          </div>

          {/* Bloco 6 — instrução simples em três passos */}
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

          {/* Bloco 7 — informação secundária (fallback manual já existente) */}
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
