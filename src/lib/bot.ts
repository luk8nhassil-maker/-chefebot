import { MENU, getBorderPrice, getSizePrice, getMacarronadaPrice } from "./menu";
export type BotStep =
  | "welcome"
  | "returning"
  | "name"
  | "category"
  | "size"
  | "flavor"
  | "segundo_sabor"
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
  "Eita, nao entendi nao! Pode escolher uma dessas opcoes:",
  "Hmm, essa nao tah na lista nao. Olha so:",
  "Ops, nao achei essa opcao aqui! As disponiveis sao:",
  "Opa, acho que nao tem isso nao haha! Da uma olhada:",
  "Nao peguei essa, mas sem estresse! Escolhe uma daqui:",
];
const LIMITE_TENTATIVAS = 3;
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function msgInvalida(): string {
  return RESPOSTAS_INVALIDAS[Math.floor(Math.random() * RESPOSTAS_INVALIDAS.length)];
}
function precisaEscalar(texto: string): boolean {
  const n = normalizar(texto);
  return PALAVRAS_ESCALONAMENTO.some(p => n.includes(normalizar(p)));
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
    messages: ["Puts, toh tendo dificuldade em te ajudar com isso. Vou chamar a Kellyne pra te atender direitinho!"],
    session: {} as BotSession,
    escalar: true,
  };
}
function permiteMeioAMeio(size?: string): boolean {
  return size === "M" || size === "G" || size === "F";
}
function detectaDoisSabores(n: string, allFlavors: string[]): [string, string] | null {
  const encontrados: string[] = [];
  for (const f of allFlavors) {
    if (n.includes(normalizar(f))) {
      encontrados.push(f);
      if (encontrados.length === 2) break;
    }
  }
  if (encontrados.length === 2) return [encontrados[0], encontrados[1]];
  const nums = n.match(/\d+/g);
  if (nums && nums.length >= 2) {
    const i1 = parseInt(nums[0]) - 1;
    const i2 = parseInt(nums[1]) - 1;
    if (i1 >= 0 && i1 < allFlavors.length && i2 >= 0 && i2 < allFlavors.length && i1 !== i2) {
      return [allFlavors[i1], allFlavors[i2]];
    }
  }
  return null;
}
function detectaIntencaoDireta(text: string): { category: string; label: string } | null {
  const n = normalizar(text);
  const todosSaboresPizza = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
  if (todosSaboresPizza.some(f => n.includes(normalizar(f)))) return { category: "pizza", label: "pizza" };
  if (n.includes("pizza") && !n.includes("mini")) return { category: "pizza", label: "pizza" };
  if (n.includes("calzone")) return { category: "lanche", label: "calzone" };
  if (n.includes("mini-pizza") || n.includes("mini pizza")) return { category: "lanche", label: "mini-pizza" };
  if (n.includes("macarronada")) return { category: "lanche", label: "macarronada" };
  if (n.includes("x-burguer") || n.includes("x burguer") || n.includes("hamburguer")) return { category: "lanche", label: "hamburguer" };
  if (n.includes("x-bacon")) return { category: "lanche", label: "x-bacon" };
  if (n.includes("x-tudo") || n.includes("x tudo")) return { category: "lanche", label: "x-tudo" };
  if (n.includes("batata") || n.includes("porcao")) return { category: "lanche", label: "porcao de batatas" };
  if (n.includes("lanche")) return { category: "lanche", label: "lanche" };
  if (n.includes("coca") || n.includes("refrigerante") || n.includes("guarana") ||
    n.includes("agua") || n.includes("cerveja") || n.includes("pepsi") || n.includes("bebida")) {
    return { category: "bebida", label: "bebida" };
  }
  if (n.includes("suco") || n.includes("vitamina") || n.includes("caja") ||
    n.includes("caju") || n.includes("acerola") || n.includes("goiaba") ||
    n.includes("bacuri") || n.includes("cupuacu") || n.includes("laranja") ||
    n.includes("maracuja") || n.includes("banana")) {
    return { category: "suco", label: "suco" };
  }
  return null;
}
function detectaTamanho(n: string): string | null {
  if (n === "1" || n.includes("pequen")) return "P";
  if (n === "2" || n.includes("medi")) return "M";
  if (n === "3" || n.includes("grand")) return "G";
  if (n === "4" || n.includes("famil")) return "F";
  if (n === "p") return "P";
  if (n === "m") return "M";
  if (n === "g") return "G";
  if (n === "f") return "F";
  return null;
}
function nomeCategoriaAtual(step: BotStep, currentCategory?: string): string {
  if (currentCategory === "pizza" || step === "size" || step === "flavor" || step === "segundo_sabor" || step === "border") return "pizza";
  if (currentCategory === "lanche" || step === "lanche_escolha" || step === "lanche_flavor" || step === "lanche_macarronada_size") return "lanche";
  if (currentCategory === "bebida" || step === "bebida_escolha") return "bebida";
  if (currentCategory === "suco" || step === "suco_escolha") return "suco";
  return "item atual";
}
function mensagemCategorias(): string {
  return `O que vai ser hoje? 😋\n\n  1. Pizza\n  2. Lanches\n  3. Bebidas\n  4. Sucos e Vitaminas`;
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
function resumoCarrinho(cart: CartItem[]): string {
  return cart.map((item, i) => {
    const parts = [item.name];
    if (item.size) parts.push(item.size);
    if (item.flavor) parts.push(item.flavor);
    if (item.border && item.border !== "Sem borda") parts.push(`+ ${item.border}`);
    return `  ${i + 1}. ${parts.join(" ")} - ${formatCurrency(item.price)}`;
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
      : "\n  Retirada na loja: gratuitinha 🏪";
  const obs = session.observacao ? `\n  ✏️ Obs: ${session.observacao}` : "";
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
  return MENU.neighborhoods.map((n, i) => `  ${i + 1}. ${n.name} - ${formatCurrency(n.fee)}`).join("\n");
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
  return { messages: [mensagemCategorias()], session: { ...session, step: "category" } };
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
  const aviso = tentativas === 2 ? "\n\n_(Precisando de ajuda? E so digitar *atendente*)_" : "";
  return {
    messages: [`${msgInvalida()}\n\n${lista}${aviso}`],
    session: novaSession,
  };
}
function eNegativa(n: string): boolean {
  return n === "nao" || n === "n" || n === "nao obrigado" || n === "nao, obrigado" ||
    n.startsWith("nao ") || n.includes("nao quero") || n.includes("nao preciso") ||
    n.includes("nao tenho") || n.includes("so isso") || n.includes("pode fechar") ||
    n.includes("finalizar") || n.includes("fechar") || n.includes("chega") ||
    n.includes("e so") || n.includes("encerra") || n === "nao obrigado" ||
    n.includes("nao vai") || n.includes("nao mais") || n.includes("ta bom assim") ||
    n.includes("assim ta bom");
}
function ePositiva(n: string): boolean {
  return n === "sim" || n === "s" || n === "1" || n.includes("sim") ||
    n.includes("quero") || n.includes("pode") || n.includes("bora") ||
    n.includes("claro") || n.includes("vai") || n.includes("beleza") ||
    n.includes("ok") || n.includes("certo") || n.includes("isso");
}
export function processMessage(input: string, session: BotSession): BotResponse {
  const text = input.trim();
  const n = normalizar(text);
  if (session.step !== "escalado" && precisaEscalar(text)) {
    return {
      messages: [`Ja to chamando a Kellyne pra te ajudar! Ela entra em contato ai em breve. So aguarda um pouquinho! 😊`],
      session: { ...session, step: "escalado", escalado: true },
      escalar: true,
    };
  }
  switch (session.step) {
    case "escalado": {
      return { messages: [`A Kellyne ja foi avisada e vem ai em breve! So aguarda. 😊`], session };
    }
    case "welcome": {
      return {
        messages: [`Oi! Bem-vindo a *Chefe da Pizza*! 👋\n\nMe fala seu nome pra gente comecar?`],
        session: { ...session, step: "name" },
      };
    }
    case "returning": {
      const historico = session.historico!;
      const firstName = historico.nome.split(" ")[0];
      const ultimoPedido = historico.ultimoPedido.join(", ");
      if (ePositiva(n)) {
        return {
          messages: [`Que bom te ver de novo, *${firstName}*! 😊\n\n${mensagemCategorias()}`],
          session: resetaTentativas({ ...session, step: "category", customerName: historico.nome }),
        };
      }
      if (eNegativa(n)) {
        return { messages: [`Tudo bem! Me fala seu nome?`], session: resetaTentativas({ ...session, step: "name", historico: undefined }) };
      }
      return {
        messages: [`Ei *${firstName}*, que saudade! 😊 Seu ultimo pedido foi: *${ultimoPedido}*\n\nVai querer pedir mais?\n\n  1. Sim, bora!\n  2. Nao, valeu`],
        session,
      };
    }
    case "name": {
      if (!text || text.length < 2) return respostaInvalida("Me fala seu nome pra eu te atender melhor!", session);
      const firstName = text.split(" ")[0];
      const intencao = detectaIntencaoDireta(text);
      if (intencao) {
        const response = handleCategory(intencao.category, { ...session, step: "category", customerName: text });
        return { ...response, messages: [`Perfeito, *${firstName}*!\n\n${response.messages[0]}`], session: resetaTentativas(response.session) };
      }
      return {
        messages: [`Prazer, *${firstName}*! ${mensagemCategorias()}`],
        session: resetaTentativas({ ...session, step: "category", customerName: text }),
      };
    }
    case "category": {
      const intencao = detectaIntencaoDireta(text);
      let category = "";
      if (n === "1" || n.includes("pizza")) category = "pizza";
      else if (n === "2" || n.includes("lanche")) category = "lanche";
      else if (n === "3" || n.includes("bebida")) category = "bebida";
      else if (n === "4" || n.includes("suco") || n.includes("vitamina")) category = "suco";
      else if (intencao) category = intencao.category;
      if (!category) return respostaInvalida(mensagemCategorias(), session);
      return { ...handleCategory(category, session), session: resetaTentativas(handleCategory(category, session).session) };
    }
    case "confirmando_mudanca": {
      if (ePositiva(n) || n.includes("manter") || n.includes("continua")) {
        const categoriaAtual = session.currentCategory ?? "pizza";
        return { ...handleCategory(categoriaAtual, { ...session, step: "category", pendingCategory: undefined }), session: resetaTentativas(handleCategory(categoriaAtual, { ...session, step: "category", pendingCategory: undefined }).session) };
      }
      if (eNegativa(n) || n.includes("troca") || n.includes("muda") || n === "2") {
        const pendingCategory = session.pendingCategory ?? "pizza";
        return { ...handleCategory(pendingCategory, { ...session, pendingCategory: undefined }), session: resetaTentativas(handleCategory(pendingCategory, { ...session, pendingCategory: undefined }).session) };
      }
      return respostaInvalida(`  1. Manter\n  2. Ir pro outro`, session);
    }
    case "size": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const size = detectaTamanho(n);
      if (!size) return respostaInvalida(`  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`, session);
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
      const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
      if (permiteMeioAMeio(size)) {
        const dois = detectaDoisSabores(n, allFlavors);
        if (dois) {
          const flavorFinal = `${dois[0]}/${dois[1]}`;
          const borderPrice = getBorderPrice(size);
          return {
            messages: [`Pizza *${size}* meio a meio *${dois[0]}* e *${dois[1]}*! Vai querer borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
            session: resetaTentativas({ ...session, step: "border", currentSize: size, currentFlavor: flavorFinal }),
          };
        }
      }
      return {
        messages: [`Pizza *${size}* anotada! Qual o sabor?\n\nSalgadas\n${saltyList}\n\nDoces\n${sweetList}`],
        session: resetaTentativas({ ...session, step: "flavor", currentSize: size }),
      };
    }
    case "flavor": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      if (permiteMeioAMeio(session.currentSize)) {
        const dois = detectaDoisSabores(n, allFlavors);
        if (dois) {
          const flavorFinal = `${dois[0]}/${dois[1]}`;
          const borderPrice = getBorderPrice(session.currentSize!);
          return {
            messages: [`Meio a meio *${dois[0]}* e *${dois[1]}*! Vai querer borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
            session: resetaTentativas({ ...session, step: "border", currentFlavor: flavorFinal }),
          };
        }
      }
      let flavor: string | undefined;
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= allFlavors.length) {
        flavor = allFlavors[num - 1];
      } else {
        flavor = allFlavors.find((f) => n.includes(normalizar(f)));
      }
      if (!flavor) {
        const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
        return respostaInvalida(`Salgadas\n${saltyList}\n\nDoces\n${sweetList}`, session);
      }
      if (permiteMeioAMeio(session.currentSize)) {
        return {
          messages: [`*${flavor}*, otima escolha! 😋 Vai querer meio a meio?\n\n  1. Sim, quero dois sabores\n  2. Nao, so esse sabor`],
          session: resetaTentativas({ ...session, step: "segundo_sabor", currentFlavor: flavor }),
        };
      }
      const borderPrice = getBorderPrice(session.currentSize!);
      return {
        messages: [`*${flavor}*, otima escolha! 😋 Vai querer borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
        session: resetaTentativas({ ...session, step: "border", currentFlavor: flavor }),
      };
    }
    case "segundo_sabor": {
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      const naoQuerSegundo = n === "2" || eNegativa(n) || n.includes("so esse") || n.includes("apenas esse") || n.includes("so um");
      if (naoQuerSegundo) {
        const borderPrice = getBorderPrice(session.currentSize!);
        return {
          messages: [`Combinado! Vai querer borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
          session: resetaTentativas({ ...session, step: "border" }),
        };
      }
      if (n === "1" || n.includes("sim") || n.includes("quero") || n.includes("dois") || n.includes("meio")) {
        const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
        return {
          messages: [`Qual o segundo sabor?\n\nSalgadas\n${saltyList}\n\nDoces\n${sweetList}`],
          session: resetaTentativas({ ...session, step: "segundo_sabor" }),
        };
      }
      let flavor2: string | undefined;
      const num = parseInt(text);
      if (!isNaN(num) && num >= 1 && num <= allFlavors.length) {
        flavor2 = allFlavors[num - 1];
      } else {
        flavor2 = allFlavors.find((f) => n.includes(normalizar(f)));
      }
      if (!flavor2) {
        const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
        return respostaInvalida(`Salgadas\n${saltyList}\n\nDoces\n${sweetList}`, session);
      }
      if (flavor2 === session.currentFlavor) {
        const borderPrice = getBorderPrice(session.currentSize!);
        return {
          messages: [`Esse e o mesmo sabor! Vou considerar so *${flavor2}* entao 😄 Vai querer borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
          session: resetaTentativas({ ...session, step: "border" }),
        };
      }
      const flavorFinal = `${session.currentFlavor}/${flavor2}`;
      const borderPrice = getBorderPrice(session.currentSize!);
      return {
        messages: [`Meio a meio *${session.currentFlavor}* e *${flavor2}*! 😋 Vai querer borda recheada?\n\n  1. Sim - ${formatCurrency(borderPrice)}\n  2. Nao`],
        session: resetaTentativas({ ...session, step: "border", currentFlavor: flavorFinal }),
      };
    }
    case "border": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const querBorda = ePositiva(n) || n.includes("com borda");
      const naoBorda = eNegativa(n) || n.includes("sem borda") || n === "2";
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
        messages: [`🛒 *Carrinho atualizado!*\n\n${resumoCarrinho(newCart)}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nVai querer mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`],
        session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined }),
      };
    }
    case "add_more": {
      if (n === "1" || n.includes("mais pizza") || n.includes("outra pizza") || n.includes("mais uma")) {
        return { messages: [`Qual o tamanho da proxima pizza?\n\n  1. Pequena (P) - R$ 35,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n  4. Familia (F) - R$ 55,00`], session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza" }) };
      }
      if (n === "2" || n.includes("outro") || n.includes("mais alguma") || n.includes("adicionar")) {
        return { messages: [`Claro! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category" }) };
      }
      if (eNegativa(n) || n === "3") {
        return {
          messages: [`Otimo! Tem alguma observacao pro pedido? ✏️\n\nEx: _tirar cebola, sem borda, mal passado..._\n\nSe nao tiver e so digitar *0*`],
          session: resetaTentativas({ ...session, step: "observacao" }),
        };
      }
      const intencaoDireta = detectaIntencaoDireta(text);
      if (intencaoDireta) {
        return { messages: [`Claro! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category" }) };
      }
      return respostaInvalida(`  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`, session);
    }
    case "observacao": {
      const semObservacao = n === "0" || n === "nao" || n === "n" || n === "nenhuma" ||
        n === "nao tenho" || n === "sem observacao" || n === "nada" || n === "nenhum" ||
        n === "nao preciso" || n === "nao ha" || n.includes("sem obs") || n.includes("ta bom assim") ||
        n.includes("nao tem") || n.includes("pode seguir") || n.includes("pode continuar");
      if (semObservacao) {
        return {
          messages: [`Combinado! Como prefere receber?\n\n  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`],
          session: resetaTentativas({ ...session, step: "delivery_type", observacao: undefined }),
        };
      }
      return {
        messages: [`Anotei: _"${text}"_ ✏️\n\nComo prefere receber?\n\n  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`],
        session: resetaTentativas({ ...session, step: "delivery_type", observacao: text }),
      };
    }
    case "delivery_type": {
      if (n === "1" || n.includes("entrega") || n.includes("delivery") || n.includes("entregar") || n.includes("minha casa")) {
        return { messages: [`Qual seu bairro? 🛵\n\n${neighborhoodList()}`], session: resetaTentativas({ ...session, step: "neighborhood", deliveryType: "delivery" }) };
      }
      if (n === "2" || n.includes("retirar") || n.includes("loja") || n.includes("buscar") || n.includes("pegar") || n.includes("retiro")) {
        const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
        return { messages: [`Combinado, voce retira aqui na loja! 🏪 Como vai pagar?\n\n${payList}`], session: resetaTentativas({ ...session, step: "payment", deliveryType: "pickup", deliveryFee: 0, neighborhood: undefined }) };
      }
      return respostaInvalida(`  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`, session);
    }
    case "neighborhood": {
      const num = parseInt(text);
      let found: { name: string; fee: number } | undefined;
      if (!isNaN(num) && num >= 1 && num <= MENU.neighborhoods.length) found = MENU.neighborhoods[num - 1];
      else found = MENU.neighborhoods.find((nb) => normalizar(nb.name).includes(n));
      if (!found) return respostaInvalida(neighborhoodList(), session);
      return { messages: [`*${found.name}*, taxa de entrega: ${formatCurrency(found.fee)} 🛵\n\nMe passa o endereco completo:\n_(Rua, numero e complemento)_`], session: resetaTentativas({ ...session, step: "address", neighborhood: found.name, deliveryFee: found.fee }) };
    }
    case "address": {
      if (!text || text.length < 5) return respostaInvalida("Me passa o endereco completo.\nExemplo: *Rua das Flores, 123, Apto 2*", session);
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      return { messages: [`Anotei o endereco! Como vai pagar? 💸\n\n${payList}`], session: resetaTentativas({ ...session, step: "payment", address: text }) };
    }
    case "payment": {
      let payment = "";
      if (n === "1" || n.includes("pix") || n.includes("transfer")) payment = "Pix";
      else if (n === "2" || n.includes("dinheiro") || n.includes("especie") || n.includes("cash")) payment = "Dinheiro";
      else if (n === "3" || n.includes("cartao") || n.includes("credito") || n.includes("debito")) payment = "Cartao";
      if (!payment) return respostaInvalida(MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n"), session);
      const updatedSession = { ...session, paymentMethod: payment };
      const receipt = buildReceipt(updatedSession);
      return { messages: [`Feito! Da uma olhadinha no pedido pra confirmar: 🛒\n\n${receipt}\n\nTa certinho?\n\n  1. Sim, confirmar\n  2. Nao, retirar`], session: resetaTentativas({ ...updatedSession, step: "confirm" }) };
    }
    case "confirm": {
      const confirma = ePositiva(n) || n.includes("confirmar") || n.includes("correto") ||
        n.includes("ta bom") || n.includes("fechou") || n.includes("pode");
      const retira = n === "2" || n.includes("retirar") || n.includes("cancela") || n.includes("errado") ||
        (eNegativa(n) && !n.includes("nao obrigado"));
      if (confirma) {
        const timeMsg = session.deliveryType === "delivery" ? "40-60 minutos" : "20-30 minutos";
        const pixMsg = session.paymentMethod === "Pix" ? `\n\nChave Pix: (configurada pelo admin) 💸` : "";
        return { messages: [`Pedido confirmado! Ja mandamos pra cozinha! 🍕\n\nObrigado, *${session.customerName?.split(" ")[0]}*! Tempo estimado: *${timeMsg}* 🛵${pixMsg}\n\nQualquer duvida e so chamar. Bom apetite!`], session: { ...session, step: "done" } };
      }
      if (retira) {
        return { messages: [`Tudo bem, pedido retirado! Se mudar de ideia e so chamar. 😊`], session: { ...session, step: "done" } };
      }
      return respostaInvalida(`  1. Sim, confirmar\n  2. Nao, retirar`, session);
    }
    case "lanche_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const num = parseInt(text);
      let lanche = MENU.lanches.find((l) => normalizar(l.name) === n);
      if (!lanche && !isNaN(num) && num >= 1 && num <= MENU.lanches.length) lanche = MENU.lanches[num - 1];
      if (!lanche) lanche = MENU.lanches.find((l) => n.includes(normalizar(l.name)));
      if (!lanche) return respostaInvalida(listaLanches(), session);
      if (lanche.name === "Macarronada de Carne") {
        return { messages: [`Otima escolha! 😋 Qual tamanho da *Macarronada de Carne*?\n\n  1. Pequena (P) - R$ 28,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00\n\n_(Bacon ou ovos: acrescimo de R$ 10,00)_`], session: resetaTentativas({ ...session, step: "lanche_macarronada_size", currentLanche: lanche.name }) };
      }
      if (lanche.hasFlavors) {
        const flavors = MENU[lanche.flavorsKey as keyof typeof MENU] as string[];
        const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return { messages: [`*${lanche.name}* selecionado! 😋 Qual sabor?\n\n${lista}`], session: resetaTentativas({ ...session, step: "lanche_flavor", currentLanche: lanche.name }) };
      }
      const newItem: CartItem = { category: "lanche", name: lanche.name, price: lanche.price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return { messages: [`🛒 *Carrinho atualizado!*\n\n${resumoCarrinho(newCart)}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nVai querer mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "lanche_flavor": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const lanche = MENU.lanches.find(l => l.name === session.currentLanche)!;
      const flavors = MENU[lanche.flavorsKey as keyof typeof MENU] as string[];
      const num = parseInt(text);
      let flavor: string | undefined;
      if (!isNaN(num) && num >= 1 && num <= flavors.length) flavor = flavors[num - 1];
      else flavor = flavors.find(f => normalizar(f) === n) || flavors.find(f => n.includes(normalizar(f)));
      if (!flavor) return respostaInvalida(flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n"), session);
      const newItem: CartItem = { category: "lanche", name: lanche.name, flavor, price: lanche.price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return { messages: [`🛒 *Carrinho atualizado!*\n\n${resumoCarrinho(newCart)}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nVai querer mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "lanche_macarronada_size": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const size = detectaTamanho(n);
      if (!size || size === "F") return respostaInvalida(`  1. Pequena (P) - R$ 28,00\n  2. Media (M) - R$ 40,00\n  3. Grande (G) - R$ 50,00`, session);
      const price = getMacarronadaPrice(size);
      const newItem: CartItem = { category: "lanche", name: "Macarronada de Carne", size, price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return { messages: [`🛒 *Carrinho atualizado!*\n\n${resumoCarrinho(newCart)}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nVai querer mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "bebida_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const num = parseInt(text);
      let bebida = MENU.bebidas.find(b => normalizar(b.name).includes(n));
      if (!bebida && !isNaN(num) && num >= 1 && num <= MENU.bebidas.length) bebida = MENU.bebidas[num - 1];
      if (!bebida) return respostaInvalida(listaBebidas(), session);
      const newItem: CartItem = { category: "bebida", name: bebida.name, price: bebida.price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return { messages: [`🛒 *Carrinho atualizado!*\n\n${resumoCarrinho(newCart)}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nVai querer mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
    }
    case "suco_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const num = parseInt(text);
      let suco = MENU.sucos.find(s => normalizar(s.name).includes(n));
      if (!suco && !isNaN(num) && num >= 1 && num <= MENU.sucos.length) suco = MENU.sucos[num - 1];
      if (!suco) return respostaInvalida(`${listaSucos()}\n\n_(Com leite: acrescimo de R$ 1,00)_`, session);
      const newItem: CartItem = { category: "suco", name: suco.name, price: suco.price };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      return { messages: [`🛒 *Carrinho atualizado!*\n\n${resumoCarrinho(newCart)}\n\n  Subtotal: ${formatCurrency(subtotal)}\n\nVai querer mais alguma coisa?\n\n  1. Mais uma pizza\n  2. Outro produto\n  3. Nao, pode fechar`], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
    }
    case "done": {
      return { messages: [`Oi de novo! ${mensagemCategorias()}`], session: resetaTentativas({ step: "category", cart: [], deliveryFee: 0, customerName: session.customerName }) };
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
  return [`Oi! Bem-vindo a *Chefe da Pizza*! 👋\n\nMe fala seu nome pra gente comecar?`];
}