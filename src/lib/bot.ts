import { MENU as MENU_PADRAO, getBorderPrice, getBorderByIndex, getMacarronadaPrice } from "./menu";

let MENU = MENU_PADRAO;

export function setMenuDinamico(menu: typeof MENU_PADRAO) {
  MENU = menu;
}

let CONFIG_BOT = {
  tempoEntregaDelivery: "40-60 minutos",
  tempoEntregaRetirada: "20-30 minutos",
};

export function setConfigDinamica(cfg: { tempoEntregaDelivery?: string; tempoEntregaRetirada?: string }) {
  if (cfg.tempoEntregaDelivery) CONFIG_BOT.tempoEntregaDelivery = cfg.tempoEntregaDelivery;
  if (cfg.tempoEntregaRetirada) CONFIG_BOT.tempoEntregaRetirada = cfg.tempoEntregaRetirada;
}

function getSizePrice(size: string): number {
  return MENU.sizes.find((s) => s.code === size)?.price ?? 0;
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function sizeList(): string {
  return MENU.sizes.map((s, i) => `  ${i + 1}. ${s.label} (${s.code}) · *${formatCurrency(s.price)}*`).join("\n");
}

function listaFlavors(): string {
  const saltyList = MENU.saltyFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
  const sweetList = MENU.sweetFlavors.map((f, i) => `  ${MENU.saltyFlavors.length + i + 1}. ${f}`).join("\n");
  return `*SALGADAS*\n${saltyList}\n\n───────────\n\n*DOCES*\n${sweetList}`;
}

function mensagemAddMore(cart: CartItem[]): string {
  const subtotal = cartSubtotal(cart);
  return `🛒 *Seu pedido até agora:*\n${resumoCarrinho(cart)}\n\n  Subtotal: *${formatCurrency(subtotal)}*\n\nVai querer mais alguma coisa? 😊\n\n  1️⃣ Mais uma pizza\n  2️⃣ Quero mais alguma coisa\n  3️⃣ Não, pode fechar`;
}

export type BotStep =
  | "welcome"
  | "returning"
  | "name"
  | "category"
  | "size"
  | "flavor"
  | "segundo_sabor"
  | "border"
  | "border_escolha"
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
  | "confirm_address"
  | "payment"
  | "troco"
  | "confirm"
  | "aguardando_pix"
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
  ultimoCart?: CartItem[];
  ultimoDeliveryFee?: number;
  ultimoEndereco?: string;
  ultimoNeighborhood?: string;
  ultimoDeliveryType?: string;
  ultimoPayment?: string;
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
  pendingPizzas?: number;
  pizzaAtualIndex?: number;
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
  troco?: string;
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
  "Eita, não entendi não! Pode escolher uma dessas opções:",
  "Hmm, essa não tá na lista não. Olha só:",
  "Ops, não achei essa opção aqui! As disponíveis são:",
  "Opa, acho que não tem isso não haha! Dá uma olhada:",
  "Não peguei essa, mas sem estresse! Escolhe uma daqui:",
];
const LIMITE_TENTATIVAS = 3;
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[​-‍﻿]/g, "").trim();
}
function msgInvalida(): string {
  return RESPOSTAS_INVALIDAS[Math.floor(Math.random() * RESPOSTAS_INVALIDAS.length)];
}
function precisaEscalar(texto: string): boolean {
  const n = normalizar(texto);
  return PALAVRAS_ESCALONAMENTO.some(p => n.includes(normalizar(p)));
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
    messages: ["Puts, tô tendo dificuldade em te ajudar com isso. Vou chamar alguém pra te atender direitinho!"],
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
function detectaTamanhoDaMensagem(n: string): string | null {
  if (n.includes("pequen") || n.includes(" p ") || n.includes(" p,") || n.includes(" p.")) return "P";
  if (n.includes("medi") || n.includes(" m ") || n.includes(" m,") || n.includes(" m.")) return "M";
  if (n.includes("grand") || n.includes(" g ") || n.includes(" g,") || n.includes(" g.")) return "G";
  if (n.includes("famil") || n.includes(" f ") || n.includes(" f,") || n.includes(" f.")) return "F";
  return null;
}
function detectaBordaDaMensagem(n: string): string | null {
  if (n.includes("catupiry com cheddar") || n.includes("catupiry cheddar")) return "Catupiry com Cheddar";
  if (n.includes("catupiry")) return "Catupiry";
  if (n.includes("chocolate")) return "Chocolate";
  if (n.includes("cheddar")) return "Cheddar";
  if (n.includes("sem borda") || n.includes("nao quero borda") || n.includes("sem bord")) return "Sem borda";
  return null;
}
function detectaSaborDaMensagem(n: string): string | null {
  const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
  return allFlavors.find(f => n.includes(normalizar(f))) ?? null;
}
type PedidoCompleto = {
  size: string;
  flavor: string;
  border: string;
}
function detectaPedidoCompleto(text: string): PedidoCompleto | null {
  const n = normalizar(text);
  const size = detectaTamanhoDaMensagem(n);
  const flavor = detectaSaborDaMensagem(n);
  if (!size || !flavor) return null;
  const border = detectaBordaDaMensagem(n) ?? "Sem borda";
  return { size, flavor, border };
}
type PedidoParcial = {
  size?: string;
  flavor?: string;
  border?: string;
}
function detectaPedidoParcial(text: string): PedidoParcial | null {
  const n = normalizar(text);
  const size = detectaTamanhoDaMensagem(n);
  const flavor = detectaSaborDaMensagem(n);
  const border = detectaBordaDaMensagem(n);
  if (!size && !flavor && !border) return null;
  return { size: size ?? undefined, flavor: flavor ?? undefined, border: border ?? undefined };
}
function nomeCategoriaAtual(step: BotStep, currentCategory?: string): string {
  if (currentCategory === "pizza" || step === "size" || step === "flavor" || step === "segundo_sabor" || step === "border" || step === "border_escolha") return "pizza";
  if (currentCategory === "lanche" || step === "lanche_escolha" || step === "lanche_flavor" || step === "lanche_macarronada_size") return "lanche";
  if (currentCategory === "bebida" || step === "bebida_escolha") return "bebida";
  if (currentCategory === "suco" || step === "suco_escolha") return "suco";
  return "item atual";
}
function mensagemCategorias(): string {
  return `O que vai ser hoje? Temos coisa boa te esperando! 😋\n\n  1. Pizza\n  2. Lanches\n  3. Bebidas\n  4. Sucos e Vitaminas`;
}
function listaBordas(size: string): string {
  const preco = getBorderPrice(size);
  return MENU.borders.map((b, i) => `  ${i + 1}. *${b.label}* · *${formatCurrency(preco)}*`).join("\n") +
    `\n  ${MENU.borders.length + 1}. Sem borda`;
}
function listaBebidas(): string {
  return MENU.bebidas.map((b, i) => `  ${i + 1}. ${b.name} · *${formatCurrency(b.price)}*`).join("\n");
}
function listaSucos(): string {
  return MENU.sucos.map((s, i) => `  ${i + 1}. ${s.name} · *${formatCurrency(s.price)}*`).join("\n");
}
function listaLanches(): string {
  return MENU.lanches.map((l, i) => {
    if (l.sizes && l.sizes.length > 0) {
      const precos = l.sizes.map((s: {code: string, price: number}) => `${s.code} *${formatCurrency(s.price)}*`).join(" | ");
      return `  ${i + 1}. ${l.name} · ${precos}`;
    }
    return `  ${i + 1}. ${l.name} · *${formatCurrency(l.price)}*`;
  }).join("\n");
}
function getItemEmoji(item: CartItem): string {
  const n = (item.name + " " + (item.flavor || "")).toLowerCase();
  if (n.includes("pizza")) return "🍕";
  if (n.includes("hambur") || n.includes("x-burg") || n.includes("lanche")) return "🍔";
  if (n.includes("coca") || n.includes("pepsi") || n.includes("refri") || n.includes("guarana") || n.includes("bebida")) return "🥤";
  if (n.includes("suco") || n.includes("vitamina") || n.includes("acai")) return "🧃";
  if (n.includes("macarr") || n.includes("massa")) return "🍝";
  if (n.includes("frango") || n.includes("porcao")) return "🍗";
  if (n.includes("batata")) return "🍟";
  return "🍽️";
}
function resumoCarrinho(cart: CartItem[]): string {
  return cart.map((item) => {
    const emoji = getItemEmoji(item);
    const parts = [item.name];
    if (item.size) parts.push(item.size);
    if (item.flavor) parts.push(item.flavor);
    const bordaStr = item.border && item.border !== "Sem borda" ? ` + Borda ${item.border}` : "";
    return `  ${emoji} ${parts.join(" ")}${bordaStr} — *${formatCurrency(item.price)}*`;
  }).join("\n");
}
function buildReceipt(session: BotSession): string {
  const itemLines = session.cart.map((item) => {
    const emoji = getItemEmoji(item);
    const nameParts = [item.name];
    if (item.size) nameParts.push(item.size);
    if (item.flavor) nameParts.push(item.flavor);
    const hasBorda = item.border && item.border !== "Sem borda";
    if (hasBorda) {
      return `${emoji} *${nameParts.join(" ")}*\n   Borda ${item.border} · *${formatCurrency(item.price)}*`;
    }
    return `${emoji} *${nameParts.join(" ")}* · *${formatCurrency(item.price)}*`;
  });
  const subtotal = cartSubtotal(session.cart);
  const total = subtotal + session.deliveryFee;
  const deliveryLine = session.deliveryType === "delivery"
    ? `\n\n📍 *Entrega:* ${session.address}\n   Bairro ${session.neighborhood} · Taxa *${formatCurrency(session.deliveryFee)}*`
    : `\n\n🏪 *Retirada na loja* · _gratuita_`;
  const obsLine = session.observacao ? `\n\n✏️ _Obs: ${session.observacao}_` : "";
  const trocoLine = session.troco && session.troco !== "Sem troco"
    ? `\n💵 _${session.troco}_`
    : session.troco === "Sem troco" ? `\n💵 _Sem troco_` : "";
  return (
    itemLines.join("\n\n") +
    deliveryLine +
    obsLine +
    `\n\n💳 *Pagamento:* ${session.paymentMethod}` +
    trocoLine +
    `\n\n💰 *Total: ${formatCurrency(total)}*`
  );
}
function neighborhoodList(): string {
  return MENU.neighborhoods.map((n, i) => `  ${i + 1}. ${n.name} · *${formatCurrency(n.fee)}*`).join("\n");
}
function eVoltar(n: string): boolean {
  return n === "voltar" || n === "volta" || n === "errei" ||
    n.includes("quero mudar") || n.includes("mudei") || n.includes("voltar") ||
    n.includes("volta") || n.includes("errei") || n.includes("corrigir") ||
    n.includes("corrige") || n.includes("muda isso") || n.includes("nao era isso") ||
    n.includes("nao e isso") || n.includes("troquei") || n.includes("me enganei") ||
    n.includes("me equivoquei") || n.includes("errou") || n.includes("trocei");
}
function handleCategory(category: string, session: BotSession): BotResponse {
  if (category === "pizza") {
    return {
      messages: [`Qual o tamanho da pizza? 🍕\n\n${sizeList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
      session: { ...session, step: "size", currentCategory: "pizza", currentSize: undefined, currentFlavor: undefined, currentLanche: undefined },
    };
  }
  if (category === "lanche") {
    return {
      messages: [`Nossos lanches 😋\n\n${listaLanches()}\n\nDigite o número ou o nome:`],
      session: { ...session, step: "lanche_escolha", currentCategory: "lanche", currentSize: undefined, currentFlavor: undefined, currentLanche: undefined },
    };
  }
  if (category === "bebida") {
    return {
      messages: [`Nossas bebidas 🥤\n\n${listaBebidas()}\n\nDigite o número ou o nome:`],
      session: { ...session, step: "bebida_escolha", currentCategory: "bebida", currentSize: undefined, currentFlavor: undefined, currentLanche: undefined },
    };
  }
  if (category === "suco") {
    return {
      messages: [`Nossos sucos e vitaminas 🥤\n\n${listaSucos()}\n\n_(Com leite: acréscimo de R$ 1,00)_\n\nDigite o número ou o nome:`],
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
    messages: [`Ei, você ainda quer o *${categoriaAtual}*? Ou prefere ir direto pro *${intencao.label}*?\n\n  1. Manter o ${categoriaAtual}\n  2. Ir pro ${intencao.label}`],
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
  const aviso = tentativas === 2 ? "\n\n_(Precisando de ajuda? É só digitar *atendente*)_" : "";
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
    n.includes("e so") || n.includes("encerra") ||
    n.includes("nao vai") || n.includes("nao mais") || n.includes("ta bom assim") ||
    n.includes("assim ta bom");
}
function eConfusao(n: string): boolean {
  const palavras = ["nao entendi", "nao entendeu", "nao percebi", "nao compreendi", "como assim", "que isso", "que e isso", "nao to entendendo", "nao estou entendendo", "confuso", "confused", "o que", "oque", "hein", "ha", "nao sei", "pode explicar", "explica"];
  return palavras.some(p => n.includes(p));
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
  // Detecta quantidade de pizzas: "2 pizzas", "duas pizzas familia", "quero 2", "duas"
  if ((session.step === "size" || session.step === "category" || session.step === "add_more" || session.step === "name") && !session.pendingPizzas) {
    const qtdMap: Record<string, number> = { "uma": 1, "um": 1, "duas": 2, "dois": 2, "tres": 3, "três": 3, "quatro": 4, "cinco": 5 };
    const qtdMatchComPizza = n.match(/(\d+|duas?|dois|tr[eê]s|quatro|cinco)\s+pizzas?/);
    // No step "size" (pizza já escolhida), aceita quantidade sem mencionar "pizza"
    const qtdMatchSoPizza = (session.step === "size" || session.step === "add_more")
      ? n.match(/^(?:quero\s+)?(\d+|duas?|dois|tr[eê]s|quatro|cinco)(?:\s+|$)/)
      : null;
    const qtdMatch = qtdMatchComPizza || qtdMatchSoPizza;
    let qtd = 0;
    if (qtdMatch) qtd = parseInt(qtdMatch[1]) || qtdMap[qtdMatch[1].toLowerCase()] || 0;
    if (qtd >= 2 && qtd <= 5) {
      const pedidoCompleto = detectaPedidoCompleto(text);
      if (pedidoCompleto) {
        const { size, flavor, border } = pedidoCompleto;
        const basePrice = getSizePrice(size);
        const borderPrice = border !== "Sem borda" ? getBorderPrice(size) : 0;
        const itemPrice = basePrice + borderPrice;
        const novasPizzas: CartItem[] = Array.from({ length: qtd }, () => ({ category: "pizza", name: "Pizza", size, flavor, border, price: itemPrice }));
        const newCart = [...session.cart, ...novasPizzas];
        return {
          messages: [
            `${qtd} pizzas *${size}* de *${flavor}* com borda *${border}* anotadas! 🤤`,
            mensagemAddMore(newCart),
          ],
          session: resetaTentativas({ ...session, step: "add_more", cart: newCart, pendingPizzas: undefined, pizzaAtualIndex: undefined }),
        };
      }
      const size = detectaTamanhoDaMensagem(n);
      if (size) {
        return {
          messages: [
            `2️⃣ *${qtd} pizzas ${size}* anotadas! Vamos montar uma de cada vez 🍕`,
            `*Pizza 1 de ${qtd}* — Qual o sabor? 😋\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
          ],
          session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: size, pendingPizzas: qtd, pizzaAtualIndex: 1 }),
        };
      }
      return {
        messages: [`2️⃣ *${qtd} pizzas* anotadas! Vamos montar uma de cada vez 🍕\n\n*Pizza 1 de ${qtd}* — Qual o tamanho?\n\n${sizeList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
        session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza", pendingPizzas: qtd, pizzaAtualIndex: 1 }),
      };
    }
  }

  if (session.step !== "escalado" && precisaEscalar(text)) {
    return {
      messages: [`Já chamo alguém pra te ajudar! Aguarda um instantinho 😊`],
      session: { ...session, step: "escalado", escalado: true },
      escalar: true,
    };
  }
  if (session.step !== "escalado" && session.step !== "name" && session.step !== "address" && session.step !== "observacao" && eConfusao(n)) {
    const dicas: Partial<Record<BotStep, string>> = {
      category: `Sem estresse! É só escolher o que vai querer:\n\n${mensagemCategorias()}`,
      size: `É só escolher o tamanho da pizza:\n\n${sizeList()}`,
      flavor: `É só digitar o número ou o nome do sabor que você quer! 😋`,
      border_escolha: `É só escolher o número da borda ou digitar o nome. Se não quiser borda é só digitar o número ${MENU.borders.length + 1}!`,
      add_more: `É só escolher uma opção:\n\n  1️⃣ Mais uma pizza\n  2️⃣ Quero mais alguma coisa\n  3️⃣ Não, pode fechar`,
      delivery_type: `É só me dizer como prefere receber:\n\n  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`,
      neighborhood: `É só digitar o número ou o nome do seu bairro!`,
      payment: `É só escolher como vai pagar:\n\n  1. Pix 💸\n  2. Dinheiro\n  3. Cartão`,
      confirm: `É só confirmar o pedido:\n\n  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`,
    };
    const dica = dicas[session.step];
    if (dica) {
      return { messages: [`Opa, deixa eu explicar melhor! 😊\n\n${dica}`], session: resetaTentativas(session) };
    }
  }

  if (eVoltar(n) && !["welcome", "name", "returning", "category", "escalado", "done", "add_more"].includes(session.step)) {
    switch (session.step) {
      case "flavor":
        return { messages: [`Tudo bem! Qual o tamanho da pizza então? 😊\n\n${sizeList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "size", currentFlavor: undefined }) };
      case "border_escolha":
      case "segundo_sabor":
        return { messages: [`Tudo bem! Qual o sabor então? 😊\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "flavor", currentFlavor: undefined }) };
      case "observacao":
        return { messages: [`Tudo bem! Vai querer mais alguma coisa? 😊\n\n  1️⃣ Mais uma pizza\n  2️⃣ Quero mais alguma coisa\n  3️⃣ Não, pode fechar`], session: resetaTentativas({ ...session, step: "add_more" }) };
      case "delivery_type":
        return { messages: [`Tudo bem! Tem algum detalhe especial pro pedido? ✏️\n\nSe não tiver é só digitar *0*`], session: resetaTentativas({ ...session, step: "observacao" }) };
      case "neighborhood":
        return { messages: [`Tudo bem! Como prefere receber? 😊\n\n  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`], session: resetaTentativas({ ...session, step: "delivery_type" }) };
      case "address":
        return { messages: [`Tudo bem! Qual seu bairro? 🛵\n\n${neighborhoodList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "neighborhood" }) };
      case "payment":
        if (session.deliveryType === "pickup") {
          return { messages: [`Tudo bem! Como prefere receber? 😊\n\n  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`], session: resetaTentativas({ ...session, step: "delivery_type" }) };
        }
        return { messages: [`Tudo bem! Me passa o endereço completo:\n_(Rua, número e complemento)_\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "address" }) };
      case "troco": {
        const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
        return { messages: [`Tudo bem! Como vai pagar? 💸\n\n${payList}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "payment", paymentMethod: undefined, troco: undefined }) };
      }
      case "confirm": {
        const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
        return { messages: [`Tudo bem! Como vai pagar? 💸\n\n${payList}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "payment", paymentMethod: undefined }) };
      }
      case "lanche_escolha":
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", currentCategory: undefined }) };
      case "bebida_escolha":
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", currentCategory: undefined }) };
      case "suco_escolha":
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", currentCategory: undefined }) };
      case "lanche_flavor":
        return { messages: [`Tudo bem! Nossos lanches 😋\n\n${listaLanches()}\n\nDigite o número ou o nome:`], session: resetaTentativas({ ...session, step: "lanche_escolha", currentLanche: undefined }) };
      case "lanche_macarronada_size":
        return { messages: [`Tudo bem! Nossos lanches 😋\n\n${listaLanches()}\n\nDigite o número ou o nome:`], session: resetaTentativas({ ...session, step: "lanche_escolha", currentLanche: undefined }) };
      default:
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category" }) };
    }
  }

  switch (session.step) {
    case "escalado": {
      return { messages: [`Já avisamos e vêm aí em breve! Só aguarda. 😊`], session };
    }
    case "welcome": {
      return {
        messages: [`Olá! Seja bem-vindo à *Chefe da Pizza*! 🍕\n\nPra começar, me fala seu nome?`],
        session: { ...session, step: "name" },
      };
    }
    case "returning": {
      const historico = session.historico!;
      const firstName = historico.nome.split(" ")[0];
      const ultimoPedido = historico.ultimoPedido.join(", ");
      if (ePositiva(n) || n === "1") {
        if (historico.ultimoCart && historico.ultimoCart.length > 0) {
          const cart = historico.ultimoCart.map(item => {
            if (item.category === "pizza" && item.size) {
              const basePrice = getSizePrice(item.size);
              const borderPrice = item.border && item.border !== "Sem borda" ? getBorderPrice(item.size) : 0;
              return { ...item, price: basePrice + borderPrice };
            }
            return item;
          });
          const deliveryFee = historico.ultimoDeliveryFee || 0;
          const updatedSession: BotSession = {
            ...session,
            step: "payment",
            cart,
            customerName: historico.nome,
            deliveryFee,
            deliveryType: historico.ultimoDeliveryType as any || "delivery",
            address: historico.ultimoEndereco,
            neighborhood: historico.ultimoNeighborhood,
          };
          const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
          return {
            messages: [
              `Ótimo, *${firstName}*! 😊 Mesmo pedido de antes:`,
              `🛒 *Itens:*\n${cart.map(item => `• ${item.name}`).join("\n")}\n\nEntrega: ${historico.ultimoEndereco ? `${historico.ultimoEndereco} - ${historico.ultimoNeighborhood}` : "Retirada na loja"}\n\nComo vai pagar?\n\n${payList}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
            ],
            session: resetaTentativas(updatedSession),
          };

        }
        return {
          messages: [`Que bom te ver de novo, *${firstName}*! 😊\n\n${mensagemCategorias()}`],
          session: resetaTentativas({ ...session, step: "category", customerName: historico.nome }),
        };
      }
      if (eNegativa(n) || n === "2") {
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", customerName: historico.nome }) };
      }
      return {
        messages: [`Ei *${firstName}*! 😊 Da última vez você pediu *${ultimoPedido}* — vai querer repetir ou montar um novo?\n\n  1. Repetir o mesmo\n  2. Quero outra coisa`],
        session,
      };
    }
    case "name": {
      if (!text || text.length < 2) return respostaInvalida("Me fala seu nome pra eu te atender melhor!", session);
      const firstName = text.split(" ")[0];
      const pedidoCompleto = detectaPedidoCompleto(text);
      if (pedidoCompleto) {
        const { size, flavor, border } = pedidoCompleto;
        const basePrice = getSizePrice(size);
        const borderPrice = border !== "Sem borda" ? getBorderPrice(size) : 0;
        const itemPrice = basePrice + borderPrice;
        const newItem: CartItem = { category: "pizza", name: "Pizza", size, flavor, border, price: itemPrice };
        const newCart = [newItem];
        return {
          messages: [
            `Prazer, *${firstName}*! 😊`,
            `Pizza *${size}* de *${flavor}* com borda de *${border}* anotada! 🤤`,
            mensagemAddMore(newCart),
          ],
          session: resetaTentativas({ ...session, step: "add_more", cart: newCart, customerName: text, currentCategory: "pizza" }),
        };
      }
      const intencao = detectaIntencaoDireta(text);
      if (intencao) {
        const response = handleCategory(intencao.category, { ...session, step: "category", customerName: text });
        return { ...response, messages: [`Perfeito, *${firstName}*! 😄\n\n${response.messages[0]}`], session: resetaTentativas(response.session) };
      }
      return {
        messages: [`Prazer, *${firstName}*! 😊 ${mensagemCategorias()}`],
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
      if (category === "pizza") {
        const pedidoCompleto = detectaPedidoCompleto(text);
        if (pedidoCompleto) {
          const { size, flavor, border } = pedidoCompleto;
          const basePrice = getSizePrice(size);
          const borderPrice = border !== "Sem borda" ? getBorderPrice(size) : 0;
          const itemPrice = basePrice + borderPrice;
          const newItem: CartItem = { category: "pizza", name: "Pizza", size, flavor, border, price: itemPrice };
          const newCart = [...session.cart, newItem];
          return {
            messages: [
              `Pizza *${size}* de *${flavor}* com borda de *${border}* anotada! 🤤`,
              mensagemAddMore(newCart),
            ],
            session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentCategory: "pizza", currentSize: undefined, currentFlavor: undefined }),
          };
        }
        const pedidoParcial = detectaPedidoParcial(text);
        if (pedidoParcial?.size && pedidoParcial?.flavor) {
          const { size, flavor } = pedidoParcial;
          return {
            messages: [
              `Pizza *${size}* de *${flavor}*! 😋`,
              `Vai querer borda recheada? Olha as opções 👇\n\n${listaBordas(size)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
            ],
            session: resetaTentativas({ ...session, step: "border_escolha", currentCategory: "pizza", currentSize: size, currentFlavor: flavor }),
          };
        }
        if (pedidoParcial?.size) {
          const { size } = pedidoParcial;
          return {
            messages: [
              `Pizza *${size}* anotada! 👌`,
              `Agora me conta — qual o sabor? 😋\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
            ],
            session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: size }),
          };
        }
      }
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
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      if (size) {
        const saborJunto = detectaSaborDaMensagem(n);
        if (saborJunto) {
          const bordaJunta = detectaBordaDaMensagem(n);
          if (bordaJunta) {
            const basePrice = getSizePrice(size);
            const borderPrice = bordaJunta !== "Sem borda" ? getBorderPrice(size) : 0;
            const itemPrice = basePrice + borderPrice;
            const newItem: CartItem = { category: "pizza", name: "Pizza", size, flavor: saborJunto, border: bordaJunta, price: itemPrice };
            const newCart = [...session.cart, newItem];
            return {
              messages: [
                `Pizza *${size}* de *${saborJunto}* com borda de *${bordaJunta}*! 🤤`,
                mensagemAddMore(newCart),
              ],
              session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined }),
            };
          }
          return {
            messages: [
              `Pizza *${size}* de *${saborJunto}*! 😋`,
              `Vai querer borda recheada? Olha as opções 👇\n\n${listaBordas(size)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
            ],
            session: resetaTentativas({ ...session, step: "border_escolha", currentSize: size, currentFlavor: saborJunto }),
          };
        }
        if (permiteMeioAMeio(size)) {
          const dois = detectaDoisSabores(n, allFlavors);
          if (dois) {
            const flavorFinal = `${dois[0]}/${dois[1]}`;
            return {
              messages: [
                `Pizza *${size}* meio a meio *${dois[0]}* e *${dois[1]}*! Ótima pedida! 😋`,
                `Vai querer borda recheada? Olha as opções 👇\n\n${listaBordas(size)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
              ],
              session: resetaTentativas({ ...session, step: "border_escolha", currentSize: size, currentFlavor: flavorFinal }),
            };
          }
        }
        return {
          messages: [
            `Pizza *${size}* anotada! 👌`,
            `Agora me conta — qual o sabor? 😋\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
          ],
          session: resetaTentativas({ ...session, step: "flavor", currentSize: size }),
        };
      }
      const saborSemTamanho = detectaSaborDaMensagem(n);
      if (saborSemTamanho) {
        return {
          messages: [
            `*${saborSemTamanho}*, ótima escolha! 😋`,
            `Qual o tamanho da pizza?\n\n${sizeList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
          ],
          session: resetaTentativas({ ...session, step: "size", currentFlavor: saborSemTamanho }),
        };
      }
      return respostaInvalida(`${sizeList()}`, session);
    }
    case "flavor": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      if (permiteMeioAMeio(session.currentSize)) {
        const dois = detectaDoisSabores(n, allFlavors);
        if (dois) {
          const flavorFinal = `${dois[0]}/${dois[1]}`;
          return {
            messages: [
              `Meio a meio *${dois[0]}* e *${dois[1]}*! Que combinação! 😋`,
              `Vai querer borda recheada? Olha as opções 👇\n\n${listaBordas(session.currentSize!)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
            ],
            session: resetaTentativas({ ...session, step: "border_escolha", currentFlavor: flavorFinal }),
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
        return respostaInvalida(listaFlavors(), session);
      }
      if (session.currentFlavor && !flavor) {
        flavor = session.currentFlavor;
      }
      return {
        messages: [
          `*${flavor}*! Excelente escolha! 🤤`,
          `Vai querer borda recheada? Olha as opções 👇\n\n${listaBordas(session.currentSize!)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
        ],
        session: resetaTentativas({ ...session, step: "border_escolha", currentFlavor: flavor }),
      };
    }
    case "segundo_sabor": {
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      const naoQuerSegundo = n === "2" || eNegativa(n) || n.includes("so esse") || n.includes("apenas esse") || n.includes("so um");
      if (naoQuerSegundo) {
        return {
          messages: [`Combinado! Vai querer borda recheada? 😋\n\n${listaBordas(session.currentSize!)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
          session: resetaTentativas({ ...session, step: "border_escolha" }),
        };
      }
      if (n === "1" || n.includes("sim") || n.includes("quero") || n.includes("dois") || n.includes("meio")) {
        return {
          messages: [`Qual o segundo sabor?\n\n${listaFlavors()}`],
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
        return respostaInvalida(listaFlavors(), session);
      }
      if (flavor2 === session.currentFlavor) {
        return {
          messages: [`Esse é o mesmo sabor! Vou considerar só *${flavor2}* então 😄\n\nVai querer borda recheada?\n\n${listaBordas(session.currentSize!)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
          session: resetaTentativas({ ...session, step: "border_escolha" }),
        };
      }
      const flavorFinal = `${session.currentFlavor}/${flavor2}`;
      return {
        messages: [
          `Meio a meio *${session.currentFlavor}* e *${flavor2}*! Que combinação! 😋`,
          `Vai querer borda recheada?\n\n${listaBordas(session.currentSize!)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
        ],
        session: resetaTentativas({ ...session, step: "border_escolha", currentFlavor: flavorFinal }),
      };
    }
    case "border_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const totalOpcoes = MENU.borders.length + 1;
      const semBorda = n.includes("sem borda") || eNegativa(n) || n === String(totalOpcoes);
      if (semBorda) {
        const basePrice = getSizePrice(session.currentSize!);
        const newItem: CartItem = { category: "pizza", name: "Pizza", size: session.currentSize!, flavor: session.currentFlavor!, border: "Sem borda", price: basePrice };
        const newCart = [...session.cart, newItem];
        const subtotal = cartSubtotal(newCart);
        if (session.pendingPizzas && session.pizzaAtualIndex && session.pizzaAtualIndex < session.pendingPizzas) {
          const proximo = session.pizzaAtualIndex + 1;
          return {
            messages: [
              `Pizza ${session.pizzaAtualIndex} anotada! 🍕\n\n🛒 *Pedido até agora:*\n${resumoCarrinho(newCart)}\n  Subtotal: *${formatCurrency(subtotal)}*`,
              `Agora o sabor da *pizza ${proximo}*? 😋\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
            ],
            session: resetaTentativas({ ...session, step: "flavor", cart: newCart, currentSize: session.currentSize, currentFlavor: undefined, pizzaAtualIndex: proximo }),
          };
        }
        return {
          messages: [
            `Combinado, sem borda! 😄`,
            mensagemAddMore(newCart),
          ],
          session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined, pendingPizzas: undefined, pizzaAtualIndex: undefined }),
        };
      }
      const num = parseInt(text);
      let borderLabel: string | undefined;
      let borderPrice = 0;
      if (!isNaN(num) && num >= 1 && num <= MENU.borders.length) {
        const b = getBorderByIndex(num - 1, session.currentSize!);
        if (b) { borderLabel = b.label; borderPrice = b.price; }
      } else {
        const found = MENU.borders.find(b => n.includes(normalizar(b.label)));
        if (found) {
          borderLabel = found.label;
          borderPrice = getBorderPrice(session.currentSize!);
        }
      }
      if (!borderLabel) {
        return respostaInvalida(listaBordas(session.currentSize!), session);
      }
      const basePrice = getSizePrice(session.currentSize!);
      const itemPrice = basePrice + borderPrice;
      const newItem: CartItem = { category: "pizza", name: "Pizza", size: session.currentSize!, flavor: session.currentFlavor!, border: borderLabel, price: itemPrice };
      const newCart = [...session.cart, newItem];
      const subtotal = cartSubtotal(newCart);
      if (session.pendingPizzas && session.pizzaAtualIndex && session.pizzaAtualIndex < session.pendingPizzas) {
        const proximo = session.pizzaAtualIndex + 1;
        return {
          messages: [
            `Pizza ${session.pizzaAtualIndex} anotada! 🍕\n\n🛒 *Pedido até agora:*\n${resumoCarrinho(newCart)}\n  Subtotal: *${formatCurrency(subtotal)}*`,
            `*Pizza ${proximo} de ${session.pendingPizzas}* — Qual o sabor? 😋\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
          ],
          session: resetaTentativas({ ...session, step: "flavor", cart: newCart, currentSize: session.currentSize, currentFlavor: undefined, pizzaAtualIndex: proximo }),
        };
      }
      return {
        messages: [
          `Borda de *${borderLabel}* anotada! 🤤`,
          mensagemAddMore(newCart),
        ],
        session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined, pendingPizzas: undefined, pizzaAtualIndex: undefined }),
      };
    }
    case "border": {
      return { messages: [`Qual borda você prefere? 😋\n\n${listaBordas(session.currentSize!)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: { ...session, step: "border_escolha" } };
    }
    case "add_more": {
      if (n === "1" || n.includes("mais pizza") || n.includes("outra pizza") || n.includes("mais uma")) {
        return { messages: [`Qual o tamanho da próxima pizza? 🍕\n\n${sizeList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza" }) };
      }
      if (n === "2" || n.includes("outro") || n.includes("mais alguma") || n.includes("adicionar")) {
        return { messages: [`Claro! 😊 ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category" }) };
      }
      if (eNegativa(n) || n === "3") {
        const subtotalAtual = cartSubtotal(session.cart);
        const resumo = session.cart.length > 0 ? `\n\n🛒 *Seu pedido:*\n${resumoCarrinho(session.cart)}\n  Subtotal: *${formatCurrency(subtotalAtual)}*` : "";
        return {
          messages: [`Tem algum detalhe especial pro seu pedido? ✏️\n\nEx: _sem cebola, bem passado, capricha no recheio..._\n\nSe não tiver é só digitar *0*${resumo}`],
          session: resetaTentativas({ ...session, step: "observacao" }),
        };
      }
      const intencaoDireta = detectaIntencaoDireta(text);
      if (intencaoDireta) {
        return { messages: [`Claro! 😊 ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category" }) };
      }
      return respostaInvalida(`  1️⃣ Mais uma pizza\n  2️⃣ Quero mais alguma coisa\n  3️⃣ Não, pode fechar`, session);
    }
    case "observacao": {
      const semObservacao = n === "0" || n === "nao" || n === "n" || n === "nenhuma" ||
        n === "nao tenho" || n === "sem observacao" || n === "nada" || n === "nenhum" ||
        n === "nao preciso" || n === "nao ha" || n.includes("sem obs") || n.includes("ta bom assim") ||
        n.includes("nao tem") || n.includes("pode seguir") || n.includes("pode continuar");
      if (semObservacao) {
        return {
          messages: [`Combinado! Como prefere receber? 😊\n\n  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`],
          session: resetaTentativas({ ...session, step: "delivery_type", observacao: undefined }),
        };
      }
      return {
        messages: [`Anotei: _"${text}"_ ✏️\n\nComo prefere receber? 😊\n\n  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`],
        session: resetaTentativas({ ...session, step: "delivery_type", observacao: text }),
      };
    }
    case "delivery_type": {
      if (n === "1" || n.includes("entrega") || n.includes("delivery") || n.includes("entregar") || n.includes("minha casa")) {
        const hist = session.historico;
        if (hist?.ultimoEndereco && hist?.ultimoNeighborhood) {
          const nbFound = MENU.neighborhoods.find(nb => nb.name === hist.ultimoNeighborhood);
          const fee = nbFound?.fee || hist.ultimoDeliveryFee || 0;
          return {
            messages: [`Entregar no mesmo endereço de antes? 📍\n\n*${hist.ultimoEndereco} - ${hist.ultimoNeighborhood}*\n\n  1. Sim, mesmo endereço\n  2. Não, quero outro endereço`],
            session: resetaTentativas({ ...session, step: "confirm_address", deliveryType: "delivery", neighborhood: hist.ultimoNeighborhood, deliveryFee: fee, address: hist.ultimoEndereco }),
          };
        }
        return { messages: [`Ótimo! Qual seu bairro? 🛵\n\n${neighborhoodList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "neighborhood", deliveryType: "delivery" }) };
      }
      if (n === "2" || n.includes("retirar") || n.includes("loja") || n.includes("buscar") || n.includes("pegar") || n.includes("retiro")) {
        const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
        return { messages: [`Combinado, você retira aqui na loja! 🏪\n\nComo vai pagar?\n\n${payList}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "payment", deliveryType: "pickup", deliveryFee: 0, neighborhood: undefined }) };
      }
      return respostaInvalida(`  1. Entrega (delivery) 🛵\n  2. Buscar na loja 🏪`, session);
    }
    case "neighborhood": {
      const num = parseInt(text);
      let found: { name: string; fee: number } | undefined;
      if (!isNaN(num) && num >= 1 && num <= MENU.neighborhoods.length) found = MENU.neighborhoods[num - 1];
      else found = MENU.neighborhoods.find((nb) => normalizar(nb.name).includes(n));
      if (!found) return respostaInvalida(neighborhoodList(), session);
      return { messages: [`*${found.name}*, taxa de entrega: *${formatCurrency(found.fee)}* 🛵\n\nMe passa o endereço completo:\n_(Rua, número e complemento)_\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "address", neighborhood: found.name, deliveryFee: found.fee }) };
    }
    case "confirm_address": {
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      if (ePositiva(n) || n === "1") {
        return { messages: [`Ótimo! 📍 *${session.address} - ${session.neighborhood}*\n\nComo vai pagar?\n\n${payList}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "payment" }) };
      }
      if (eNegativa(n) || n === "2") {
        return { messages: [`Tudo bem! Qual seu bairro? 🛵\n\n${neighborhoodList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "neighborhood", address: undefined }) };
      }
      return respostaInvalida(`  1. Sim, mesmo endereço\n  2. Não, quero outro endereço`, session);
    }
    case "address": {
      if (!text || text.length < 5) return respostaInvalida("Me passa o endereço completo.\nExemplo: *Rua das Flores, 123, Apto 2*", session);
      const payList = MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
      return { messages: [`Endereço anotado! 📍 Como vai pagar?\n\n${payList}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "payment", address: text }) };
    }
    case "payment": {
      let payment = "";
      if (n === "1" || n.includes("pix") || n.includes("transfer")) payment = "Pix";
      else if (n === "2" || n.includes("dinheiro") || n.includes("especie") || n.includes("cash")) payment = "Dinheiro";
      else if (n === "3" || n.includes("cartao") || n.includes("credito") || n.includes("debito")) payment = "Cartão";
      if (!payment) return respostaInvalida(MENU.payments.map((p, i) => `  ${i + 1}. ${p}`).join("\n"), session);
      const updatedSession = { ...session, paymentMethod: payment };
      if (payment === "Dinheiro") {
        return { messages: [`Combinado! 💵 Vai precisar de troco?\n\nSe sim, me diz o valor que vai pagar. Ex: *100*\nSe não, é só digitar *não*`], session: resetaTentativas({ ...updatedSession, step: "troco", paymentMethod: "Dinheiro" }) };
      }
      const receipt = buildReceipt(updatedSession);
      return { messages: [`Confere seu pedido 👇\n\n${receipt}\n\nTá certinho?\n  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`], session: resetaTentativas({ ...updatedSession, step: "confirm" }) };
    }
    case "troco": {
      const total = cartSubtotal(session.cart) + session.deliveryFee;
      let troco = "";
      const naoQuerTroco = n.includes("nao") || n.includes("sem troco") || n === "0" || n.includes("exato") || n.includes("nao precisa");
      if (naoQuerTroco) {
        troco = "Sem troco";
      } else {
        const valor = parseFloat(n.replace(",", ".").replace(/[^0-9.]/g, ""));
        if (isNaN(valor) || valor < total) {
          return respostaInvalida(`O total é *${formatCurrency(total)}*. Me diz um valor maior ou igual ao total, ou digita *não* se não precisar de troco.`, session);
        }
        const valorTroco = valor - total;
        troco = `Troco de ${formatCurrency(valorTroco)} para ${formatCurrency(valor)}`;
      }
      const updatedSession = { ...session, troco };
      const receipt = buildReceipt(updatedSession);
      return { messages: [`Anotado! 💵 ${troco === "Sem troco" ? "_Sem troco então!_" : `_${troco}_ ✅`}\n\nConfere seu pedido 👇\n\n${receipt}\n\nTá certinho?\n  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`], session: resetaTentativas({ ...updatedSession, step: "confirm" }) };
    }
    case "confirm": {
      const confirma = ePositiva(n) || n.includes("confirmar") || n.includes("correto") ||
        n.includes("ta bom") || n.includes("fechou") || n.includes("pode");
      const retira = n === "2" || n.includes("retirar") || n.includes("cancela") || n.includes("errado") ||
        (eNegativa(n) && !n.includes("nao obrigado"));
      if (confirma) {
        if (session.paymentMethod === "Pix") {
          return { messages: [`Ótimo! 😊 Para finalizar, envie o comprovante do Pix.\n\nChave Pix: (configurada pelo admin) 💸\n\nAssim que confirmarmos o pagamento, seu pedido vai direto pra cozinha! 🍕`], session: { ...session, step: "aguardando_pix" } };
        }
        const timeMsg = session.deliveryType === "delivery" ? CONFIG_BOT.tempoEntregaDelivery : CONFIG_BOT.tempoEntregaRetirada;
        return { messages: [`Pedido confirmado! 🎉 Já foi pra cozinha!\n\nObrigado, *${session.customerName?.split(" ")[0]}*! Sua pizza chega em *${timeMsg}* 🛵\n\nQualquer dúvida é só chamar. Bom apetite! 🍕`], session: { ...session, step: "done" } };
      }
      if (retira) {
        return { messages: [`Tudo bem, pedido cancelado! Se mudar de ideia é só chamar. 😊`], session: { ...session, step: "done" } };
      }
      return respostaInvalida(`  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`, session);
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
        return { messages: [`Ótima escolha! 😋 Qual tamanho da *Macarronada de Carne*?\n\n  1. Pequena (P) · *R$ 28,00*\n  2. Média (M) · *R$ 40,00*\n  3. Grande (G) · *R$ 50,00*\n\n_(Bacon ou ovos: acréscimo de R$ 10,00)_`], session: resetaTentativas({ ...session, step: "lanche_macarronada_size", currentLanche: lanche.name }) };
      }
      if (lanche.hasFlavors) {
        const flavors = MENU[lanche.flavorsKey as keyof typeof MENU] as string[];
        const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return { messages: [`*${lanche.name}* selecionado! 😋 Qual sabor?\n\n${lista}`], session: resetaTentativas({ ...session, step: "lanche_flavor", currentLanche: lanche.name }) };
      }
      const newItem: CartItem = { category: "lanche", name: lanche.name, price: lanche.price };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
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
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "lanche_macarronada_size": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const size = detectaTamanho(n);
      if (!size || size === "F") return respostaInvalida(`  1. Pequena (P) · *R$ 28,00*\n  2. Média (M) · *R$ 40,00*\n  3. Grande (G) · *R$ 50,00*`, session);
      const price = getMacarronadaPrice(size);
      const newItem: CartItem = { category: "lanche", name: "Macarronada de Carne", size, price };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "bebida_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const nums = n.match(/\d+/g);
      if (nums && nums.length >= 2) {
        const i1 = parseInt(nums[0]) - 1;
        const i2 = parseInt(nums[1]) - 1;
        if (i1 >= 0 && i1 < MENU.bebidas.length && i2 >= 0 && i2 < MENU.bebidas.length) {
          const b1 = MENU.bebidas[i1];
          const b2 = MENU.bebidas[i2];
          const novosItens: CartItem[] = [
            { category: "bebida", name: b1.name, price: b1.price },
            { category: "bebida", name: b2.name, price: b2.price },
          ];
          const newCart = [...session.cart, ...novosItens];
          return { messages: [`*${b1.name}* e *${b2.name}* anotadas! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
        }
      }
      const num = parseInt(text);
      let bebida = MENU.bebidas.find(b => normalizar(b.name).includes(n));
      if (!bebida && !isNaN(num) && num >= 1 && num <= MENU.bebidas.length) bebida = MENU.bebidas[num - 1];
      if (!bebida) return respostaInvalida(listaBebidas(), session);
      const newItem: CartItem = { category: "bebida", name: bebida.name, price: bebida.price };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
    }
    case "suco_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const nums = n.match(/\d+/g);
      if (nums && nums.length >= 2) {
        const i1 = parseInt(nums[0]) - 1;
        const i2 = parseInt(nums[1]) - 1;
        if (i1 >= 0 && i1 < MENU.sucos.length && i2 >= 0 && i2 < MENU.sucos.length) {
          const s1 = MENU.sucos[i1];
          const s2 = MENU.sucos[i2];
          const novosItens: CartItem[] = [
            { category: "suco", name: s1.name, price: s1.price },
            { category: "suco", name: s2.name, price: s2.price },
          ];
          const newCart = [...session.cart, ...novosItens];
          return { messages: [`*${s1.name}* e *${s2.name}* anotados! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
        }
      }
      const num = parseInt(text);
      let suco = MENU.sucos.find(s => normalizar(s.name).includes(n));
      if (!suco && !isNaN(num) && num >= 1 && num <= MENU.sucos.length) suco = MENU.sucos[num - 1];
      if (!suco) return respostaInvalida(`${listaSucos()}\n\n_(Com leite: acréscimo de R$ 1,00)_`, session);
      const newItem: CartItem = { category: "suco", name: suco.name, price: suco.price };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
    }
    case "done": {
      return { messages: [`_Oi! Sua sessão expirou por inatividade. Vamos começar de novo? 😊_\n\n${mensagemCategorias()}`], session: resetaTentativas({ step: "category", cart: [], deliveryFee: 0, customerName: session.customerName }) };
    }
    default:
      return { messages: ["Eita, me perdi aqui! Vamos começar de novo?"], session: { step: "welcome", cart: [], deliveryFee: 0 } };
  }
}
export function createInitialSession(): BotSession {
  return { step: "name", cart: [], deliveryFee: 0, tentativasInvalidas: 0 };
}
export function createReturningSession(historico: ClienteHistorico): BotSession {
  return { step: "returning", cart: [], deliveryFee: 0, historico, tentativasInvalidas: 0 };
}
export function getWelcomeMessages(): string[] {
  return [`Olá! Seja bem-vindo à *Chefe da Pizza*! 🍕\n\nPra começar, me fala seu nome?`];
}
