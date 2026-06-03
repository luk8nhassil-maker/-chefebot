import { MENU, getBorderPrice, getDeliveryFee, getSizePrice } from "./menu";

export type BotStep =
  | "welcome"
  | "name"
  | "size"
  | "flavor"
  | "border"
  | "add_more"
  | "delivery_type"
  | "neighborhood"
  | "payment"
  | "confirm"
  | "done";

export interface CartItem {
  size: string;
  flavor: string;
  border: string;
  price: number;
}

export interface BotSession {
  step: BotStep;
  cart: CartItem[];
  customerName?: string;
  currentSize?: string;
  currentFlavor?: string;
  deliveryType?: "delivery" | "pickup";
  neighborhood?: string;
  deliveryFee: number;
  paymentMethod?: string;
}

export interface BotResponse {
  messages: string[];
  session: BotSession;
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.price, 0);
}

function buildReceipt(session: BotSession): string {
  const lines = session.cart.map((item, i) => {
    const border = item.border !== "Sem borda" ? ` + ${item.border}` : "";
    return `  ${i + 1}. Pizza ${item.size} ${item.flavor}${border} — ${formatCurrency(item.price)}`;
  });
  const subtotal = cartSubtotal(session.cart);
  const total = subtotal + session.deliveryFee;
  const delivery =
    session.deliveryType === "delivery"
      ? `\n  Entrega (${session.neighborhood}): ${formatCurrency(session.deliveryFee)}`
      : "\n  Retirada no local: grátis";
  return (
    lines.join("\n") +
    `\n\n  Subtotal: ${formatCurrency(subtotal)}` +
    delivery +
    `\n  *Total: ${formatCurrency(total)}*` +
    `\n  Pagamento: ${session.paymentMethod}`
  );
}

export function processMessage(input: string, session: BotSession): BotResponse {
  const text = input.trim();
  const lower = text.toLowerCase();

  switch (session.step) {
    case "welcome": {
      return {
        messages: [`Olá! 👋 Bem-vindo à *Chefe da Pizza*! 🍕\n\nSou o ChefBot e vou te ajudar a fazer seu pedido.\n\nQual o seu nome?`],
        session: { ...session, step: "name" },
      };
    }

    case "name": {
      if (!text || text.length < 2) {
        return {
          messages: [`Por favor, me diz seu nome para continuar. 😊`],
          session,
        };
      }
      const firstName = text.split(" ")[0];
      return {
        messages: [
          `Que ótimo, *${firstName}*! 🍕\n\nQual o tamanho da pizza?\n\n  1. Pequena (P) — R$ 35,00\n  2. Média (M) — R$ 40,00\n  3. Grande (G) — R$ 50,00\n  4. Família (F) — R$ 55,00\n\nDigite o número ou a letra (P, M, G ou F):`,
        ],
        session: { ...session, step: "size", customerName: text },
      };
    }

    case "size": {
      const sizeMap: Record<string, string> = {
        "1": "P", "2": "M", "3": "G", "4": "F",
        p: "P", m: "M", g: "G", f: "F",
        pequena: "P", média: "M", media: "M", grande: "G", família: "F", familia: "F",
      };
      const size = sizeMap[lower];
      if (!size) {
        return {
          messages: [`Não entendi. Por favor escolha o tamanho:\n\n  1. Pequena (P) — R$ 35,00\n  2. Média (M) — R$ 40,00\n  3. Grande (G) — R$ 50,00\n  4. Família (F) — R$ 55,00`],
          session,
        };
      }
      const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
      const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
      return {
        messages: [`Ótimo! Pizza *${size}* selecionada.\n\nEscolha o sabor:\n\n🧀 *Salgadas*\n${saltyList}\n\n🍫 *Doces*\n${sweetList}\n\nDigite o número ou o nome do sabor:`],
        session: { ...session, step: "flavor", currentSize: size },
      };
    }

    case "flavor": {
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      let flavor: string | undefined;
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= allFlavors.length) {
        flavor = allFlavors[num - 1];
      } else {
        flavor = allFlavors.find((f) => f.toLowerCase() === lower);
      }
      if (!flavor) {
        const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
        return {
          messages: [`Sabor não encontrado. Escolha pelo número ou nome:\n\n🧀 *Salgadas*\n${saltyList}\n\n🍫 *Doces*\n${sweetList}`],
          session,
        };
      }
      const borderPrice = getBorderPrice(session.currentSize!);
      return {
        messages: [`Sabor *${flavor}* selecionado! 😋\n\nDeseja borda recheada?\n\n  1. Sim — ${formatCurrency(borderPrice)}\n  2. Não`],
        session: { ...session, step: "border", currentFlavor: flavor },
      };
    }

    case "border": {
      const wantsBorder = lower === "1" || lower === "sim" || lower === "s" || lower.includes("sim");
      const border = wantsBorder ? "Borda recheada" : "Sem borda";
      const borderPrice = wantsBorder ? getBorderPrice(session.currentSize!) : 0;
      const basePrice = getSizePrice(session.currentSize!);
      const itemPrice = basePrice + borderPrice;
      const newItem: CartItem = { size: session.currentSize!, flavor: session.currentFlavor!, border, price: itemPrice };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [
          `Pizza adicionada ao carrinho! ✅\n\n🛒 *Seu pedido até agora:*\n${newCart.map((item, i) => `  ${i + 1}. ${item.size} ${item.flavor}${item.border !== "Sem borda" ? " + " + item.border : ""} — ${formatCurrency(item.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nDeseja adicionar mais uma pizza?\n\n  1. Sim, adicionar mais\n  2. Não, finalizar pedido`,
        ],
        session: { ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined },
      };
    }

    case "add_more": {
      const addMore = lower === "1" || lower === "sim" || lower === "s" || lower.includes("sim");
      if (addMore) {
        return {
          messages: [`Qual o tamanho da próxima pizza?\n\n  1. Pequena (P) — R$ 35,00\n  2. Média (M) — R$ 40,00\n  3. Grande (G) — R$ 50,00\n  4. Família (F) — R$ 55,00`],
          session: { ...session, step: "size" },
        };
      }
      return {
        messages: [`Como prefere receber seu pedido?\n\n  1. 🛵 Entrega (delivery)\n  2. 🏠 Retirar na loja`],
        session: { ...session, step: "delivery_type" },
      };
    }

    case "delivery_type": {
      const isDelivery = lower === "1" || lower === "entrega" || lower === "delivery" || lower.includes("entrega");
      if (isDelivery) {
        const list = MENU.neighborhoods.map((n, i) => `  ${i + 1}. ${n.group} — ${formatCurrency(n.fee)}`).join("\n");
        return {
          messages: [`Qual é o seu bairro?\n\n${list}\n\nDigite o número ou o nome do bairro:`],
          session: { ...session, step: "neighborhood", deliveryType: "delivery" },
        };
      }
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      return {
        messages: [`Ótimo! Você retirará na loja. 🏠\n\nQual a forma de pagamento?\n\n${payList}`],
        session: { ...session, step: "payment", deliveryType: "pickup", deliveryFee: 0, neighborhood: undefined },
      };
    }

    case "neighborhood": {
      let found: (typeof MENU.neighborhoods)[0] | undefined;
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= MENU.neighborhoods.length) {
        found = MENU.neighborhoods[num - 1];
      } else {
        found = MENU.neighborhoods.find((n) => n.areas.some((a) => a.toLowerCase() === lower) || n.group.toLowerCase().includes(lower));
      }
      if (!found) {
        const list = MENU.neighborhoods.map((n, i) => `  ${i + 1}. ${n.group} — ${formatCurrency(n.fee)}`).join("\n");
        return {
          messages: [`Bairro não encontrado. Escolha pelo número ou nome:\n\n${list}`],
          session,
        };
      }
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      return {
        messages: [`Entrega para região *${found.group}*. Taxa: ${formatCurrency(found.fee)} 🛵\n\nQual a forma de pagamento?\n\n${payList}`],
        session: { ...session, step: "payment", neighborhood: found.areas[0], deliveryFee: found.fee },
      };
    }

    case "payment": {
      const payMap: Record<string, string> = {
        "1": "Pix", "2": "Dinheiro", "3": "Cartão",
        pix: "Pix", dinheiro: "Dinheiro", cartão: "Cartão", cartao: "Cartão",
        crédito: "Cartão", credito: "Cartão", débito: "Cartão", debito: "Cartão",
      };
      const payment = payMap[lower];
      if (!payment) {
        const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
        return {
          messages: [`Forma de pagamento não reconhecida. Escolha:\n\n${payList}`],
          session,
        };
      }
      const updatedSession = { ...session, paymentMethod: payment };
      const receipt = buildReceipt(updatedSession);
      return {
        messages: [`📋 *Resumo do Pedido:*\n\n${receipt}\n\nConfirma o pedido?\n\n  1. ✅ Sim, confirmar\n  2. ❌ Cancelar`],
        session: { ...updatedSession, step: "confirm" },
      };
    }

    case "confirm": {
      const confirmed = lower === "1" || lower === "sim" || lower === "s" || lower.includes("sim");
      if (confirmed) {
        const timeMsg = session.deliveryType === "delivery" ? "40-60 minutos" : "25-35 minutos";
        const pixMsg = session.paymentMethod === "Pix" ? "\n\n  Chave Pix: *11999999999*" : "";
        return {
          messages: [`✅ *Pedido confirmado!* Obrigado pela preferência!\n\nSeu pedido foi recebido e será preparado com carinho. 🍕👨‍🍳\n\nTempo estimado: *${timeMsg}*${pixMsg}\n\nQualquer dúvida, é só chamar! Bom apetite! 😄`],
          session: { ...session, step: "done" },
        };
      }
      return {
        messages: [`Pedido cancelado. 😔\n\nSe mudar de ideia, é só mandar uma mensagem! Estamos aqui para te atender. 🍕`],
        session: { ...session, step: "done" },
      };
    }

    case "done": {
      return {
        messages: [`Olá novamente! Quer fazer um novo pedido? 🍕\n\nQual o tamanho da pizza?\n\n  1. Pequena (P) — R$ 35,00\n  2. Média (M) — R$ 40,00\n  3. Grande (G) — R$ 50,00\n  4. Família (F) — R$ 55,00`],
        session: { step: "size", cart: [], deliveryFee: 0 },
      };
    }

    default:
      return {
        messages: ["Desculpe, não entendi. Vamos recomeçar?"],
        session: { step: "welcome", cart: [], deliveryFee: 0 },
      };
  }
}

export function createInitialSession(): BotSession {
  return { step: "welcome", cart: [], deliveryFee: 0 };
}

export function getWelcomeMessages(): string[] {
  return [`Olá! 👋 Bem-vindo à *Chefe da Pizza*! 🍕\n\nSou o ChefBot e vou te ajudar a fazer seu pedido.\n\nQual o seu nome?`];
}