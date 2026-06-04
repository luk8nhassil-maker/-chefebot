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
  | "confirmando_mudanca"
  | "observacao"
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
  pendingCategory?: string;
  deliveryType?: "delivery" | "pickup";
  neighborhood?: string;
  address?: string;
  deliveryFee: number;
  paymentMethod?: string;
  escalado?: boolean;
  historico?: ClienteHistorico;
  tentativasInvalidas?: number;
  observacao?: string;
  pedidoId?: string;
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
const RESPOSTAS_INVALIDAS = [
  "Eita, essa opcao nao existe nao! Da uma olhada aqui:",
  "Hmm, nao achei essa opcao. Pode escolher uma dessas:",
  "Ops, acho que nao tem isso aqui! Olha so o que tem:",
  "Essa eu nao conheco nao haha! As opcoes sao essas:",
  "Nao entendi, mas sem estresse! Escolhe uma dessas:",
];
const LIMITE_TENTATIVAS = 3;
function msgInvalida(): string {
  return RESPOSTAS_INVALIDAS[Math.floor(Math.random() * RESPOSTAS_INVALIDAS.length)];
}
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
function incrementaTentativas(session: BotSession): BotSession {
  return { ...session, tentativasInvalidas: (session.tentativasInvalidas || 0) + 1 };
}
function resetaTentativas(session: BotSession): BotSession {
  return { ...session, tentativasInvalidas: 0 };
}
function atingiuLimite(session: BotSession): boolean {
  return (session.tentativasInvalidas || 0) >= LIMITE_TENTATIVAS;
}
function respostaEscaladaPorLoop(): BotResponse {
  return {
    messages: [
      "Parece que estou tendo dificuldade em te ajudar com isso. Vou chamar a Kellyne para te atender pessoalmente!",
    ],
    session: {} as BotSession,
    escalar: true,
  };
}
function detectaIntencaoDireta(text: string): { category: string; label: string } | null {
  const lower = text.toLowerCase();
  const todosSaboresPizza = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
  if (todosSaboresPizza.some(f => lower.includes(f.toLowerCase()))) return { category: "pizza", label: "pizza" };
  if (lower.includes("pizza") && !lower.includes("mini")) return { category: "pizza", label: "pizza" };
  if (lower.includes("calzone")) return { category: "lanche", label: "calzone" };
  if (lower.includes("mini-pizza") || lower.includes("mini pizza")) return { category: "lanche", label: "mini-pizza" };
  if (lower.includes("macarronada")) return { category: "lanche", label: "macarronada" };
  if (lower.includes("x-burguer") || lower.includes("x burguer") || lower.includes("hamburguer")) return { category: "lanche", label: "hamburguer" };
  if (lower.includes("x-bacon")) return { category: "lanche", label: "x-bacon" };
  if (lower.includes("x-tudo") || lower.includes("x tudo")) return { category: "lanche", label: "x-tudo" };
  if (lower.includes("batata") || lower.includes("porcao")) return { category: "lanche", label: "porcao de batatas" };
  if (lower.includes("lanche")) return { category: "lanche", label: "lanche" };
  if (lower.includes("coca") || lower.includes("refrigerante") || lower.includes("guarana") ||
    lower.includes("agua") || lower.includes("cerveja") || lower.includes("pepsi") || lower.includes("bebida")) {
    return { category: "bebida", label: "bebida" };
  }
  if (lower.includes("suco") || lower.includes("vitamina") || lower.includes("caja") ||
    lower.includes("caju") || lower.includes("acerola") || lower.includes("goiaba") ||
    lower.includes("bacuri") || lower.includes("cupuacu") || lower.includes("laranja") ||
    lower.includes("maracuja") || lower.includes("banana")) {
    return { category: "suco", label: "suco" };
  }
  return null;
}
function detectaTamanho(lower: string): string | null {
  if (lower === "1" || lower.includes("pequen")) return "P";
  if (lower === "2" || lower.includes("medi") || lower === "m") return "M";
  if (lower === "3" || lower.includes("grand") || lower === "g") return "G";
  if (lower === "4" || lower.includes("famil") || lower === "f") return "F";
  if (lower === "p") return "P";
  return null;
}
function nomeCategoriaAtual(step: BotStep, currentCategory?: string): string {
  if (currentCategory === "pizza" || step === "size" || step === "flavor" || step === "border") return "pizza";
  if (currentCategory === "lanche" || step === "lanche_escolha" || step === "lanche_flavor" || step === "lanche_macarronada_size") return "lanche";
  if (currentCategory === "bebida" || step === "bebida_escolha") return "bebida";
  if (currentCategory === "suco" || step === "suco_escolha") return "suco";
  return "item atual";
}
function mensagemCategorias(): string {
  return `O que voce deseja pedir?\n\n  1. Pizza\n  2. Lanches\n  3. Bebidas\n  4. Sucos e Vitaminas`;
}
function listaBebidas(): string {
  return MENU.bebidas.map((b, i) => `  ${i + 1}. ${b.name} - ${formatCurrency(b.price)}`).join("\n");
}
function listaSucos(): string {
  return MENU.sucos.map((s, i) => `  ${i + 1}. ${s.name} - ${formatCurrency(s.price)}`).join("\n");
}
function listaLanches(): string {
  return MENU.lanches.map((l, i) => {
    if (l.sizes && l.sizes.length > 0) {
      const precos = l.sizes.map((s: {code: string, price: number}) => `${s.code} ${formatCurrency(s.price)}`).join(" | ");
      return `  ${i + 1}. ${l.name} - ${precos}`;
    }
    return `  ${i + 1}. ${l.name} - ${formatCurrency(l.price)}`;
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
  const obs = session.observacao ? `\n  Obs: ${session.observacao}` : "";
  return (
    lines.join("\n") +
    `\n\n  Subtotal: ${formatCurrency(subtotal)}` +
    delivery +
    obs +
    `\n  *Total: ${formatCurrency(total)}*` +
    `\n  Pagamento: ${session.paymentMethod}`
  );
}
function neighborhoodList(): string {
  return MENU.neighborhoods
    .map((n, i) => `  ${i + 1}. ${n.name} - ${formatCurrency(n.fee)}`)
    .join("\n");
}
function handleCategory(category: string, session: BotSession): BotResponse {
  if (category === "pizza") {
    return {
      messages: [`Qual o tamanho da pizza?\n\n  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`],
      session: { ...session, step: "size", currentCategory: "pizza", currentSize: undefined, currentFlavor: undefined, currentLanche: undefined },
    };
  }
  if (category === "lanche") {
    return {
      messages: [`Nossos lanches:\n\n${listaLanches()}\n\nDigite o numero ou o nome:`],
      session: { ...session, step: "lanche_escolha", currentCategory: "lanche", currentSize: undefined, currentFlavor: undefined, currentLanche: undefined },
    };
  }
  if (category === "bebida") {
    return {
      messages: [`Nossas bebidas:\n\n${listaBebidas()}\n\nDigite o numero ou o nome:`],
      session: { ...session, step: "bebida_escolha", currentCategory: "bebida", currentSize: undefined, currentFlavor: undefined, currentLanche: undefined },
    };
  }
  if (category === "suco") {
    return {
      messages: [`Nossos sucos e vitaminas:\n\n${listaSucos()}\n\n_(Com leite: acrescimo de R$ 1,00)_\n\nDigite o numero ou o nome:`],
      session: { ...session, step: "suco_escolha", currentCategory: "suco", currentSize: undefined, currentFlavor: undefined, currentLanche: undefined },
    };
  }
  return {
    messages: [mensagemCategorias()],
    session: { ...session, step: "category" },
  };
}
function tentaMudanca(text: string, session: BotSession): BotResponse | null {
  const intencao = detectaIntencaoDireta(text);
  if (!intencao) return null;
  const categoriaAtual = nomeCategoriaAtual(session.step, session.currentCategory);
  if (intencao.category === session.currentCategory) return null;
  return {
    messages: [`Ei, voce ainda quer o *${categoriaAtual}*? Ou prefere ir direto pro *${intencao.label}*?\n\n  1. Manter o ${categoriaAtual}\n  2. Ir pro ${intencao.label}`],
    session: { ...session, step: "confirmando_mudanca", pendingCategory: intencao.category },
  };
}
function respostaInvalida(lista: string, session: BotSession): BotResponse {
  const novaSession = incrementaTentativas(session);
  if (atingiuLimite(novaSession)) {
    const r = respostaEscaladaPorLoop();
    return { ...r, session: { ...novaSession, step: "escalado", escalado: true } };
  }
  const tentativas = novaSession.tentativasInvalidas || 0;
  const aviso = tentativas === 2 ? "\n\n_(Se precisar de ajuda, e so digitar *atendente*)_" : "";
  return {
    messages: [`${msgInvalida()}\n\n${lista}${aviso}`],
    session: novaSession,
  };
}
export function processMessage(input: string, session: BotSession): BotResponse {
  const text = input.trim();
  const lower = text.toLowerCase();
  if (session.step !== "escalado" && precisaEscalar(text)) {
    return {
      messages: [`Ja to chamando a Kellyne pra te ajudar! Ela entra em contato ai em breve pelo WhatsApp. So aguarda um pouquinho!`],
      session: { ...session, step: "escalado", escalado: true },
      escalar: true,
    };
  }
  switch (session.step) {
    case "escalado": {
      return { messages: [`A Kellyne ja foi avisada e vem ai em breve! So aguarda.`], session };
    }
    case "welcome": {
      return {
        messages: [`Oi! Bem-vindo a *Chefe da Pizza*! Fico feliz em te atender!\n\nMe fala seu nome pra gente comecar?`],
        session: { ...session, step: "name" },
      };
    }
    case "returning": {
      const historico = session.historico!;
      const firstName = historico.nome.split(" ")[0];
      const ultimoPedido = historico.ultimoPedido.join(", ");
      if (lower === "1" || lower === "sim" || lower === "s" || lower.includes("sim") || lower.includes("bora") || lower.includes("quero")) {
        return {
          messages: [`Que bom te ver de novo, *${firstName}*! Bora la!\n\n${mensagemCategorias()}`],
          session: resetaTentativas({ ...session, step: "category", customerName: historico.nome }),
        };
      }
      if (lower === "2" || lower === "nao" || lower === "n" || lower.includes("nao")) {
        return { messages: [`Tudo bem! Me fala seu nome?`], session: resetaTentativas({ ...session, step: "name", historico: undefined }) };
      }
      return {
        messages: [`Ei *${firstName}*, que saudade! Seu ultimo pedido foi: *${ultimoPedido}*\n\nVai querer pedir mais?\n\n  1. Sim, bora!\n  2. Nao, valeu`],
        session,
      };
    }
    case "name": {
      if (!text || text.length < 2) {
        return respostaInvalida("Me fala seu nome pra eu te atender melhor!", session);
      }
      const firstName = text.split(" ")[0];
      const intencao = detectaIntencaoDireta(text);
      if (intencao) {
        const response = handleCategory(intencao.category, { ...session, step: "category", customerName: text });
        return { ...response, messages: [`Perfeito, *${firstName}*!\n\n${response.messages[0]}`], session: resetaTentativas(response.session) };
      }
      return {
        messages: [`Prazer, *${firstName}*! O que vai ser hoje?\n\n${mensagemCategorias()}`],
        session: resetaTentativas({ ...session, step: "category", customerName: text }),
      };
    }
    case "category": {
      const intencao = detectaIntencaoDireta(text);
      let category = "";
      if (lower === "1" || lower.includes("pizza")) category = "pizza";
      else if (lower === "2" || lower.includes("lanche")) category = "lanche";
      else if (lower === "3" || lower.includes("bebida")) category = "bebida";
      else if (lower === "4" || lower.includes("suco") || lower.includes("vitamina")) category = "suco";
      else if (intencao) category = intencao.category;
      if (!category) return respostaInvalida(mensagemCategorias(), session);
      return { ...handleCategory(category, session), session: resetaTentativas(handleCategory(category, session).session) };
    }
    case "confirmando_mudanca": {
      if (lower === "1" || lower.includes("manter") || lower.includes("sim") || lower.includes("quero") || lower.includes("continua")) {
        const categoriaAtual = session.currentCategory ?? "pizza";
        return { ...handleCategory(categoriaAtual, { ...session, step: "category", pendingCategory: undefined }), session: resetaTentativas(handleCategory(categoriaAtual, { ...session, step: "category", pendingCategory: undefined }).session) };
      }
      if (lower === "2" || lower.includes("ir") || lower.includes("nao") || lower.includes("troca") || lower.includes("muda")) {
        const pendingCategory = session.pendingCategory ?? "pizza";
        return { ...handleCategory(pendingCategory, { ...session, pendingCategory: undefined }), session: resetaTentativas(handleCategory(pendingCategory, { ...session, pendingCategory: undefined }).session) };
      }
      return respostaInvalida(`  1. Manter\n  2. Ir pro outro`, session);
    }
    case "size": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const size = detectaTamanho(lower);
      if (!size) return respostaInvalida(`  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`, session);
      const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
      const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
      return {
        messages: [`Pizza *${size}* anotada! Agora escolhe o sabor:\n\nSalgadas\n${saltyList}\n\nDoces\n${sweetList}`],
        session: resetaTentativas({ ...session, step: "flavor", currentSize: size }),
      };
    }
    case "flavor": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      let flavor: string | undefined;
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= allFlavors.length) {
        flavor = allFlavors[num - 1];
      } else {
        flavor = allFlavors.find((f) => lower.includes(f.toLowerCase()));
      }
      if (!flavor) {
        const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
        return respostaInvalida(`Salgadas\n${saltyList}\n\nDoces\n${sweetList}`, session);
      }
      const borderPrice = getBorderPrice(session.currentSize!);
      return {
        messages: [`*${flavor}*, otima escolha! Vai querer borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
        session: resetaTentativas({ ...session, step: "border", currentFlavor: flavor }),
      };
    }
    case "border": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const querBorda = lower === "1" || lower === "sim" || lower === "s" ||
        lower.includes("sim") || lower.includes("quero") || lower.includes("com borda") ||
        lower.includes("pode") || lower.includes("bora") || lower.includes("claro");
      const naoBorda = lower === "2" || lower === "nao" || lower === "n" ||
        lower.includes("nao") || lower.includes("sem borda") || lower.includes("nao quero");
      if (!querBorda && !naoBorda) {
        return respostaInvalida(`  1. Sim - ${formatCurrency(getBorderPrice(session.currentSize!))}\n  2. Nao`, session);
      }
      const border = querBorda ? "Borda recheada" : "Sem borda";
      const borderPrice = querBorda ? getBorderPrice(session.currentSize!) : 0;
      const basePrice = getSizePrice(session.currentSize!);
      const itemPrice = basePrice + borderPrice;
      const newItem: CartItem = { category: "pizza", name: "Pizza", size: session.currentSize!, flavor: session.currentFlavor!, border, price: itemPrice };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return {
        messages: [`Pizza adicionada!\n\nSeu pedido ate agora:\n${newCart.map((item, i) => `  ${i + 1}. ${item.size} ${item.flavor}${item.border !== "Sem borda" ? " + " + item.border : ""} - ${formatCurrency(item.price)}`).join("\n")}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nVai querer mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`],
        session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined }),
      };
    }
    case "add_more": {
      if (lower === "1" || lower.includes("mais pizza") || lower.includes("outra pizza") || lower.includes("mais uma")) {
        return { messages: [`Qual o tamanho da proxima pizza?\n\n  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`], session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza" }) };
      }
      if (lower === "2" || lower.includes("outro") || lower.includes("mais alguma") || lower.includes("adicionar")) {
        return { messages: [`Claro! O que mais vai querer?\n\n${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category" }) };
      }
      if (lower === "3" || lower.includes("nao") || lower.includes("finalizar") || lower.includes("fechar") ||
          lower.includes("so isso") || lower.includes("pode fechar") || lower.includes("e so") ||
          lower.includes("chega") || lower.includes("encerra") || lower === "nao obrigado" || lower === "nao, obrigado") {
        return {
          messages: [`Anotado! Tem alguma observacao pro seu pedido?\n\nEx: _tirar cebola, sem borda, mal passado..._\n\nSe nao tiver, e so digitar *0*`],
          session: resetaTentativas({ ...session, step: "observacao" }),
        };
      }
      const intencaoDireta = detectaIntencaoDireta(text);
      if (intencaoDireta) {
        return { messages: [`Claro! O que mais vai querer?\n\n${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category" }) };
      }
      return respostaInvalida(`  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`, session);
    }
    case "observacao": {
      const semObservacao = lower === "0" || lower === "nao" || lower === "n" || lower === "nenhuma" || lower === "nao tenho" || lower === "sem observacao" || lower === "nada" || lower === "nenhum";
      if (semObservacao) {
        return {
          messages: [`Combinado! Como prefere receber?\n\n  1. Entrega (delivery)\n  2. Buscar na loja`],
          session: resetaTentativas({ ...session, step: "delivery_type", observacao: undefined }),
        };
      }
      return {
        messages: [`Anotei: _"${text}"_ ✓\n\nComo prefere receber?\n\n  1. Entrega (delivery)\n  2. Buscar na loja`],
        session: resetaTentativas({ ...session, step: "delivery_type", observacao: text }),
      };
    }
    case "delivery_type": {
      if (lower === "1" || lower.includes("entrega") || lower.includes("delivery") || lower.includes("entregar") || lower.includes("minha casa")) {
        return { messages: [`Certo! Qual seu bairro?\n\n${neighborhoodList()}`], session: resetaTentativas({ ...session, step: "neighborhood", deliveryType: "delivery" }) };
      }
      if (lower === "2" || lower.includes("retirar") || lower.includes("loja") || lower.includes("buscar") || lower.includes("pegar") || lower.includes("retiro")) {
        const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
        return { messages: [`Combinado, voce retira aqui na loja! Como vai pagar?\n\n${payList}`], session: resetaTentativas({ ...session, step: "payment", deliveryType: "pickup", deliveryFee: 0, neighborhood: undefined }) };
      }
      return respostaInvalida(`  1. Entrega (delivery)\n  2. Buscar na loja`, session);
    }
    case "neighborhood": {
      const num = parseInt(text);
      let found: { name: string; fee: number } | undefined;
      if (!isNaN(num) && num >= 1 && num <= MENU.neighborhoods.length) found = MENU.neighborhoods[num - 1];
      else found = MENU.neighborhoods.find((n) => n.name.toLowerCase().includes(lower));
      if (!found) return respostaInvalida(neighborhoodList(), session);
      return { messages: [`*${found.name}*, taxa de entrega: ${formatCurrency(found.fee)}\n\nMe passa o endereco completo:\n_(Rua, numero e complemento)_`], session: resetaTentativas({ ...session, step: "address", neighborhood: found.name, deliveryFee: found.fee }) };
    }
    case "address": {
      if (!text || text.length < 5) return respostaInvalida("Me passa o endereco completo.\nExemplo: *Rua das Flores, 123, Apto 2*", session);
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      return { messages: [`Anotei o endereco! Como vai pagar?\n\n${payList}`], session: resetaTentativas({ ...session, step: "payment", address: text }) };
    }
    case "payment": {
      const payMap: Record<string, string> = {
        "1": "Pix", "2": "Dinheiro", "3": "Cartao",
        pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartao", credito: "Cartao", debito: "Cartao",
        transferencia: "Pix", chave: "Pix", "cartao de credito": "Cartao", "cartao de debito": "Cartao",
        especie: "Dinheiro", cash: "Dinheiro", "no cartao": "Cartao", "no pix": "Pix", "em dinheiro": "Dinheiro",
      };
      let payment = payMap[lower];
      if (!payment) {
        if (lower.includes("pix") || lower.includes("transfer")) payment = "Pix";
        else if (lower.includes("dinheiro") || lower.includes("especie") || lower.includes("cash")) payment = "Dinheiro";
        else if (lower.includes("cartao") || lower.includes("credito") || lower.includes("debito")) payment = "Cartao";
      }
      if (!payment) return respostaInvalida(MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n"), session);
      const updatedSession = { ...session, paymentMethod: payment };
      const receipt = buildReceipt(updatedSession);
      return { messages: [`Perfeito! Da uma conferida no pedido:\n\n${receipt}\n\nTa certinho?\n\n  1. Sim, confirmar\n  2. Retirar`], session: resetaTentativas({ ...updatedSession, step: "confirm" }) };
    }
    case "confirm": {
      const confirma = lower === "1" || lower === "sim" || lower === "s" || lower.includes("sim") ||
        lower.includes("confirmar") || lower.includes("correto") || lower.includes("ta bom") ||
        lower.includes("pode ser") || lower.includes("isso") || lower.includes("certo") ||
        lower.includes("ok") || lower.includes("beleza") || lower.includes("pode") || lower.includes("fechou");
      const retira = lower === "2" || lower.includes("retirar") || lower.includes("nao") || lower.includes("cancela") || lower.includes("errado");
      if (confirma) {
        const timeMsg = session.deliveryType === "delivery" ? "40-60 minutos" : "20-30 minutos";
        const pixMsg = session.paymentMethod === "Pix" ? `\n\nChave Pix: (configurada pelo admin)` : "";
        return { messages: [`Pedido confirmado! Ja passamos pra cozinha!\n\nObrigado, *${session.customerName?.split(" ")[0]}*! Tempo estimado: *${timeMsg}*${pixMsg}\n\nQualquer duvida e so chamar. Bom apetite!`], session: { ...session, step: "done" } };
      }
      if (retira) {
        return { messages: [`Tudo bem, pedido retirado! Se mudar de ideia e so chamar.`], session: { ...session, step: "done" } };
      }
      return respostaInvalida(`  1. Sim, confirmar\n  2. Retirar`, session);
    }
    case "done": {
      return { messages: [`Oi de novo! Vai querer pedir mais alguma coisa?\n\n${mensagemCategorias()}`], session: resetaTentativas({ step: "category", cart: [], deliveryFee: 0, customerName: session.customerName }) };
    }
    default:
      return { messages: ["Eita, me perdi aqui! Vamos comecar de novo?"], session: { step: "welcome", cart: [], deliveryFee: 0 } };
  }
}
export function createInitialSession(): BotSession {
  return { step: "welcome", cart: [], deliveryFee: 0, tentativasInvalidas: 0 };
}
export function createReturningSession(historico: ClienteHistorico): BotSession {
  return { step: "returning", cart: [], deliveryFee: 0, historico, tentativasInvalidas: 0 };
}
export function getWelcomeMessages(): string[] {
  return [`Oi! Bem-vindo a *Chefe da Pizza*! Fico feliz em te atender!\n\nMe fala seu nome pra gente comecar?`];
}