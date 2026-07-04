// Banco de ilustrações leves do fluxo público do /cardapio: ícone grande +
// título curto + texto curto, reservado para os poucos momentos que merecem
// destaque visual (vazio, sucesso, espera, erro). Não usar em telas de
// escolha rápida (tamanho, sabor, borda, com/sem leite, pagamento etc.) —
// isso poluiria o fluxo em vez de ajudar.
//
// Sem biblioteca externa, sem imagem/asset — só emoji + texto, no mesmo
// espírito do ICONS de src/app/cardapio/page.tsx.
export const CARDAPIO_ILLUSTRATIONS = {
  sacolaVazia: { icon: "🛒", title: "Sua sacola está vazia", text: "Escolha um item para começar." },
  pedidoEnviado: { icon: "✓", title: "Pedido enviado", text: "A pizzaria já recebeu seu pedido." },
  aguardandoPix: { icon: "⚡", title: "Aguardando Pix", text: "Confirmamos assim que o pagamento cair." },
  pedidoPreparo: { icon: "🍕", title: "Preparando seu pedido", text: "Já vamos começar!" },
  pedidoSaiuEntrega: { icon: "🛵", title: "Saiu para entrega", text: "Seu pedido está a caminho." },
  cardapioVazio: { icon: "🍽️", title: "Nada por aqui ainda", text: "Volte em instantes." },
  erroCarregamento: { icon: "⚠️", title: "Não deu pra carregar", text: "Tente novamente em instantes." },
  semResultado: { icon: "🔍", title: "Nada encontrado", text: "Tente outra categoria." },
} as const;

export type CardapioIllustrationKey = keyof typeof CARDAPIO_ILLUSTRATIONS;

export function CardapioIllustration({ icon, title, text, compact }: { icon: string; title: string; text?: string; compact?: boolean }) {
  return (
    <div className={`cardapio-illustration${compact ? " compact" : ""}`}>
      <div className="cardapio-illustration-icon">{icon}</div>
      <div className="cardapio-illustration-title">{title}</div>
      {text && <p className="cardapio-illustration-text">{text}</p>}
    </div>
  );
}
