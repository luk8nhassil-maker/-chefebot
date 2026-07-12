import { ShoppingCart, CheckCircle2, Zap, Pizza, Bike, UtensilsCrossed, AlertTriangle, Search } from "lucide-react";

// Banco de ilustrações leves do fluxo público do /cardapio: ícone grande +
// título curto + texto curto, reservado para os poucos momentos que merecem
// destaque visual (vazio, sucesso, espera, erro). Não usar em telas de
// escolha rápida (tamanho, sabor, borda, com/sem leite, pagamento etc.) —
// isso poluiria o fluxo em vez de ajudar.
//
// Ícones de lucide-react (sem emoji) — mesmo espírito do ICONS de
// src/app/cardapio/page.tsx.
export const CARDAPIO_ILLUSTRATIONS = {
  sacolaVazia: { icon: ShoppingCart, title: "Sua sacola está vazia", text: "Escolha um item para começar." },
  pedidoEnviado: { icon: CheckCircle2, title: "Pedido enviado", text: "A pizzaria já recebeu seu pedido." },
  aguardandoPix: { icon: Zap, title: "Aguardando Pix", text: "Confirmamos assim que o pagamento cair." },
  pedidoPreparo: { icon: Pizza, title: "Preparando seu pedido", text: "Já vamos começar!" },
  pedidoSaiuEntrega: { icon: Bike, title: "Saiu para entrega", text: "Seu pedido está a caminho." },
  cardapioVazio: { icon: UtensilsCrossed, title: "Nada por aqui ainda", text: "Volte em instantes." },
  erroCarregamento: { icon: AlertTriangle, title: "Não deu pra carregar", text: "Tente novamente em instantes." },
  semResultado: { icon: Search, title: "Nada encontrado", text: "Tente outra categoria." },
} as const;

export type CardapioIllustrationKey = keyof typeof CARDAPIO_ILLUSTRATIONS;

type IconComponent = typeof ShoppingCart;

export function CardapioIllustration({ icon, title, text, compact }: { icon: IconComponent; title: string; text?: string; compact?: boolean }) {
  const Icon = icon;
  return (
    <div className={`cardapio-illustration${compact ? " compact" : ""}`}>
      <div className="cardapio-illustration-icon">
        <Icon size={compact ? 22 : 40} strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="cardapio-illustration-title">{title}</div>
      {text && <p className="cardapio-illustration-text">{text}</p>}
    </div>
  );
}
