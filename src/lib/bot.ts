import { MENU, getBorderPrice, getSizePrice, getMacarronadaPrice } from "./menu";

export type BotStep =
  | "welcome"
  | "returning"
  | "name"
  | "category"
  | "size"
  | "flavor"
  | "border"
  | "add_more"
  | "lanche_escolha"
  | "lanche_flavor"
  | "lanche_macarronada_size"
  | "bebida_escolha"
  | "suco_escolha"
  | "delivery_type"
  | "neighborhood"
  | "address"
  | "payment"
  | "confirm"
  | "done"
  | "escalado";

export interface CartItem {
  category: string;
  name: string;
  size?: string;
  flavor?: string;
  border?: string;
  price: number;
}

export interface ClienteHistorico {
  nome: string;
  ultimoPedido: string[];
  ultimoTotal: number;
}

export interface BotSession {
  step: BotStep;
  cart: CartItem[];
  customerName?: string;
  currentCategory?: string;
  currentSize?: string;
  currentFlavor?: string;
  currentLanche?: string;
  deliveryType?: "delivery" | "pickup";
  neighborhood?: string;
  address?: string;
  deliveryFee: number;
  paymentMethod?: string;
  escalado?: boolean;
  historico?: ClienteHistorico;
}

export interface BotResponse {
  messages: string[];
  session: BotSession;
  escalar?: boolean;
}

const PALAVRAS_ESCALONAMENTO = [
  "atendente", "atendimento", "humano", "pessoa", "ajuda",
  "problema", "erro", "reclamacao", "cancelar",
  "errado", "falar com alguem", "nao consigo", "socorro", "urgente",
];

function precisaEscalar(texto: string): boolean {
  const lower = texto.toLowerCase();
  return PALAVRAS_ESCALONAMENTO.some(p => lower.includes(p));
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function cartSubtotal(cart: CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.price, 0);
}

function detectaIntencaoDireta(text: string): { category: string } | null {
  const lower = text.toLowerCase();

  const todosSaboresPizza = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
  if (todosSaboresPizza.some(f => lower.includes(f.toLowerCase()))) return { category: "pizza" };
  if (lower.includes("pizza") && !lower.includes("mini")) return { category: "pizza" };

  if (lower.includes("calzone")) return { category: "lanche" };
  if (lower.includes("mini-pizza") || lower.includes("mini pizza")) return { category: "lanche" };
  if (lower.includes("macarronada")) return { category: "lanche" };
  if (lower.includes("x-burguer") || lower.includes("x burguer") || lower.includes("hamburguer")) return { category: "lanche" };
  if (lower.includes("x-bacon")) return { category: "lanche" };
  if (lower.includes("x-tudo") || lower.includes("x tudo")) return { category: "lanche" };
  if (lower.includes("batata") || lower.includes("porcao")) return { category: "lanche" };
  if (lower.includes("lanche")) return { category: "lanche" };

  if (lower.includes("coca") || lower.includes("refrigerante") || lower.includes("guarana") ||
    lower.includes("agua") || lower.includes("cerveja") || lower.includes("pepsi") || lower.includes("bebida")) {
    return { category: "bebida" };
  }

  if (lower.includes("suco") || lower.includes("vitamina") || lower.includes("caja") ||
    lower.includes("caju") || lower.includes("acerola") || lower.includes("goiaba") ||
    lower.includes("bacuri") || lower.includes("cupuacu") || lower.includes("laranja") ||
    lower.includes("maracuja") || lower.includes("banana")) {
    return { category: "suco" };
  }

  return null;
}

function mensagemCategorias(): string {
  return `O que voce deseja pedir? \n\n  1. Pizza\n  2. Lanches\n  3. Bebidas\n  4. Sucos e Vitaminas`;
}

function listaBebidas(): string {
  return MENU.bebidas.map((b, i) => `  ${i + 1}. ${b.name} - ${formatCurrency(b.price)}`).join("\n");
}

function listaSucos(): string {
  return MENU.sucos.map((s, i) => `  ${i + 1}. ${s.name} - ${formatCurrency(s.price)}`).join("\n");
}

function listaLanches(): string {
  return MENU.lanches.map((l, i) => {
    if ("sizes" in l && l.sizes) {
      const precos = l.sizes.map((s: {code: string, price: number}) => `${s.code} ${formatCurrency(s.price)}`).join(" | ");
      return `  ${i + 1}. ${l.name} - ${precos}`;
    }
    return `  ${i + 1}. ${l.name} - ${formatCurrency(l.price as number)}`;
  }).join("\n");
}

function buildReceipt(session: BotSession): string {
  const lines = session.cart.map((item, i) => {
    const parts = [item.name];
    if (item.size) parts.push(item.size);
    if (item.flavor) parts.push(item.flavor);
    if (item.border && item.border !== "Sem borda") parts.push(`+ ${item.border}`);
    return `  ${i + 1}. ${parts.join(" ")} - ${formatCurrency(item.price)}`;
  });
  const subtotal = cartSubtotal(session.cart);
  const total = subtotal + session.deliveryFee;
  const delivery =
    session.deliveryType === "delivery"
      ? `\n  Entrega: ${session.address} (${session.neighborhood})\n  Taxa: ${formatCurrency(session.deliveryFee)}`
      : "\n  Retirada no local: gratis";
  return (
    lines.join("\n") +
    `\n\n  Subtotal: ${formatCurrency(subtotal)}` +
    delivery +
    `\n  *Total: ${formatCurrency(total)}*` +
    `\n  Pagamento: ${session.paymentMethod}`
  );
}

function neighborhoodList(): string {
  return MENU.neighborhoods
    .map((n, i) => `  ${i + 1}. ${n.name} - ${formatCurrency(n.fee)}`)
    .join("\n");
}

function handleCategory(category: string, session: BotSession, firstName: string, comNome: boolean): BotResponse {
  const prefixo = comNome ? `Perfeito, *${firstName}*!\n\n` : "";

  if (category === "pizza") {
    return {
      messages: [`${prefixo}Qual o tamanho da pizza?\n\n  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`],
      session: { ...session, step: "size", currentCategory: "pizza" },
    };
  }
  if (category === "lanche") {
    return {
      messages: [`${prefixo}Nossos lanches:\n\n${listaLanches()}\n\nDigite o numero ou o nome:`],
      session: { ...session, step: "lanche_escolha", currentCategory: "lanche" },
    };
  }
  if (category === "bebida") {
    return {
      messages: [`${prefixo}Nossas bebidas:\n\n${listaBebidas()}\n\nDigite o numero ou o nome:`],
      session: { ...session, step: "bebida_escolha", currentCategory: "bebida" },
    };
  }
  if (category === "suco") {
    return {
      messages: [`${prefixo}Nossos sucos e vitaminas:\n\n${listaSucos()}\n\n_(Com leite: acrescimo de R$ 1,00)_\n\nDigite o numero ou o nome:`],
      session: { ...session, step: "suco_escolha", currentCategory: "suco" },
    };
  }
  return {
    messages: [`${prefixo}${mensagemCategorias()}`],
    session: { ...session, step: "category" },
  };
}

export function processMessage(input: string, session: BotSession): BotResponse {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (session.step !== "escalado" && precisaEscalar(text)) {
    return {
      messages: [`Entendido! Vou chamar nossa atendente para te ajudar.\n\nA *Kellyne* ja foi notificada e entrara em contato em breve pelo WhatsApp.\n\nAguarde um momento!`],
      session: { ...session, step: "escalado", escalado: true },
      escalar: true,
    };
  }

  switch (session.step) {
    case "escalado": {
      return {
        messages: [`Nossa atendente ja foi notificada e entrara em contato em breve. Por favor, aguarde.`],
        session,
      };
    }

    case "welcome": {
      return {
        messages: [`Ola! Bem-vindo a *Chefe da Pizza*!\n\nSou o ChefBot e vou te ajudar a fazer seu pedido.\n\nQual o seu nome?`],
        session: { ...session, step: "name" },
      };
    }

    case "returning": {
      const historico = session.historico!;
      const firstName = historico.nome.split(" ")[0];
      const ultimoPedido = historico.ultimoPedido.join(", ");

      if (lower === "1" || lower === "sim" || lower === "s") {
        return {
          messages: [`Otimo, *${firstName}*!\n\n${mensagemCategorias()}`],
          session: { ...session, step: "category", customerName: historico.nome },
        };
      }
      if (lower === "2" || lower === "nao" || lower === "n") {
        return {
          messages: [`Tudo bem! Qual o seu nome?`],
          session: { ...session, step: "name", historico: undefined },
        };
      }
      return {
        messages: [`Ola de novo, *${firstName}*!\n\nSeu ultimo pedido foi: *${ultimoPedido}*\n\nQuer fazer um novo pedido?\n\n  1. Sim, quero pedir\n  2. Nao, obrigado`],
        session,
      };
    }

    case "name": {
      if (!text || text.length < 2) {
        return {
          messages: [`Por favor, me diz seu nome para continuar.`],
          session,
        };
      }
      const firstName = text.split(" ")[0];
      const intencao = detectaIntencaoDireta(text);
      if (intencao) {
        return handleCategory(intencao.category, { ...session, step: "category", customerName: text }, firstName, true);
      }
      return {
        messages: [`Que otimo, *${firstName}*!\n\n${mensagemCategorias()}`],
        session: { ...session, step: "category", customerName: text },
      };
    }

    case "category": {
      const intencao = detectaIntencaoDireta(text);
      const firstName = session.customerName?.split(" ")[0] ?? "";

      let category = "";
      if (lower === "1" || lower.includes("pizza")) category = "pizza";
      else if (lower === "2" || lower.includes("lanche")) category = "lanche";
      else if (lower === "3" || lower.includes("bebida")) category = "bebida";
      else if (lower === "4" || lower.includes("suco") || lower.includes("vitamina")) category = "suco";
      else if (intencao) category = intencao.category;

      if (!category) {
        return {
          messages: [`Nao entendi. Por favor escolha uma opcao:\n\n${mensagemCategorias()}`],
          session,
        };
      }
      return handleCategory(category, session, firstName, false);
    }

    case "size": {
      const sizeMap: Record<string, string> = {
        "1": "P", "2": "M", "3": "G", "4": "F",
        p: "P", m: "M", g: "G", f: "F",
        pequena: "P", media: "M", grande: "G", familia: "F",
      };
      const size = sizeMap[lower];
      if (!size) {
        return {
          messages: [`Nao entendi. Escolha o tamanho:\n\n  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`],
          session,
        };
      }
      const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
      const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
      return {
        messages: [`Otimo! Pizza *${size}* selecionada.\n\nEscolha o sabor:\n\nSalgadas\n${saltyList}\n\nDoces\n${sweetList}\n\nDigite o numero ou o nome do sabor:`],
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
          messages: [`Sabor nao encontrado. Escolha pelo numero ou nome:\n\nSalgadas\n${saltyList}\n\nDoces\n${sweetList}`],
          session,
        };
      }
      const borderPrice = getBorderPrice(session.currentSize!);
      return {
        messages: [`Sabor *${flavor}* selecionado!\n\nDeseja borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
        session: { ...session, step: "border", currentFlavor: flavor },
      };
    }

    case "border": {
      const wantsBorder = lower === "1" || lower === "sim" || lower === "s" || lower.includes("sim");
      const border = wantsBorder ? "Borda recheada" : "Sem borda";
      const borderPrice = wantsBorder ? getBorderPrice(session.currentSize!) : 0;
      const basePrice = getSizePrice(session.currentSize!);
      const itemPrice = basePrice + borderPrice;
      const newItem: CartItem = { category: "pizza", name: "Pizza", size: session.currentSize!, flavor: session.currentFlavor!, border, price: itemPrice };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [`Pizza adicionada!\n\nSeu pedido ate agora:\n${newCart.map((item, i) => `  ${i + 1}. ${item.size} ${item.flavor}${item.border !== "Sem borda" ? " + " + item.border : ""} - ${formatCurrency(item.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nDeseja adicionar mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, finalizar pedido`],
        session: { ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined },
      };
    }

    case "add_more": {
      if (lower === "1" || lower.includes("pizza")) {
        return {
          messages: [`Qual o tamanho da proxima pizza?\n\n  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`],
          session: { ...session, step: "size" },
        };
      }
      if (lower === "2" || lower.includes("outro") || lower.includes("mais")) {
        return {
          messages: [`${mensagemCategorias()}`],
          session: { ...session, step: "category" },
        };
      }
      if (lower === "3" || lower.includes("nao") || lower.includes("finalizar") || lower.includes("nao")) {
        return {
          messages: [`Como prefere receber seu pedido?\n\n  1. Entrega (delivery)\n  2. Retirar na loja`],
          session: { ...session, step: "delivery_type" },
        };
      }
      return {
        messages: [`Opcao invalida. Escolha:\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, finalizar pedido`],
        session,
      };
    }

    case "lanche_escolha": {
      const num = parseInt(text);
      let lanche = MENU.lanches.find((l) => l.name.toLowerCase() === lower);
      if (!lanche && !isNaN(num) && num >= 1 && num <= MENU.lanches.length) {
        lanche = MENU.lanches[num - 1];
      }
      if (!lanche) {
        return {
          messages: [`Lanche nao encontrado. Escolha:\n\n${listaLanches()}`],
          session,
        };
      }
      if (lanche.name === "Macarronada de Carne") {
        return {
          messages: [`*Macarronada de Carne*\n\nEscolha o tamanho:\n\n  1. Pequena (P) - R$ 28,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n\n_(Com adicionais de bacon ou ovos: acrescimo de R$ 10,00)_`],
          session: { ...session, step: "lanche_macarronada_size", currentLanche: lanche.name },
        };
      }
      if (lanche.hasFlavors) {
        const flavorsKey = lanche.flavorsKey as keyof typeof MENU;
        const flavors = MENU[flavorsKey] as string[];
        const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return {
          messages: [`*${lanche.name}* selecionado!\n\nEscolha o sabor:\n\n${lista}`],
          session: { ...session, step: "lanche_flavor", currentLanche: lanche.name },
        };
      }
      const newItem: CartItem = { category: "lanche", name: lanche.name, price: lanche.price as number };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [`*${lanche.name}* adicionado!\n\nSeu pedido:\n${newCart.map((it, i) => `  ${i + 1}. ${it.name} - ${formatCurrency(it.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nDeseja adicionar mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, finalizar pedido`],
        session: { ...session, step: "add_more", cart: newCart, currentLanche: undefined },
      };
    }

    case "lanche_flavor": {
      const lanche = MENU.lanches.find(l => l.name === session.currentLanche)!;
      const flavorsKey = lanche.flavorsKey as keyof typeof MENU;
      const flavors = MENU[flavorsKey] as string[];
      const num = parseInt(text);
      let flavor: string | undefined;
      if (!isNaN(num) && num >= 1 && num <= flavors.length) {
        flavor = flavors[num - 1];
      } else {
        flavor = flavors.find(f => f.toLowerCase() === lower);
      }
      if (!flavor) {
        const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return {
          messages: [`Sabor nao encontrado. Escolha:\n\n${lista}`],
          session,
        };
      }
      const newItem: CartItem = { category: "lanche", name: lanche.name, flavor, price: lanche.price as number };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [`*${lanche.name} ${flavor}* adicionado!\n\nSeu pedido:\n${newCart.map((it, i) => `  ${i + 1}. ${it.name}${it.flavor ? " " + it.flavor : ""} - ${formatCurrency(it.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nDeseja adicionar mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, finalizar pedido`],
        session: { ...session, step: "add_more", cart: newCart, currentLanche: undefined },
      };
    }

    case "lanche_macarronada_size": {
      const sizeMap: Record<string, string> = {
        "1": "P", "2": "M", "3": "G",
        p: "P", m: "M", g: "G",
        pequena: "P", media: "M", grande: "G",
      };
      const size = sizeMap[lower];
      if (!size) {
        return {
          messages: [`Nao entendi. Escolha o tamanho:\n\n  1. Pequena (P) - R$ 28,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00`],
          session,
        };
      }
      const price = getMacarronadaPrice(size);
      const newItem: CartItem = { category: "lanche", name: "Macarronada de Carne", size, price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [`*Macarronada de Carne ${size}* adicionada!\n\nSeu pedido:\n${newCart.map((it, i) => `  ${i + 1}. ${it.name}${it.size ? " " + it.size : ""} - ${formatCurrency(it.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nDeseja adicionar mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, finalizar pedido`],
        session: { ...session, step: "add_more", cart: newCart, currentLanche: undefined },
      };
    }

    case "bebida_escolha": {
      const num = parseInt(text);
      let bebida = MENU.bebidas.find(b => b.name.toLowerCase().includes(lower));
      if (!bebida && !isNaN(num) && num >= 1 && num <= MENU.bebidas.length) {
        bebida = MENU.bebidas[num - 1];
      }
      if (!bebida) {
        return {
          messages: [`Bebida nao encontrada. Escolha:\n\n${listaBebidas()}`],
          session,
        };
      }
      const newItem: CartItem = { category: "bebida", name: bebida.name, price: bebida.price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [`*${bebida.name}* adicionada!\n\nSeu pedido:\n${newCart.map((it, i) => `  ${i + 1}. ${it.name} - ${formatCurrency(it.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nDeseja adicionar mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, finalizar pedido`],
        session: { ...session, step: "add_more", cart: newCart },
      };
    }

    case "suco_escolha": {
      const num = parseInt(text);
      let suco = MENU.sucos.find(s => s.name.toLowerCase().includes(lower));
      if (!suco && !isNaN(num) && num >= 1 && num <= MENU.sucos.length) {
        suco = MENU.sucos[num - 1];
      }
      if (!suco) {
        return {
          messages: [`Suco nao encontrado. Escolha:\n\n${listaSucos()}\n\n_(Com leite: acrescimo de R$ 1,00)_`],
          session,
        };
      }
      const newItem: CartItem = { category: "suco", name: suco.name, price: suco.price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [`*${suco.name}* adicionado!\n\nSeu pedido:\n${newCart.map((it, i) => `  ${i + 1}. ${it.name} - ${formatCurrency(it.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nDeseja adicionar mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, finalizar pedido`],
        session: { ...session, step: "add_more", cart: newCart },
      };
    }

    case "delivery_type": {
      const isDelivery = lower === "1" || lower === "entrega" || lower === "delivery" || lower.includes("entrega");
      if (isDelivery) {
        return {
          messages: [`Qual e o seu bairro?\n\n${neighborhoodList()}\n\nDigite o numero ou o nome do bairro:`],
          session: { ...session, step: "neighborhood", deliveryType: "delivery" },
        };
      }
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      return {
        messages: [`Otimo! Voce retirara na loja.\n\nQual a forma de pagamento?\n\n${payList}`],
        session: { ...session, step: "payment", deliveryType: "pickup", deliveryFee: 0, neighborhood: undefined },
      };
    }

    case "neighborhood": {
      const num = parseInt(text);
      let found: { name: string; fee: number } | undefined;
      if (!isNaN(num) && num >= 1 && num <= MENU.neighborhoods.length) {
        found = MENU.neighborhoods[num - 1];
      } else {
        found = MENU.neighborhoods.find((n) => n.name.toLowerCase().includes(lower));
      }
      if (!found) {
        return {
          messages: [`Bairro nao encontrado. Escolha pelo numero ou nome:\n\n${neighborhoodList()}`],
          session,
        };
      }
      return {
        messages: [`Bairro *${found.name}* - Taxa: ${formatCurrency(found.fee)}\n\nAgora me diga o endereco completo:\n_(Rua, numero e complemento)_`],
        session: { ...session, step: "address", neighborhood: found.name, deliveryFee: found.fee },
      };
    }

    case "address": {
      if (!text || text.length < 5) {
        return {
          messages: [`Por favor, informe o endereco completo.\nExemplo: *Rua das Flores, 123, Apto 2*`],
          session,
        };
      }
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      return {
        messages: [`Endereco anotado!\n\nQual a forma de pagamento?\n\n${payList}`],
        session: { ...session, step: "payment", address: text },
      };
    }

    case "payment": {
      const payMap: Record<string, string> = {
        "1": "Pix", "2": "Dinheiro", "3": "Cartao",
        pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartao",
        credito: "Cartao", debito: "Cartao",
      };
      const payment = payMap[lower];
      if (!payment) {
        const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
        return {
          messages: [`Forma de pagamento nao reconhecida. Escolha:\n\n${payList}`],
          session,
        };
      }
      const updatedSession = { ...session, paymentMethod: payment };
      const receipt = buildReceipt(updatedSession);
      return {
        messages: [`Resumo do Pedido:\n\n${receipt}\n\nConfirma o pedido?\n\n  1. Sim, confirmar\n  2. Cancelar`],
        session: { ...updatedSession, step: "confirm" },
      };
    }

    case "confirm": {
      if (lower === "1" || lower === "sim" || lower === "s" || lower.includes("sim")) {
        const timeMsg = session.deliveryType === "delivery" ? "40-60 minutos" : "20-30 minutos";
        const pixMsg = session.paymentMethod === "Pix" ? `\n\nChave Pix: (configurada pelo admin)` : "";
        return {
          messages: [`Pedido confirmado!\n\nObrigado, *${session.customerName?.split(" ")[0]}*! Seu pedido esta sendo preparado com muito carinho.\n\nTempo estimado: *${timeMsg}*${pixMsg}\n\nQualquer duvida, e so chamar! Bom apetite!`],
          session: { ...session, step: "done" },
        };
      }
      return {
        messages: [`Pedido cancelado.\n\nSe mudar de ideia, e so mandar uma mensagem!`],
        session: { ...session, step: "done" },
      };
    }

    case "done": {
      return {
        messages: [`Ola novamente! Quer fazer um novo pedido?\n\n${mensagemCategorias()}`],
        session: { step: "category", cart: [], deliveryFee: 0, customerName: session.customerName },
      };
    }

    default:
      return {
        messages: ["Desculpe, nao entendi. Vamos recomecar?"],
        session: { step: "welcome", cart: [], deliveryFee: 0 },
      };
  }
}

export function createInitialSession(): BotSession {
  return { step: "welcome", cart: [], deliveryFee: 0 };
}

export function createReturningSession(historico: ClienteHistorico): BotSession {
  return { step: "returning", cart: [], deliveryFee: 0, historico };
}

export function getWelcomeMessages(): string[] {
  return [`Ola! Bem-vindo a *Chefe da Pizza*!\n\nSou o ChefBot e vou te ajudar a fazer seu pedido.\n\nQual o seu nome?`];
}

