import { MENU as MENU_PADRAO } from "./menu";
import { detectarContextoHumano } from "./contextoHumanoSkill";
import { norm } from "./pedidoAppItens";
import { PIZZA_FLAVORS } from "./catalog/officialMenu2026";
import { buildBotMenu2026, type BotMenu, type BotMenuItem } from "./catalog/botMenu2026";

let MENU: BotMenu = buildBotMenu2026(MENU_PADRAO);

export function setMenuDinamico(menu: typeof MENU_PADRAO) {
  MENU = buildBotMenu2026(menu);
}

let ESGOTADOS: string[] = [];

export function setEsgotados(lista: string[]) {
  ESGOTADOS = lista;
}

// norm() (mesma normalização usada pelo catálogo oficial — @/lib/catalog/pizzas,
// @/lib/catalog/simpleProducts, montagemManual, comandas) tira acento além de
// caixa. Antes esta função só fazia toLowerCase(): "Açaí" esgotado não batia
// com "Acai" digitado/gerado sem acento em outro lugar do fluxo, deixando um
// item esgotado passar como disponível.
function isEsgotado(nome: string): boolean {
  const alvo = norm(nome);
  return ESGOTADOS.some(e => norm(e) === alvo);
}

// Identifica o nome que deve ser checado contra ESGOTADOS para um item do
// carrinho: sabor da pizza (a categoria "pizza" sempre grava name="Pizza"
// fixo — quem varia é o sabor), senão o nome do próprio item (lanche/bebida/
// suco). Borda entra como uma checagem adicional independente.
function nomesParaChecarEsgotado(item: CartItem): string[] {
  const nomes = item.flavor ? [item.flavor] : [item.name];
  if (item.border && item.border !== "Sem borda") nomes.push(item.border);
  return nomes;
}

// Revalidação de disponibilidade no momento da confirmação final (fail-closed):
// ESGOTADOS já é recarregado do Redis a cada mensagem recebida (ver
// setEsgotados em src/app/api/whatsapp/route.ts), mas antes desta checagem só
// era consultado no momento em que cada item era ADICIONADO ao carrinho — um
// item que esgota nos minutos entre a montagem do pedido e o toque em
// "Confirmar" seguia para a cozinha do mesmo jeito. Remove do carrinho
// qualquer item que esgotou nesse meio-tempo, nunca o contrário.
function separarItensEsgotados(cart: CartItem[]): { disponiveis: CartItem[]; removidos: CartItem[] } {
  const disponiveis: CartItem[] = [];
  const removidos: CartItem[] = [];
  for (const item of cart) {
    const esgotou = nomesParaChecarEsgotado(item).some((nome) => isEsgotado(nome));
    (esgotou ? removidos : disponiveis).push(item);
  }
  return { disponiveis, removidos };
}

function respostaEsgotado(nome: string, alternativas: string[], session: BotSession): BotResponse {
  const disponiveis = alternativas.filter(a => !isEsgotado(a));
  const sugestao = disponiveis.length > 0
    ? `\n\nQue tal *${disponiveis[Math.floor(Math.random() * Math.min(3, disponiveis.length))]}*? 😋`
    : "";
  return {
    messages: [`Esse item acabou no momento 😅\nPosso te sugerir outra opção disponível?${sugestao}`],
    session: resetaTentativas(session),
  };
}

const CONFIG_BOT = {
  tempoEntregaDelivery: "40-60 minutos",
  tempoEntregaRetirada: "20-30 minutos",
};

export function setConfigDinamica(cfg: { tempoEntregaDelivery?: string; tempoEntregaRetirada?: string }) {
  if (cfg.tempoEntregaDelivery) CONFIG_BOT.tempoEntregaDelivery = cfg.tempoEntregaDelivery;
  if (cfg.tempoEntregaRetirada) CONFIG_BOT.tempoEntregaRetirada = cfg.tempoEntregaRetirada;
}

let HORARIO_FUNCIONAMENTO = "22h";

export function setHorarioFuncionamento(horario: string) {
  HORARIO_FUNCIONAMENTO = horario;
}

function getPizzaBasePrice(size: string, flavorText: string): number | null {
  const nomes = flavorText.split("/").map((nome) => nome.trim()).filter(Boolean);
  if (nomes.length === 0) return null;
  const precos: number[] = [];
  for (const nome of nomes) {
    const flavor = PIZZA_FLAVORS.find((entry) => entry.name === nome);
    const cents = flavor?.pricesBySizeCode[size as keyof typeof flavor.pricesBySizeCode];
    if (cents === undefined) return null;
    precos.push(cents / 100);
  }
  return Math.max(...precos);
}

function getBorderPriceFor(size: string, label: string): number {
  if (label === "Sem borda") return 0;
  if (size === "MINI") return 0;
  const border = MENU.borders.find((entry) => entry.label === label);
  return border?.pricesBySizeCode[size as "P" | "M" | "G" | "F"] ?? 0;
}

function criarItemPizza(size: string, flavor: string, border = "Sem borda"): CartItem | null {
  const basePrice = getPizzaBasePrice(size, flavor);
  if (basePrice === null) return null;
  if (size === "MINI" && border !== "Sem borda") return null;
  return {
    category: "pizza",
    name: "Pizza",
    size,
    flavor,
    border,
    price: basePrice + getBorderPriceFor(size, border),
  };
}

function respostaCombinacaoPizzaIndisponivel(size: string, session: BotSession): BotResponse {
  return {
    messages: [`Esse sabor não está disponível no tamanho *${size}* 😅\n\nEscolha outro sabor:\n\n${listaFlavors()}`],
    session: resetaTentativas({ ...session, step: "flavor", currentSize: size, currentFlavor: undefined }),
  };
}

function getBorderByIndex(index: number, size: string): { label: string; price: number } | null {
  const border = MENU.borders[index];
  if (!border) return null;
  return { label: border.label, price: getBorderPriceFor(size, border.label) };
}

function saboresLanche(item: BotMenuItem): string[] {
  return item.flavors ?? [];
}

function precoLancheComSabor(item: BotMenuItem, flavor: string): number {
  return item.flavorPrices?.[flavor] ?? item.price;
}

function formatCurrency(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function sizeList(): string {
  return MENU.sizes.map((s, i) => `  ${i + 1}. ${s.label} (${s.code}) · *a partir de ${formatCurrency(s.price)}*`).join("\n");
}
function sizeListComMiniPizza(): string {
  return sizeList();
}

// Fonte única de verdade para a lista numerada de sabores: tanto o texto exibido
// (listaFlavors) quanto a resolução do número digitado (case "flavor"/"segundo_sabor"/
// detectaDoisSabores) usam esta mesma função — nunca mais podem desalinhar índice.
function flavorsDisponiveis(): string[] {
  return [...MENU.saltyFlavors, ...MENU.sweetFlavors].filter(f => !isEsgotado(f));
}
function listaFlavors(): string {
  const saltyCount = MENU.saltyFlavors.filter(f => !isEsgotado(f)).length;
  const disponiveis = flavorsDisponiveis();
  const salties = disponiveis.slice(0, saltyCount);
  const sweets = disponiveis.slice(saltyCount);
  let num = 1;
  const saltyList = salties.map(f => `  ${num++}. ${f}`).join("\n");
  const sweetList = sweets.map(f => `  ${num++}. ${f}`).join("\n");
  const parts: string[] = [];
  if (saltyList) parts.push(`*SALGADAS*\n${saltyList}`);
  if (sweetList) parts.push(`*DOCES*\n${sweetList}`);
  return parts.join("\n\n───────────\n\n");
}

function mensagemAddMore(cart: CartItem[]): string {
  const subtotal = cartSubtotal(cart);
  const temBebida = cart.some(i => i.category === "bebida" || i.category === "suco");
  if (!temBebida) {
    const destaques = MENU.bebidas.slice(0, 3);
    const lista = destaques.map((b, i) => `  ${i + 1}. ${b.name} — ${formatCurrency(b.price)}`).join("\n");
    return `🛒 *Seu pedido:*\n${resumoCarrinho(cart)}\n  Subtotal: *${formatCurrency(subtotal)}*\n\n🥤 *Quer adicionar uma bebida?*\n${lista}\n  4. Ver mais bebidas\n  5. Fechar pedido\n\nDigite o número da opção 😊`;
  }
  return `Olha como ficou seu pedido até agora:\n\n${resumoCarrinho(cart)}\n\nTotal até aqui: *${formatCurrency(subtotal)}*\n\nQuer colocar mais alguma coisa ou já posso fechar pra você?\n\nPode mandar do seu jeito: mais uma pizza, uma bebida, ver cardápio ou fechar pedido.`;
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
  | "product_family_choice"
  | "bebida_escolha"
  | "suco_escolha"
  | "confirmando_mudanca"
  | "consulta_preco"
  | "consulta_fatias"
  | "observacao"
  | "delivery_type"
  | "neighborhood"
  | "confirma_bairro_fuzzy"
  | "confirma_produto_valor"
  | "confirma_sabor_ambiguo"
  | "confirma_item_ambiguo"
  | "address"
  | "confirm_address"
  | "payment"
  | "payment_hibrido_valor"
  | "payment_hibrido_complemento"
  | "troco"
  | "pedindo_nome"
  | "confirm"
  | "aguardando_pix"
  | "suco_leite"
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
  totalPedidos?: number;
  ultimaVisita?: number;
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
  deliveryType?: "delivery" | "pickup" | "dine_in";
  neighborhood?: string;
  address?: string;
  deliveryFee: number;
  bairroConfirmado?: boolean;
  paymentMethod?: string;
  escalado?: boolean;
  historico?: ClienteHistorico;
  tentativasInvalidas?: number;
  // Confusões consecutivas (fallback seco) — usado para handoff automático ao humano.
  clientePerdidoCount?: number;
  observacao?: string;
  pedidoId?: string;
  troco?: string;
  ritmoRapido?: boolean;
  pagamentoPendente?: string;
  enderecoAConfirmar?: string;
  hibridoMetodos?: string[];
  bairroFuzzyCandidato?: string;
  hibridoValorParcial?: Record<string, number>;
  candidatosValorProduto?: { name: string; price: number; categoria: string }[];
  candidatosFamilia?: { name: string; price: number; hasFlavors: boolean; flavorsKey: string; sizes?: { code: string; price: number }[] }[];
  familiaLabel?: string;
  candidatosSaborAmbiguo?: string[];
  candidatosItemAmbiguo?: string[];
  itemAmbiguoTipo?: "lanche" | "lanche_flavor" | "bebida";
  stepAposSabor?: BotStep;
  retornoRapido?: boolean;
  pendingQtdSuco?: number;
  stepAnteriorEscalado?: BotStep;
  aguardandoRetomada?: boolean;
  pendingConsultaFatias?: { size?: string };
  candidatosBairro?: { name: string; fee: number }[];
  pendingSucosLeite?: CartItem[];
  pendingConsultaPreco?: {
    label: string;
    categoria: "pizza_size" | "pizza_mini" | "pizza_ambiguo" | "lanche" | "bebida" | "suco";
    produto?: string;
    preco?: number;
    size?: string;
    qty?: number;
  };
  // Rascunho de leitura para a atendente (MVP 3). Campo aditivo: NÃO participa do
  // fluxo do bot — só é preenchido por atualizarRascunhoAtendimentoTempoReal.
  rascunhoAtendimento?: import("./rascunhoAtendimentoTempoReal").RascunhoAtendimento;
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
// Detecta perguntas sobre a identidade/natureza do bot ("você é humano?", "você é robô?").
// DIFERENTE de pedido real de atendente ("quero falar com um humano", "me passa para atendente").
// Usado como guard antes de precisaEscalar nos steps seguros para evitar escalonamento indevido.
function ehPerguntaIdentidadeBot(n: string): boolean {
  return (
    /voce e (um )?(humano|robo|bot|ia)\b/.test(n) ||
    /vc e (um )?(humano|robo|bot|ia)\b/.test(n) ||
    /voce e uma (ia|inteligencia)/.test(n) ||
    /\be (um )?(robo|bot|ia)\b/.test(n) ||
    /\be humano\b/.test(n) ||
    /ta(o)? falando com (um )?(robo|bot|ia|humano)\b/.test(n) ||
    /to falando com (um )?(robo|bot|ia|humano)\b/.test(n)
  );
}
const SAUDACOES_SIMPLES = [
  "boa noite", "boa tarde", "bom dia", "oi", "oie", "ola", "opa",
  "eai", "e ai", "hey", "hello", "alo",
];
function ehSaudacaoSimples(n: string): boolean {
  const s = n.replace(/[?!.…]+$/g, "").trim();
  return SAUDACOES_SIMPLES.some(p => s === p || s.startsWith(p + " ") || s.endsWith(" " + p));
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
  return !!size && size !== "MINI";
}
// ===== MOTOR DE RECONHECIMENTO DE SABOR (tolerante a erro humano) =====
// Apelidos: variações que o fuzzy sozinho não pegaria (números por extenso vs dígito,
// abreviações, grafias alternativas e apelidos culturais comuns no WhatsApp).
// Cobre pizza, lanches, bebidas e sucos.
export const APELIDOS_SABOR: Record<string, string[]> = {
  // Pizza — sabores
  "Quatro Queijos": ["4 queijos", "4 queijo", "quatro queijo"],
  "Tres Queijos": ["3 queijos", "3 queijo", "tres queijo"],
  "Frango Catupiry": ["frango", "frango c catupiry", "frango com catupiry", "frango catupiri"],
  "Mussarela": ["mucarela", "muzarela", "muzzarela", "mozarela", "mucarella", "mussarella", "mozzarela"],
  "Romeu e Julieta": ["romeu", "romeu julieta"],
  "Calabresa": ["calabreza", "calabre"],
  "Portuguesa": ["portugesa", "portugues"],
  // Lanches — apelidos culturais e grafias variantes
  "X-Burguer": ["hamburguer", "hamburgues", "hamburguer", "hamburgues", "burguer simples", "x burguer simples"],
  "X-Bacon": ["xbacon", "x bacon", "burguer bacon"],
  "X-Tudo": ["xtudo", "x tudo", "burguer tudo", "burguer completo"],
  "Porcao de Batatas": ["batata frita", "batatas fritas", "porcao batata", "porcao batatas", "batata"],
  "Macarronada de Carne": ["macarronada", "macarrao", "macarrao de carne", "macarrona", "massa"],
  // Bebidas — marca/apelido popular → produto mais comum no cardápio
  "Refrigerante Lata": ["coca", "coca cola", "cocacola", "coca-cola", "pepsi cola", "soda"],
  "Refrigerante 2L": ["refri 2 litros", "refrigerante 2 litros", "coca 2 litros", "coca 2l"],
  "Refrigerante 1,5L": ["refri 1.5", "refri 1,5", "coca 1.5", "coca 1,5", "refrigerante 1.5"],
  "Refrigerante 1L": ["refri 1 litro", "refrigerante 1 litro", "coca 1 litro", "coca 1l"],
  "Pepsi Lata": ["pepsi"],
  "Guarana Lata": ["guarana lata", "guarana latinha"],
  "Guarana 2L": ["guarana 2 litros", "guarana 2l"],
  "Guarana 1L": ["guarana 1 litro", "guarana 1l"],
  "Cerveja Long Neck": ["cerveja", "long neck", "longneck", "birra"],
  "Agua sem Gas": ["agua", "aguinha", "agua mineral"],
  "Agua com Gas": ["agua gasosa", "agua c gas", "agua com gas"],
};
function levenshtein(a: string, b: string): number {
  const m = a.length, len = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(len).fill(0)]);
  for (let j = 0; j <= len; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= len; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][len];
}
function variantesPlural(s: string): string[] {
  return s.endsWith("s") ? [s, s.slice(0, -1)] : [s, s + "s"];
}
// Resolve UM sabor a partir de um trecho de texto (já normalizado ou não).
function resolveUmSabor(termo: string, flavors: string[]): string | null {
  const n = normalizar(termo);
  if (!n) return null;
  // Nível 1: substring exata normalizada (+ plural opcional)
  const exato = flavors.find((f) => normalizar(f) === n);
  if (exato) return exato;
  // Nomes mais específicos vêm primeiro: "Calabresa Suprema" nunca pode
  // ser reduzida silenciosamente a "Calabresa".
  for (const f of [...flavors].sort((a, b) => normalizar(b).length - normalizar(a).length)) {
    const nf = normalizar(f);
    for (const v of variantesPlural(nf)) {
      if (n.includes(v)) return f;
    }
  }
  // Nível 2: apelidos / grafias alternativas
  for (const f of flavors) {
    for (const ap of (APELIDOS_SABOR[f] || [])) {
      if (n.includes(normalizar(ap))) return f;
    }
  }
  // Nível 3: fuzzy por palavra, só aceita se houver vencedor claro (evita confundir sabores parecidos)
  const palavras = n.split(/\s+/).filter(p => p.length >= 4);
  if (palavras.length === 0) return null;
  let melhor: { f: string; d: number } | null = null;
  let segundo = Infinity;
  for (const f of flavors) {
    const nf = normalizar(f);
    const alvos = [nf, ...nf.split(/\s+/)];
    let melhorLocal = Infinity;
    for (const p of palavras) {
      for (const a of alvos) {
        if (a.length < 4) continue;
        const tol = a.length <= 6 ? 1 : 2;
        const dist = levenshtein(p, a);
        if (dist <= tol && dist < melhorLocal) melhorLocal = dist;
      }
    }
    if (melhorLocal < Infinity) {
      if (melhor === null || melhorLocal < melhor.d) {
        segundo = melhor ? melhor.d : Infinity;
        melhor = { f, d: melhorLocal };
      } else if (melhorLocal < segundo) {
        segundo = melhorLocal;
      }
    }
  }
  if (melhor && (segundo === Infinity || segundo - melhor.d >= 1)) return melhor.f;
  return null;
}

// Busca sabores (ou nomes de produto, é genérico) por PALAVRA-CHAVE, retornando TODOS os candidatos
// cujo nome contém TODAS as palavras-chave que o cliente mencionou — sem decidir por conta própria
// quando há ambiguidade. Ex: "queijo" bate em "Quatro Queijos" E "Tres Queijos" -> retorna os dois.
// "refrigerante lata" exige as duas palavras presentes -> só bate em "Refrigerante Lata".
// Diferente de resolveUmSabor (que escolhe 1 quando há vencedor claro), esta função é a camada
// de segurança: se duas ou mais opções batem igualmente, NUNCA escolhe sozinha.
function buscaPorPalavraChave(termo: string, nomes: string[]): string[] {
  const STOPWORDS = new Set(["quero", "uma", "um", "de", "da", "do", "com", "sem", "vou", "queria", "quer", "por", "favor", "pizza", "lanche", "pode", "ser", "me", "ve", "vê", "tem", "essa", "esse", "aquela", "aquele"]);
  const n = normalizar(termo).replace(/-/g, " "); // trata hífen como separador (ex: "x-burguer" -> "x burguer")
  if (!n) return [];
  const palavrasMsg = n.split(/\s+/).filter(p => p.length >= 3 && !STOPWORDS.has(p));
  if (palavrasMsg.length === 0) return [];

  const candidatos: string[] = [];
  for (const nome of nomes) {
    const palavrasNome = normalizar(nome).replace(/-/g, " ").split(/\s+/).filter(p => p.length >= 2);
    // Exige que TODAS as palavras-chave da mensagem estejam presentes no nome (com plural/singular tolerado)
    const todasBatem = palavrasMsg.every(pm =>
      palavrasNome.some(pn => pn === pm || variantesPlural(pn).includes(pm) || variantesPlural(pm).includes(pn))
    );
    if (todasBatem) candidatos.push(nome);
  }
  return candidatos;
}

// Resolve um sabor (ou nome de item) com a regra de segurança: nunca assume se houver dúvida real.
// 1) Tenta o resolveUmSabor tradicional (substring/apelido/fuzzy com vencedor claro) -> se achar 1, usa.
// 2) Se não achou nada direto, tenta por palavra-chave: 1 candidato -> usa; 2+ candidatos -> retorna
//    a lista para o caller perguntar "qual desses?"; 0 candidatos -> não reconheceu nada.
function resolveSaborComAmbiguidade(termo: string, nomes: string[]): { tipo: "unico"; nome: string } | { tipo: "ambiguo"; opcoes: string[] } | { tipo: "nenhum" } {
  const direto = resolveUmSabor(termo, nomes);
  if (direto) return { tipo: "unico", nome: direto };

  const porPalavra = buscaPorPalavraChave(termo, nomes);
  if (porPalavra.length === 1) return { tipo: "unico", nome: porPalavra[0] };
  if (porPalavra.length > 1) return { tipo: "ambiguo", opcoes: porPalavra };
  return { tipo: "nenhum" };
}
// allFlavors: lista completa, usada para resolução por nome/apelido (esgotados incluídos,
// para que o cliente que digitar o nome de um item esgotado ainda receba o aviso correto).
// flavorsParaNumero: lista filtrada (mesma exibida ao cliente) — usada SÓ para resolver
// escolha por número ("1 e 8"), evitando o desalinhamento de índice quando há esgotados.
function detectaDoisSabores(n: string, allFlavors: string[], flavorsParaNumero: string[] = allFlavors): [string, string] | null {
  // Por número ("1 e 8"), evitando o caso em que o dígito faz parte de um apelido ("3 queijos")
  const nums = n.match(/\d+/g);
  if (nums && nums.length >= 2) {
    const digitoEhApelido = allFlavors.some(f =>
      (APELIDOS_SABOR[f] || []).some(ap => /\d/.test(ap) && n.includes(normalizar(ap)))
    );
    if (!digitoEhApelido) {
      const i1 = parseInt(nums[0]) - 1;
      const i2 = parseInt(nums[1]) - 1;
      if (i1 >= 0 && i1 < flavorsParaNumero.length && i2 >= 0 && i2 < flavorsParaNumero.length && i1 !== i2) {
        return [flavorsParaNumero[i1], flavorsParaNumero[i2]];
      }
    }
  }
  // Quebra a frase nos conectores e resolve cada lado com o motor tolerante
  const partes = n.split(/\s+e\s+|\/|\s+meio\s+|,/).map(s => s.trim()).filter(Boolean);
  const achados: string[] = [];
  for (const parte of partes) {
    const s = resolveUmSabor(parte, allFlavors);
    if (s && !achados.includes(s)) achados.push(s);
    if (achados.length === 2) break;
  }
  if (achados.length === 2) return [achados[0], achados[1]];
  // Fallback: sem separador explícito, tenta splits por palavra
  // Ex: "calabresa peruana" → [Calabresa, Peruana]
  const palavrasN = n.split(/\s+/);
  for (let i = 1; i < palavrasN.length; i++) {
    const p1 = palavrasN.slice(0, i).join(" ");
    const p2 = palavrasN.slice(i).join(" ");
    const s1 = resolveUmSabor(p1, allFlavors);
    const s2 = resolveUmSabor(p2, allFlavors);
    if (s1 && s2 && s1 !== s2) return [s1, s2];
  }
  return null;
}
// Detecta se a mensagem menciona uma categoria de produto + um valor numérico (ex: "hamburguer de 18", "lanche de 20").
// Retorna a categoria normalizada (lanche/bebida/suco/pizza) e o valor, ou null se não houver os dois sinais juntos.
function detectaCategoriaEValor(text: string): { categoria: "lanche" | "bebida" | "suco" | "pizza"; valor: number } | null {
  const n = normalizar(text);
  const valorMatch = n.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!valorMatch) return null;
  const valor = parseFloat(valorMatch[1].replace(",", "."));
  if (isNaN(valor) || valor <= 0 || valor > 200) return null; // fora de faixa plausível, ignora

  let categoria: "lanche" | "bebida" | "suco" | "pizza" | null = null;
  if (n.includes("hamburgue") || n.includes("hamburguer") || n.includes("burguer") || n.includes("lanche") ||
    n.includes("calzone") || n.includes("x-") || n.includes("x ") || n.includes("batata") || n.includes("porcao")) {
    categoria = "lanche";
  } else if (n.includes("bebida") || n.includes("refri") || n.includes("guarana") || n.includes("agua") || n.includes("cerveja")) {
    categoria = "bebida";
  } else if (n.includes("suco") || n.includes("vitamina")) {
    categoria = "suco";
  } else if (n.includes("pizza")) {
    categoria = "pizza";
  }
  if (!categoria) return null;
  return { categoria, valor };
}

// Busca produtos da categoria próximos ao valor informado. Retorna os candidatos ordenados por proximidade.
// Regra de proximidade: se houver um candidato "claramente" mais próximo (distância <= 1 e folga de pelo
// menos 2 reais para o segundo colocado), retorna só ele. Senão, retorna todos dentro da faixa ampla (R$3)
// para o cliente escolher. Não inventa produto, só usa o que existe de fato no cardápio.
function buscaProdutosPorValor(categoria: "lanche" | "bebida" | "suco", valor: number): { name: string; price: number }[] {
  let lista: { name: string; price: number }[] = [];
  if (categoria === "lanche") lista = MENU.lanches.filter(l => !l.sizes).map(l => ({ name: l.name, price: l.price }));
  else if (categoria === "bebida") lista = MENU.bebidas;
  else if (categoria === "suco") lista = MENU.sucos;

  const FAIXA = 3; // até R$3,00 de diferença é considerado "próximo" o suficiente para listar
  const comDistancia = lista
    .map(p => ({ ...p, dist: Math.abs(p.price - valor) }))
    .sort((a, b) => a.dist - b.dist);
  const dentroDaFaixa = comDistancia.filter(p => p.dist <= FAIXA);
  if (dentroDaFaixa.length === 0) return [];

  // Vencedor claro: preço idêntico ao informado (distância 0) -> sugere só ele, mesmo com outros na faixa
  const primeiro = dentroDaFaixa[0];
  const segundo = dentroDaFaixa[1];
  if (primeiro.dist === 0) {
    return [{ name: primeiro.name, price: primeiro.price }];
  }
  // Ou vencedor claro por boa margem sobre o segundo colocado
  if (primeiro.dist <= 1 && (!segundo || segundo.dist - primeiro.dist >= 2)) {
    return [{ name: primeiro.name, price: primeiro.price }];
  }
  return dentroDaFaixa.slice(0, 3).map(p => ({ name: p.name, price: p.price }));
}

// Detecta se o cliente quer ver o cardápio/menu (qualquer etapa)
function detectaIntencaoCardapio(text: string): boolean {
  const n = normalizar(text);
  return n.includes("cardapio") || n.includes("menu") || n.includes("ver sabor") ||
    n.includes("ver opcoes") || n.includes("o que tem") || n.includes("o que voces tem") ||
    (n.includes("ver") && (n.includes("cardapio") || n.includes("opcoes")));
}

export function detectaPerguntaEntregaFuncionamento(text: string): boolean {
  const n = normalizar(text);

  // Padrões explícitos de perguntas sobre entrega/funcionamento
  const padroes = [
    /fazendo entrega/,
    /faz(em)? entrega/,
    /ta(o)? entregando/,
    /estao entregando/,
    /voces entregando/,
    /entregando ainda/,
    /ainda entregando/,
    /fazem delivery/,
    /faz delivery/,
    /tem delivery/,
    /ainda da pra pedir/,
    /da pra pedir/,
    /ainda da tempo/,
    /da tempo de pedir/,
    /ainda estao funcionando/,
    /estao funcionando/,
    /voces funcionando/,
    /ainda aberto/,
    /estao aberto/,
    /ta aberto/,
    /ate que horas/,
    /horario de (entrega|funcionamento|atendimento)/,
    /qual (o )?horario/,
    /que horas (fecha|termina|encerra|entrega)/,
  ];
  const temPadrao = padroes.some(r => r.test(n));

  // Palavras-chave simples como fallback
  const palavrasChave = ["entregando", "delivery", "funcionando", "funcionamento", "horario"];
  const temPalavraChave = palavrasChave.some(p => n.includes(p));

  if (!temPadrao && !temPalavraChave) return false;

  // Se a mensagem carrega pedido completo (produto + pagamento/bairro), prioriza o pedido
  const temProduto = n.includes("pizza") || n.includes("lanche") || n.includes("burguer") ||
    n.includes("bacon") || n.includes("calabresa") || n.includes("frango") ||
    n.includes("bebida") || n.includes("suco") || n.includes("refrigerante") ||
    n.includes("calzone") || /\bx-/.test(n);
  const temPagamentoOuBairro = n.includes("pix") || n.includes("dinheiro") || n.includes("cartao") ||
    n.includes("bairro");
  if (temProduto && temPagamentoOuBairro) return false;

  return true;
}

// Palavras do domínio do negócio: se aparecerem, o texto quase certamente NÃO é um nome próprio sozinho.
const PALAVRAS_DOMINIO = [
  "pizza", "cardapio", "menu", "sabor", "bebida", "lanche", "suco", "borda",
  "calabresa", "frango", "portuguesa", "queijo", "napolitana", "baiana", "peruana",
  "bacon", "mexicana", "mussarela", "chocolate", "cartola", "romeu", "calzone",
  "burguer", "batata", "refrigerante", "guarana", "agua", "cerveja", "coca",
  "entrega", "retirada", "pagamento", "pix", "dinheiro", "cartao", "finalizar",
  "quero", "queria", "gostaria", "manda", "vou", "favor",
];
// Saudações e palavras curtas comuns que tecnicamente "parecem nome" mas nunca são.
const NUNCA_E_NOME = ["oi", "ola", "olá", "eai", "ei", "opa", "bom", "boa", "sim", "nao", "ok", "obrigado", "obrigada", "blz", "alo"];
// Heurística forte: só considera "nome humano" se NÃO houver sinais de pedido/domínio.
// Critérios (todos precisam passar): sem números, sem palavras de domínio, no máximo 3 palavras,
// e cada palavra parece um nome próprio (só letras, começa com maiúscula OU é curta/comum de nome).
function pareceNomeHumano(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2) return false;
  if (/\d/.test(t)) return false; // números não fazem parte de nome
  const n = normalizar(t);
  if (NUNCA_E_NOME.includes(n)) return false;
  if (PALAVRAS_DOMINIO.some(p => n.includes(p))) return false;
  const palavras = t.split(/\s+/).filter(Boolean);
  if (palavras.length > 3) return false; // nome humano raramente tem mais de 3 palavras
  // cada "palavra" deve conter só letras (permite acento e hífen simples, ex: "Ana-Maria")
  if (!palavras.every(p => /^[A-Za-zÀ-ÿ'-]+$/.test(p))) return false;
  return true;
}

type ConsultaPreco = {
  label: string;
  categoria: "pizza_size" | "pizza_mini" | "pizza_ambiguo" | "lanche" | "bebida" | "suco";
  produto?: string;
  preco?: number;
  size?: string;
  qty?: number;
};

function detectaConsultaPreco(text: string): ConsultaPreco | null {
  const n = normalizar(text).replace(/-/g, " ");
  const temConsulta =
    n.includes("quanto") || n.includes("valor") || n.includes("preco") ||
    n.includes("custa") || /\bcaro\b/.test(n) || n.includes("barato");
  if (!temConsulta) return null;

  // Extrai qty se houver ("quanto tá 2 x-burguer")
  const qtyMatch = n.match(/\b(\d{1,2})\s*x?\s+/);
  const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

  // Pizza com tamanho específico
  const sizeMaps: Array<[RegExp, string, string]> = [
    [/\bpizza\s*(pequena|p\b)|\bpizza\s+p\b|\bp\s+pizza\b/, "P", "Pizza Pequena (P)"],
    [/\bpizza\s*(media|m\b)|\bpizza\s+m\b|\bm\s+pizza\b/, "M", "Pizza Média (M)"],
    [/\bpizza\s*(grande|g\b)|\bpizza\s+g\b|\bg\s+pizza\b/, "G", "Pizza Grande (G)"],
    [/\bpizza\s*(familia|f\b)|\bpizza\s+f\b|\bf\s+pizza\b/, "F", "Pizza Família (F)"],
  ];
  for (const [re, size, label] of sizeMaps) {
    if (re.test(n)) {
      const preco = MENU.sizes.find(s => s.code === size)?.price ?? 0;
      return { label, categoria: "pizza_size", size, preco, qty };
    }
  }

  // Mini-pizza
  if (n.includes("mini pizza") || n.includes("mine pizza") || /\bmini\b/.test(n)) {
    return { label: "Mini-Pizza", categoria: "pizza_mini", preco: 17, qty };
  }

  // Pizza genérica (ambíguo)
  if (n.includes("pizza")) {
    return { label: "pizza", categoria: "pizza_ambiguo" };
  }

  // Lanches — resolve por alias
  for (const lanche of MENU.lanches.filter(l => l.name !== "Mini-Pizza")) {
    const nomesParaBusca = [lanche.name, ...(APELIDOS_SABOR[lanche.name] ?? [])];
    for (const alias of nomesParaBusca) {
      if (n.includes(normalizar(alias).replace(/-/g, " "))) {
        return { label: lanche.name, categoria: "lanche", produto: lanche.name, preco: lanche.price, qty };
      }
    }
  }

  // Bebidas — resolve por alias
  for (const bebida of MENU.bebidas) {
    const nomesParaBusca = [bebida.name, ...(APELIDOS_SABOR[bebida.name] ?? [])];
    for (const alias of nomesParaBusca) {
      if (n.includes(normalizar(alias).replace(/-/g, " "))) {
        return { label: bebida.name, categoria: "bebida", produto: bebida.name, preco: bebida.price, qty };
      }
    }
  }

  // Sucos — resolve por nome
  const nomesS = MENU.sucos.map(s => s.name);
  const suco = resolveUmSabor(n, nomesS);
  if (suco) {
    const item = MENU.sucos.find(s => s.name === suco)!;
    return { label: suco, categoria: "suco", produto: suco, preco: item.price, qty };
  }

  return null;
}

function mensagemConsultaPreco(c: ConsultaPreco): string {
  if (c.categoria === "pizza_ambiguo") {
    const lista = [
      `  • Mini-Pizza — *R$ 17,00*`,
      ...MENU.sizes.map(s => `  • ${s.label} (${s.code}) — *${formatCurrency(s.price)}*`),
    ].join("\n");
    return `Temos vários tamanhos de pizza 😊\n\n${lista}\n\nQual você quer que eu anote?`;
  }
  const qtyLabel = c.qty && c.qty > 1 ? `${c.qty}x ` : "";
  const precoTotal = c.preco && c.qty && c.qty > 1 ? c.preco * c.qty : c.preco;
  const precoStr = precoTotal ? ` — *${formatCurrency(precoTotal)}*` : "";
  return `${qtyLabel}${c.label}${precoStr} 🍕\n\nPosso anotar pra você?\n\n  1. Sim, quero pedir\n  2. Ver outro produto`;
}

function verificaConsultaPreco(text: string, session: BotSession): BotResponse | null {
  const c = detectaConsultaPreco(text);
  if (!c) return null;
  return {
    messages: [mensagemConsultaPreco(c)],
    session: resetaTentativas({ ...session, step: "consulta_preco", pendingConsultaPreco: c }),
  };
}

const FATIAS_POR_TAMANHO: Record<string, { label: string; fatias: number }> = {
  P: { label: "Pequena", fatias: 6 },
  M: { label: "Média", fatias: 8 },
  G: { label: "Grande", fatias: 10 },
  F: { label: "Família", fatias: 12 },
};

function verificaConsultaFatias(text: string, session: BotSession): BotResponse | null {
  const n = normalizar(text);
  const temFatia = n.includes("fatia") || n.includes("quantas fatias") || n.includes("vem quantas") || n.includes("serve quantas") || n.includes("quantas porcoes") || n.includes("quantas porcao");
  const temGeral = n.includes("cada tamanho") || n.includes("cada pizza") || n.includes("todos") || n.includes("todos os tamanhos") || (temFatia && !n.includes("pizza p") && !n.includes("pizza m") && !n.includes("pizza g") && !n.includes("pizza f") && !n.includes("pequena") && !n.includes("media") && !n.includes("grande") && !n.includes("famil") && !/\b[pmgf]\b/.test(n));
  if (!temFatia) return null;

  // Tenta detectar tamanho específico
  let size: string | null = null;
  if (n.includes("pequena") || n.includes("pizza p") || /\bp\b/.test(n)) size = "P";
  else if (n.includes("media") || n.includes("pizza m") || /\bm\b/.test(n)) size = "M";
  else if (n.includes("grande") || n.includes("pizza g") || /\bg\b/.test(n)) size = "G";
  else if (n.includes("famil") || n.includes("pizza f") || /\bf\b/.test(n)) size = "F";

  let resposta: string;
  if (size && !temGeral) {
    const { label, fatias } = FATIAS_POR_TAMANHO[size];
    resposta = `Pizza ${label} (${size}) vem com *${fatias} fatias* 🍕\n\nQuer que eu anote uma pra você?`;
  } else {
    const lista = Object.entries(FATIAS_POR_TAMANHO).map(([code, { label, fatias }]) => `  ${code} ${label} — *${fatias} fatias*`).join("\n");
    resposta = `🍕 Nossas pizzas vêm assim:\n\n${lista}\n\nQuer que eu anote uma pra você?`;
  }

  // No step size, reforça que pode escolher tamanho; nos demais, vai para consulta_fatias
  if (session.step === "size") {
    const reforco = `\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`;
    return { messages: [resposta + reforco], session: resetaTentativas(session) };
  }
  return { messages: [resposta], session: resetaTentativas({ ...session, step: "consulta_fatias", pendingConsultaFatias: { size: size ?? undefined } }) };
}

function resolveFatiasFollowUp(text: string, session: BotSession): BotResponse | null {
  const n = normalizar(text).replace(/-/g, " ");
  // Detecta tamanho na mensagem de follow-up (sem precisar de "fatias")
  let size: string | null = null;
  if (n.includes("pequena") || n.includes("pizza p") || /\bp\b/.test(n)) size = "P";
  else if (n.includes("media") || n.includes("pizza m") || /\bm\b/.test(n)) size = "M";
  else if (n.includes("grande") || n.includes("pizza g") || /\bg\b/.test(n)) size = "G";
  else if (n.includes("famil") || n.includes("pizza f") || /\bf\b/.test(n)) size = "F";
  if (!size) return null;
  const { label, fatias } = FATIAS_POR_TAMANHO[size];
  const resposta = `Pizza ${label} (${size}) vem com *${fatias} fatias* 🍕\n\nQuer que eu anote uma pra você?`;
  return { messages: [resposta], session: resetaTentativas({ ...session, step: "consulta_fatias", pendingConsultaFatias: { size } }) };
}

export function detectaIntencaoSuco(text: string): boolean {
  const n = normalizar(text);
  return (
    n.includes("suco") ||
    n.includes("sucos") ||
    n.includes("vitamina") ||
    n.includes("caja") ||
    n.includes("caju") ||
    n.includes("acerola") ||
    n.includes("goiaba") ||
    n.includes("bacuri") ||
    n.includes("cupuacu") ||
    n.includes("maracuja") ||
    (n.includes("laranja") && !n.includes("refri") && !n.includes("guarana"))
  );
}
function detectaIntencaoDireta(text: string): { category: string; label: string } | null {
  const n = normalizar(text);
  const todosSaboresPizza = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
  if (todosSaboresPizza.some(f => n.includes(normalizar(f)))) return { category: "pizza", label: "pizza" };
  if (n.includes("pizza") && !n.includes("mini")) return { category: "pizza", label: "pizza" };
  if (n.includes("calzone")) return { category: "lanche", label: "calzone" };
  if (n.includes("mini-pizza") || n.includes("mini pizza")) return { category: "pizza", label: "mini pizza" };
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
  if (n === "5" || n.includes("mini")) return "MINI";
  if (n === "p") return "P";
  if (n === "m") return "M";
  if (n === "g") return "G";
  if (n === "f") return "F";
  if (n === "mini") return "MINI";
  return null;
}
function detectaTamanhoDaMensagem(n: string): string | null {
  if (n.includes("mini")) return "MINI";
  if (n.includes("pequen")) return "P";
  if (n.includes("medi")) return "M";
  if (n.includes("grand")) return "G";
  if (n.includes("famil")) return "F";
  // Letra isolada do tamanho (P/M/G/F) cercada por não-letras: " f ", "(f)", "f)", "tamanho: f", "f\n", fim de linha
  if (/(^|[^a-z])p([^a-z]|$)/.test(n)) return "P";
  if (/(^|[^a-z])m([^a-z]|$)/.test(n)) return "M";
  if (/(^|[^a-z])g([^a-z]|$)/.test(n)) return "G";
  if (/(^|[^a-z])f([^a-z]|$)/.test(n)) return "F";
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
  return resolveUmSabor(n, allFlavors);
}
type PedidoCompleto = {
  size: string;
  flavor: string;
  border: string;
}
function detectaPedidoCompleto(text: string): PedidoCompleto | null {
  const n = normalizar(text);
  const size = detectaTamanhoDaMensagem(n);
  if (!size) return null;
  let flavor: string | null = null;
  // Meio a meio: só vale para tamanhos que permitem dois sabores e quando o cliente sinaliza a intenção
  const sinalizaMeioAMeio = n.includes("meio a meio") || n.includes("meio") || n.includes("/") || n.includes(" e ");
  if (permiteMeioAMeio(size) && sinalizaMeioAMeio) {
    const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
    const dois = detectaDoisSabores(n, allFlavors);
    if (dois && dois[0] !== dois[1]) {
      flavor = `${dois[0]}/${dois[1]}`;
    }
  }
  if (!flavor) flavor = detectaSaborDaMensagem(n);
  if (!flavor) return null;
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
  const border = detectaBordaDaMensagem(n);
  // Para procurar o SABOR, removemos o trecho que fala da borda (ex: "com borda de chocolate"),
  // senão "chocolate"/"catupiry"/"cheddar" da borda seriam confundidos com sabor.
  let nSemBorda = n;
  const idxBorda = n.search(/\bborda\b/);
  if (idxBorda >= 0) nSemBorda = n.slice(0, idxBorda);
  // tenta meio a meio primeiro (se o tamanho permite e há sinal)
  let flavor: string | null = null;
  const sinalizaMeioAMeio = nSemBorda.includes("meio a meio") || nSemBorda.includes("meio") || nSemBorda.includes("/") || nSemBorda.includes(" e ");
  if (size && permiteMeioAMeio(size) && sinalizaMeioAMeio) {
    const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
    const dois = detectaDoisSabores(nSemBorda, allFlavors);
    if (dois && dois[0] !== dois[1]) flavor = `${dois[0]}/${dois[1]}`;
  }
  if (!flavor) flavor = detectaSaborDaMensagem(nSemBorda);
  if (!size && !flavor && !border) return null;
  return { size: size ?? undefined, flavor: flavor ?? undefined, border: border ?? undefined };
}

// Processa um pedido de pizza vindo numa mensagem (completo ou parcial) e decide o próximo passo,
// pulando as etapas que o cliente já informou. Regra: se não veio borda, SEMPRE oferece borda.
// Retorna null se a mensagem não tem nada de pizza (aí o chamador segue o fluxo normal).
function montarPizzaDoPedido(text: string, session: BotSession, prefixo?: string): BotResponse | null {
  const parcial = detectaPedidoParcial(text);
  if (!parcial || (!parcial.size && !parcial.flavor)) return null;

  const pre = prefixo ? prefixo + "\n\n" : "";

  // 1) Falta tamanho -> pergunta tamanho (guarda o sabor se já veio)
  if (!parcial.size) {
    return {
      messages: [
        `${pre}Boa! Só me diz o tamanho dessa pizza 😋\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir)_`,
      ],
      session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza", currentFlavor: parcial.flavor }),
    };
  }

  // 2) Falta sabor -> pergunta sabor (guarda o tamanho)
  if (!parcial.flavor) {
    return {
      messages: [
        `${pre}Pizza *${parcial.size}* anotada! 👌`,
        `Agora me conta — qual o sabor? 😋 Você pode escolher até *2 sabores*!\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir)_`,
      ],
      session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: parcial.size }),
    };
  }

  // 3) Tem tamanho + sabor. Falta borda? -> SEMPRE oferece borda
  if (!parcial.border) {
    return {
      messages: [
        `${pre}Pizza *${parcial.size}* de *${parcial.flavor}*! 😋`,
        `Vai querer borda recheada? 😋`,
      ],
      session: resetaTentativas({ ...session, step: "border_escolha", currentCategory: "pizza", currentSize: parcial.size, currentFlavor: parcial.flavor }),
    };
  }

  // 4) Pedido completo (tamanho + sabor + borda) -> adiciona pizza e segue pro "mais alguma coisa"
  const { size, flavor, border } = parcial;
  const newItem = criarItemPizza(size, flavor, border);
  if (!newItem) return respostaCombinacaoPizzaIndisponivel(size, session);
  const newCart = [...session.cart, newItem];
  const bordaTxt = border !== "Sem borda" ? ` com borda de *${border}*` : "";
  return {
    messages: [
      `${pre}Pizza *${size}* de *${flavor}*${bordaTxt} anotada! 🤤`,
      mensagemAddMore(newCart),
    ],
    session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentCategory: "pizza", currentSize: undefined, currentFlavor: undefined }),
  };
}
// Mapeamento de famílias de produto: palavras-chave → filtro sobre nomes do cardápio.
// Adicionar novas famílias aqui quando o cardápio crescer.
const FAMILIAS_PRODUTO: Array<{
  palavras: string[];
  label: string;
  titulo: string;
  filtro: (nomeNormalizado: string) => boolean;
}> = [
  {
    palavras: ["macarronada", "macarrao", "macarrona", "macaronada", "macarrão", "massa"],
    label: "macarronada",
    titulo: "Nossas macarronadas",
    filtro: (nome) => nome.includes("macarronada"),
  },
];

export function detectarFamiliaProduto(text: string): { label: string; itens: typeof MENU.lanches } | null {
  const n = normalizar(text);
  if (n === "lanche" || n === "2" || n === "lanches") return null;

  for (const familia of FAMILIAS_PRODUTO) {
    if (familia.palavras.some(p => n.includes(normalizar(p)))) {
      const itens = MENU.lanches.filter(l => familia.filtro(normalizar(l.name)) && !isEsgotado(l.name));
      if (itens.length > 0) return { label: familia.label, itens };
    }
  }
  return null;
}

function mensagemFamilia(label: string, itens: typeof MENU.lanches): string {
  const fam = FAMILIAS_PRODUTO.find(f => f.label === label);
  const titulo = fam?.titulo ?? `Temos essas opções de ${label}`;
  // Lista no estilo "sabor" (igual à pizza): só o nome, sem preço — o preço aparece
  // depois, na escolha de tamanho.
  const listaTxt = itens.map((item, i) => `  ${i + 1}. *${item.name}*`).join("\n");
  return `${titulo}: 😋\n\n${listaTxt}\n\nDigite o número ou o sabor que deseja:`;
}

// Monta a mensagem de escolha de tamanho para um produto que tem tamanhos
// próprios (ex: cada macarronada). Usa os preços do próprio item do cardápio.
function mensagemTamanhoProduto(item: typeof MENU.lanches[0]): string {
  const labelTam: Record<string, string> = { P: "Pequena", M: "Média", G: "Grande", F: "Família" };
  const linhas = (item.sizes ?? [])
    .map((s, i) => `  ${i + 1}. ${labelTam[s.code] ?? s.code} (${s.code}) · *${formatCurrency(s.price)}*`)
    .join("\n");
  return `Ótima escolha! 😋 Qual tamanho da *${item.name}*?\n\n${linhas}\n\n_(Bacon ou ovos: acréscimo de R$ 10,00)_`;
}

// Helper ÚNICO para responder com a lista filtrada de uma família de produto.
// Usado por TODOS os pontos de entrada (name, category, add_more) para garantir
// que a família nunca caia em handleCategory("lanche").
function responderFamiliaProduto(session: BotSession, familia: { label: string; itens: typeof MENU.lanches }): BotResponse {
  return {
    messages: [mensagemFamilia(familia.label, familia.itens)],
    session: resetaTentativas({
      ...session,
      step: "product_family_choice",
      currentCategory: "lanche",
      candidatosFamilia: familia.itens,
      familiaLabel: familia.label,
    }),
  };
}

export function detectarLancheEspecifico(text: string, session: BotSession): BotResponse | null {
  // Família de produto (ex: todas as macarronadas) → mostra lista filtrada
  const familia = detectarFamiliaProduto(text);
  if (familia) return responderFamiliaProduto(session, familia);

  // Produto específico não-família (ex: X-Burguer, Calzone)
  const n = normalizar(text);
  if (n === "lanche" || n === "2" || n === "lanches") return null;

  const nomesLanches = MENU.lanches.map(l => l.name);
  const lancheNome = resolveUmSabor(n, nomesLanches);
  if (!lancheNome) return null;

  const lanche = MENU.lanches.find(l => l.name === lancheNome);
  if (!lanche) return null;
  if (isEsgotado(lanche.name)) return respostaEsgotado(lanche.name, nomesLanches, session);

  if (lanche.hasFlavors) {
    const flavors = saboresLanche(lanche);
    const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
    return {
      messages: [`*${lanche.name}* selecionado! 😋 Qual sabor?\n\n${lista}`],
      session: resetaTentativas({ ...session, step: "lanche_flavor", currentCategory: "lanche", currentLanche: lanche.name }),
    };
  }
  const newItem: CartItem = { category: "lanche", name: lanche.name, price: lanche.price };
  const newCart = [...session.cart, newItem];
  return {
    messages: [mensagemAddMore(newCart)],
    session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }),
  };
}

function nomeCategoriaAtual(step: BotStep, currentCategory?: string): string {
  if (currentCategory === "pizza" || step === "size" || step === "flavor" || step === "segundo_sabor" || step === "border" || step === "border_escolha") return "pizza";
  if (currentCategory === "lanche" || step === "lanche_escolha" || step === "lanche_flavor" || step === "lanche_macarronada_size" || step === "product_family_choice") return "lanche";
  if (currentCategory === "bebida" || step === "bebida_escolha") return "bebida";
  if (currentCategory === "suco" || step === "suco_escolha") return "suco";
  return "item atual";
}
function mensagemCategorias(): string {
  return `O que vai ser hoje? Temos coisa boa te esperando! 😋\n\n  1. Pizza\n  2. Lanches\n  3. Bebidas\n  4. Sucos e Vitaminas`;
}

// Link do cardápio digital — deve acompanhar toda mensagem que chama o cliente
// para iniciar ou continuar a montagem do pedido (nunca em mensagens de
// pós-pedido: done, aguardando_pix, escalado, status/rastreamento).
export const LINK_CARDAPIO_DIGITAL = "https://chefebot-pjif.vercel.app/cardapio";
export function textoLinkCardapioDigital(): string {
  return `Se preferir ver o cardápio digital, é só acessar:\n${LINK_CARDAPIO_DIGITAL}`;
}
// Saudação padrão do primeiro contato — mesma copy tanto com o bot ligado
// (cliente cumprimenta e ainda não tem sessão) quanto com o bot pausado
// (global ou aguardando atendente, também sem sessão prévia): garante que o
// cliente nunca fique sem nenhuma resposta na primeira mensagem, mesmo que
// ninguém tenha assumido a conversa ainda. Ver POST /api/whatsapp.
export function mensagemSaudacaoPadrao(nomePizzaria = "Chefe da Pizza"): string {
  return `Oi! 👋 Bem-vindo à *${nomePizzaria}*! 🍕\n\nSe demorar aqui, peça pelo cardápio digital — é mais rápido:\n${LINK_CARDAPIO_DIGITAL}`;
}
// Mensagem de encerramento por inatividade — ver src/lib/inatividadeConversa.ts:
// disparada quando o cliente fica 10 min em silêncio depois da nossa última
// mensagem (bot ou atendente), numa etapa em que ainda não existe pedido de
// verdade criado. Mesmo tom da saudação padrão, oferecendo a mesma saída.
export function mensagemCancelamentoPorInatividade(): string {
  return `Vi que você ficou um tempinho sem responder, então cancelei esse pedido por aqui — sem problema! 😊\n\nQuando quiser, é só chamar de novo ou pedir pelo cardápio digital, mais rápido:\n${LINK_CARDAPIO_DIGITAL}`;
}
// Anexa o link do cardápio a uma mensagem, evitando duplicar se ele já estiver presente.
export function comLinkCardapio(mensagem: string): string {
  if (mensagem.includes(LINK_CARDAPIO_DIGITAL)) return mensagem;
  return `${mensagem}\n\n${textoLinkCardapioDigital()}`;
}

// ── GATE CENTRAL DO LINK DO CARDÁPIO ─────────────────────────────────────────
// Regra de negócio definitiva: TODA mensagem que convida o cliente a iniciar,
// retomar ou continuar um pedido deve conter o link do cardápio digital.
// Este gate roda no wrapper processMessage (cobre o bot determinístico inteiro,
// tanto /api/whatsapp quanto /api/bot) e nos pontos de texto gerado fora dele
// (fallback inteligente/IA e retomada pós-handoff no webhook).
//
// Steps em que o link NUNCA entra: pagamento/confirmação/pós-pedido/humano.
// O caso "done" é bloqueado pelo step RESULTANTE: quando o bot reinicia o
// atendimento a sessão sai de done (vira category), então o convite de novo
// pedido recebe o link; já a confirmação "pedido foi pra cozinha" permanece em
// done e fica sem link — preservando o espaço do futuro link de rastreamento.
const STEPS_BLOQUEADOS_LINK_CARDAPIO = new Set<string>([
  "done", "aguardando_pix", "escalado",
  "payment", "payment_hibrido_valor", "payment_hibrido_complemento", "troco", "confirm",
]);

// Conteúdo que identifica mensagem operacional/pós-pedido (nunca recebe link),
// avaliado sobre o texto normalizado (sem acentos, minúsculas).
const TERMOS_BLOQUEIO_LINK: RegExp[] = [
  /entregue/, /cancelad/, /avalia/, /\bnota\b/, /feedback/,
  /em preparo/, /sendo preparado/, /saiu para entrega/, /foi pra cozinha/, /chega em/,
  /pagamento/, /\bpix\b/, /comprovante/, /troco/,
  /atendente/, /equipe/, /humano/, /ja chamo alguem/, /vem ai em breve/,
  /rastrear/, /rastreamento/, /acompanhamento/, /\bstatus\b/, /resolvido/,
];

// Conteúdo que identifica convite para iniciar/retomar/continuar pedido.
const TERMOS_CONVITE_LINK: RegExp[] = [
  /\bpizzas?\b/, /\blanches?\b/, /\bbebidas?\b/, /\bsucos?\b/, /\bvitaminas?\b/,
  /cardapio/, /montar seu pedido/, /fazer (seu |um )?pedido/, /o que vai ser/,
  /vamos montar/, /voltei por aqui/, /escolher uma opcao/, /escolha uma categoria/,
];

// Decide e anexa o link do cardápio numa mensagem final. `step` é o step
// RESULTANTE da sessão quando disponível (opcional para textos gerados por IA
// fora do fluxo determinístico).
export function garantirLinkCardapioEmMensagemDePedido(mensagem: string, step?: BotStep | string): string {
  if (!mensagem || mensagem.includes(LINK_CARDAPIO_DIGITAL)) return mensagem;
  if (step && STEPS_BLOQUEADOS_LINK_CARDAPIO.has(step)) return mensagem;
  const n = normalizar(mensagem);
  if (TERMOS_BLOQUEIO_LINK.some(re => re.test(n))) return mensagem;
  if (!TERMOS_CONVITE_LINK.some(re => re.test(n))) return mensagem;
  return comLinkCardapio(mensagem);
}

// Versão para a resposta completa (várias bolhas): anexa o link no MÁXIMO uma
// vez por resposta, na última mensagem que caracteriza convite de pedido.
export function garantirLinkCardapioEmMensagens(messages: string[], step?: BotStep | string): string[] {
  if (messages.some(m => m.includes(LINK_CARDAPIO_DIGITAL))) return messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const comLink = garantirLinkCardapioEmMensagemDePedido(messages[i], step);
    if (comLink !== messages[i]) {
      const copia = [...messages];
      copia[i] = comLink;
      return copia;
    }
  }
  return messages;
}
function listaBordas(size: string): string {
  return MENU.borders.map((b, i) => `  ${i + 1}. *${b.label}* · *${formatCurrency(getBorderPriceFor(size, b.label))}*`).join("\n") +
    `\n  ${MENU.borders.length + 1}. Sem borda`;
}
// Mesma lógica de fonte única aplicada a bebidas/sucos/lanches (ver flavorsDisponiveis).
function bebidasDisponiveis(): typeof MENU.bebidas {
  return MENU.bebidas.filter(b => !isEsgotado(b.name));
}
function sucosDisponiveis(): typeof MENU.sucos {
  return MENU.sucos.filter(s => !isEsgotado(s.name));
}
function lanchesDisponiveis(): typeof MENU.lanches {
  return MENU.lanches.filter(l => !isEsgotado(l.name) && l.name !== "Mini-Pizza");
}
function listaBebidas(): string {
  const items = bebidasDisponiveis();
  return items.map((b, i) => `  ${i + 1}. ${b.name} · *${formatCurrency(b.price)}*`).join("\n");
}
function listaSucos(): string {
  const items = sucosDisponiveis();
  return items.map((s, i) => `  ${i + 1}. ${s.name} · *${formatCurrency(s.price)}*`).join("\n");
}
function listaLanches(): string {
  const items = lanchesDisponiveis();
  return items.map((l, i) => {
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
    : session.deliveryType === "dine_in"
    ? `\n\n🍽️ *Consumo no local*`
    : `\n\n🏪 *Retirada na loja* · _gratuita_`;
  const obsLine = session.observacao ? `\n\n✏️ _Obs: ${session.observacao}_` : "";
  const trocoLine = session.troco && session.troco !== "Sem troco"
    ? `\n💵 _${session.troco}_`
    : session.troco === "Sem troco" ? `\n💵 _Troco: não precisa_` : "";
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

// Detecta forma de pagamento numa mensagem (lista fechada e segura)
function detectaPagamento(n: string): string | null {
  if (/\bpix\b/.test(n) || n.includes("transfer")) return "Pix";
  if (n.includes("dinheiro") || n.includes("especie") || n.includes("cash") || /\ba vista\b/.test(n)) return "Dinheiro";
  if (n.includes("cartao") || n.includes("credito") || n.includes("debito") || /\bcard\b/.test(n)) return "Cartão";
  return null;
}

// ===== HELPERS DE PAGAMENTO (centralizados) =====
// O paymentMethod pode ser simples ("Pix", "Dinheiro", "Cartão") ou composto, no
// formato híbrido "Pix (R$ 30,00) + Dinheiro (R$ 20,00)". Estes helpers evitam
// comparações soltas (=== "Pix") que quebram no pagamento híbrido com Pix parcial.
export function temPixNoPagamento(paymentMethod?: string): boolean {
  return !!paymentMethod && /\bpix\b/i.test(paymentMethod);
}
export function temDinheiroNoPagamento(paymentMethod?: string): boolean {
  return !!paymentMethod && /dinheiro/i.test(paymentMethod);
}
// Extrai o valor associado a um método dentro do label (ex: "Pix (R$ 30,00)" -> 30).
// Retorna null quando o método não tem valor explícito (pagamento simples, sem parênteses).
function extrairValorMetodo(paymentMethod: string | undefined, metodo: string): number | null {
  if (!paymentMethod) return null;
  const re = new RegExp(`${metodo}\\s*\\(R\\$\\s*([0-9.,]+)\\)`, "i");
  const m = paymentMethod.match(re);
  if (!m) return null;
  const valor = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return isNaN(valor) ? null : valor;
}
// Valor esperado do Pix: parte do Pix no híbrido; total no Pix puro; 0 se não houver Pix.
export function valorPixEsperado(paymentMethod: string | undefined, total: number): number {
  if (!temPixNoPagamento(paymentMethod)) return 0;
  const parcial = extrairValorMetodo(paymentMethod, "Pix");
  return parcial ?? total;
}
// Valor esperado em dinheiro: parte em dinheiro no híbrido; total no dinheiro puro; 0 se não houver.
export function valorDinheiroEsperado(paymentMethod: string | undefined, total: number): number {
  if (!temDinheiroNoPagamento(paymentMethod)) return 0;
  const parcial = extrairValorMetodo(paymentMethod, "Dinheiro");
  return parcial ?? total;
}

// Detecta bairro de forma RIGOROSA: o nome do bairro deve aparecer como palavra(s) inteira(s)
// na mensagem, não como substring solta. Prioriza o match mais longo (ex: "Santo Antonio" antes de "Santo").
// Retorna null se não houver match seguro (aí o fluxo normal pergunta o bairro).
function detectaBairro(n: string): { name: string; fee: number } | null {
  // tokens da mensagem (palavras), para comparar por palavra inteira
  const candidatos = MENU.neighborhoods
    .map(nb => ({ nb, alvo: normalizar(nb.name) }))
    // bairro presente como sequência de palavras inteiras: cercado por borda de palavra
    .filter(({ alvo }) => new RegExp(`(^|[^a-z0-9])${alvo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(n))
    // ordena do nome mais longo pro mais curto (evita "Santo" ganhar de "Santo Antonio")
    .sort((a, b) => b.alvo.length - a.alvo.length);
  if (candidatos.length === 0) return null;
  const escolhido = candidatos[0].nb;
  return { name: escolhido.name, fee: escolhido.fee };
}

// Fuzzy match de bairro (erro de digitação: "centor" -> "Centro", "tucun" -> "Tucum").
// NUNCA aplica a taxa direto — sempre retorna um CANDIDATO pra confirmação manual.
// Só aceita se houver vencedor claro (sem ambiguidade entre dois bairros parecidos).
function detectaBairroFuzzy(n: string): { name: string; fee: number } | null {
  const palavras = n.split(/\s+/).filter(p => p.length >= 4);
  if (palavras.length === 0) return null;
  let melhor: { nb: { name: string; fee: number }; d: number } | null = null;
  let segundo = Infinity;
  for (const nb of MENU.neighborhoods) {
    const alvo = normalizar(nb.name);
    const partesAlvo = [alvo, ...alvo.split(/\s+/)].filter(a => a.length >= 4);
    let melhorLocal = Infinity;
    for (const p of palavras) {
      for (const a of partesAlvo) {
        const tol = a.length <= 5 ? 1 : 2; // tolerância pequena: 1 erro em nomes bem curtos, 2 nos demais (cobre transposição de letras, ex: "centor"->"centro")
        const dist = levenshtein(p, a);
        if (dist <= tol && dist < melhorLocal) melhorLocal = dist;
      }
    }
    if (melhorLocal < Infinity) {
      if (!melhor || melhorLocal < melhor.d) { segundo = melhor ? melhor.d : segundo; melhor = { nb, d: melhorLocal }; }
      else if (melhorLocal < segundo) segundo = melhorLocal;
    }
  }
  if (!melhor) return null;
  if (melhor.d >= segundo) return null; // ambíguo entre dois bairros -> não arrisca
  return { name: melhor.nb.name, fee: melhor.nb.fee };
}

// Match por prefixo (primeiras 3 letras) — cobre "Ville" → "Vila", "Can" → "Canaa", etc.
// Retorna lista de candidatos (pode ser vários).
function detectaBairroPrefix(n: string): { name: string; fee: number }[] {
  const palavras = n.split(/\s+/).filter(p => p.length >= 3);
  if (palavras.length === 0) return [];
  const resultado: { name: string; fee: number }[] = [];
  for (const nb of MENU.neighborhoods) {
    const partesNome = normalizar(nb.name).split(/\s+/);
    const match = palavras.some(p =>
      partesNome.some(parte => parte.startsWith(p.slice(0, 3)) || p.startsWith(parte.slice(0, 3)))
    );
    if (match && !resultado.find(r => r.name === nb.name)) resultado.push(nb);
  }
  return resultado;
}

// Bairro da ENTREGA ATUAL está confirmado de forma segura?
// Exige: flag de confirmação desta entrega + bairro cadastrado no menu + taxa batendo com a do bairro.
// Nunca aceita bairro "stale" da sessão nem taxa inventada (correção do bug de bairro fantasma).
function bairroConfirmadoValido(session: BotSession): boolean {
  if (!session.bairroConfirmado || !session.neighborhood) return false;
  const nb = MENU.neighborhoods.find(b => normalizar(b.name) === normalizar(session.neighborhood!));
  return !!nb && session.deliveryFee === nb.fee;
}

// Após o bairro estar confirmado: se o endereço já veio antes, segue pro pagamento;
// senão pede o endereço. Centraliza a transição para nunca pular a confirmação de bairro.
function proximoAposBairro(session: BotSession, nb: { name: string; fee: number }): BotResponse {
  const base: BotSession = {
    ...session,
    deliveryType: "delivery",
    neighborhood: nb.name,
    deliveryFee: nb.fee,
    bairroConfirmado: true,
    candidatosBairro: undefined,
    bairroFuzzyCandidato: undefined,
  };
  if (base.address) {
    // Endereço já veio antes do bairro — se já sabemos o pagamento, retoma o fechamento.
    const pay = base.pagamentoPendente ?? base.paymentMethod;
    if (pay) return aplicaPagamento(pay, base);
    return {
      messages: [`*${nb.name}*, taxa de entrega: *${formatCurrency(nb.fee)}* 🛵\n\n📍 ${base.address}\n\nQual a forma de pagamento? 💸`],
      session: resetaTentativas({ ...base, step: "payment" }),
    };
  }
  return {
    messages: [`*${nb.name}*, taxa de entrega: *${formatCurrency(nb.fee)}* 🛵\n\nMe passa o endereço completo:\n_(Rua, número e complemento)_\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
    session: resetaTentativas({ ...base, step: "address" }),
  };
}

// Detector central de dados de entrega numa única mensagem.
// Conservador: só retorna o que detectou com confiança; o resto fica null (fluxo normal pergunta).
function detectaDadosEntrega(text: string): { tipo: "delivery" | "pickup" | null; bairro: { name: string; fee: number } | null; pagamento: string | null } {
  const n = normalizar(text);
  let tipo: "delivery" | "pickup" | null = null;
  if (n.includes("entrega") || n.includes("delivery") || n.includes("entregar") || n.includes("minha casa") || n.includes("em casa")) tipo = "delivery";
  else if (n.includes("retirar") || n.includes("retirada") || n.includes("buscar") || n.includes("pegar") || n.includes("retiro") || n.includes("na loja")) tipo = "pickup";
  const bairro = detectaBairro(n);
  const pagamento = detectaPagamento(n);
  // Se detectou bairro mas não falou tipo, assume delivery (faz sentido: bairro implica entrega)
  if (bairro && !tipo) tipo = "delivery";
  return { tipo, bairro, pagamento };
}

// Detecta tipo de entrega incluindo consumo no local
function detectaTipoEntregaCompleto(n: string): "delivery" | "pickup" | "dine_in" | null {
  if (/\blocal\b/.test(n) || n.includes("consumo no local") || n.includes("comer ai") ||
      n.includes("aqui mesmo") || n.includes("na mesa") || n.includes("comer aqui")) return "dine_in";
  if (n.includes("entrega") || n.includes("delivery") || n.includes("entregar") ||
      n.includes("minha casa") || n.includes("em casa") || n.includes("manda ai")) return "delivery";
  if (n.includes("retirar") || n.includes("retirada") || n.includes("buscar") ||
      n.includes("pegar") || n.includes("retiro") || n.includes("na loja") || n.includes("busco ai")) return "pickup";
  return null;
}

// Extrai rua/endereço de forma simples e heurística
function extrairEndereco(text: string): string | null {
  const m = text.match(/\b(?:rua|avenida|av\.|travessa|alameda|estrada|quadra)\s+[\wÀ-ú\s,\d]+/i);
  return m ? m[0].trim().slice(0, 100) : null;
}

// Navega para próximo step necessário após produto(s) já estar no cart, aproveitando tudo que veio na sessão
function continuarAposItemCompleto(newCart: CartItem[], session: BotSession, msg: string): BotResponse {
  const s: BotSession = { ...session, cart: newCart };
  if (!s.deliveryType) {
    return {
      messages: [`${msg}\n\nComo você vai querer receber? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`],
      session: resetaTentativas({ ...s, step: "delivery_type" }),
    };
  }
  if (s.deliveryType === "delivery" && !bairroConfirmadoValido(s)) {
    return {
      messages: [`${msg}\n\nQual seu bairro para eu calcular a entrega? 😊`],
      session: resetaTentativas({ ...s, step: "neighborhood", neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false }),
    };
  }
  if (s.deliveryType === "delivery" && !s.address) {
    return {
      messages: [`${msg}\n\nMe passa o endereço completo para entrega:\n_(Rua, número e complemento)_`],
      session: resetaTentativas({ ...s, step: "address" }),
    };
  }
  if (!s.paymentMethod) {
    return {
      messages: [`${msg}\n\nQual vai ser a forma de pagamento? 💸\n\n  1. Pix 💸\n  2. Dinheiro 💵\n  3. Cartão 💳`],
      session: resetaTentativas({ ...s, step: "payment" }),
    };
  }
  return aplicaPagamento(s.paymentMethod, s);
}

// Pedido completo inteligente: identifica produto + entrega + pagamento de uma única mensagem.
// Só ativa quando há pelo menos um campo de entrega/pagamento junto ao produto.
// Retorna null se a mensagem não contiver info suficiente (deixa os steps normais tratarem).
function processarPedidoCompleto(text: string, session: BotSession): BotResponse | null {
  const n = normalizar(text).replace(/-/g, " ");

  // Detecta entrega/bairro/pagamento
  const deliveryType = detectaTipoEntregaCompleto(n);
  // Só aceita bairro por MATCH EXATO aqui (seguro). Prefixo/fuzzy é parcial e
  // precisa de confirmação — fica para o step de bairro perguntar/confirmar.
  const bairroDetectado = detectaBairro(n);
  const pagamento = detectaPagamento(n);

  // Só ativa quando a mensagem carrega info de entrega/pagamento além do produto
  const temInfoExtra = !!(deliveryType || bairroDetectado || pagamento);
  if (!temInfoExtra) return null;

  // Palavras-gatilho que não são produtos (intenção de compra)
  const nSemGatilho = n
    .replace(/\b(quero|manda|me ve|vou querer|pode ser|me manda|manda ai|pode|traz|traga|gostaria de|me passa)\b/g, "")
    .trim();

  // Detecta produto
  const isMiniPizza = nSemGatilho.includes("mini pizza");
  const isPizza = !isMiniPizza && (nSemGatilho.includes("pizza") || !!detectaPedidoParcial(text));

  // Lanche por nome (exceto Mini-Pizza).
  // Compara sem hífen/espaço para aceitar "x-burguer", "x burguer" e "xburguer" como equivalentes.
  const lanche = !isMiniPizza && !isPizza
    ? MENU.lanches.find(l => {
        if (l.name === "Mini-Pizza" || isEsgotado(l.name)) return false;
        const nNome = normalizar(l.name).replace(/-/g, " ");
        const nNomeSemEsp = nNome.replace(/\s+/g, "");
        const nSemEsp = nSemGatilho.replace(/\s+/g, "");
        return nSemGatilho.includes(nNome) || nSemEsp.includes(nNomeSemEsp);
      })
    : null;

  // Sucos por nome (usar parsearMultiSuco ou match individual)
  const multiSuco = !lanche && !isPizza && !isMiniPizza ? parsearMultiSuco(text) : null;
  const sucoSingle = !multiSuco && !lanche && !isPizza && !isMiniPizza
    ? MENU.sucos.find(s => !isEsgotado(s.name) && nSemGatilho.includes(normalizar(s.name).split(" ")[0]))
    : null;
  const sucosItems: CartItem[] = multiSuco ?? (sucoSingle ? [{ category: "suco" as const, name: sucoSingle.name, price: sucoSingle.price }] : []);

  // Bebida por nome
  const bebida = !lanche && !isPizza && !isMiniPizza && sucosItems.length === 0
    ? MENU.bebidas.find(b => !isEsgotado(b.name) && nSemGatilho.includes(normalizar(b.name).split(" ")[0]))
    : null;

  const temProduto = isPizza || isMiniPizza || !!lanche || sucosItems.length > 0 || !!bebida;
  if (!temProduto) return null;

  // Monta base da sessão com todos os campos já conhecidos
  const tipoEntrega = deliveryType ?? (bairroDetectado ? "delivery" : null);
  let sessionBase: BotSession = { ...session };
  if (tipoEntrega === "delivery") {
    // NUNCA reaproveita bairro/taxa antigos da sessão. Só aplica se veio bairro EXATO
    // nesta mensagem; caso contrário zera para o fluxo perguntar/confirmar o bairro.
    sessionBase = {
      ...sessionBase,
      deliveryType: "delivery",
      deliveryFee: bairroDetectado ? bairroDetectado.fee : 0,
      neighborhood: bairroDetectado ? bairroDetectado.name : undefined,
      bairroConfirmado: bairroDetectado ? true : false,
    };
  } else if (tipoEntrega === "pickup" || tipoEntrega === "dine_in") {
    sessionBase = { ...sessionBase, deliveryType: tipoEntrega, deliveryFee: 0, neighborhood: undefined, bairroConfirmado: false };
  }
  if (pagamento) sessionBase = { ...sessionBase, paymentMethod: pagamento };
  const enderecoDetectado = extrairEndereco(text);
  if (enderecoDetectado) sessionBase = { ...sessionBase, address: enderecoDetectado };

  // ---- Mini-pizza (tamanho oficial, sem borda) ----
  if (isMiniPizza) {
    return {
      messages: [`Perfeito! 😄 Mini-Pizza anotada! 🍕 Qual sabor?\n\n${MENU.miniPizzaFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`],
      session: resetaTentativas({ ...sessionBase, step: "flavor", currentCategory: "pizza", currentSize: "MINI" }),
    };
  }

  // ---- Pizza ----
  if (isPizza) {
    const parcial = detectaPedidoParcial(text);
    if (!parcial || (!parcial.size && !parcial.flavor)) {
      return {
        messages: [`Perfeito! 🍕 Qual o tamanho da pizza?\n\n${sizeListComMiniPizza()}`],
        session: resetaTentativas({ ...sessionBase, step: "size", currentCategory: "pizza" }),
      };
    }
    if (parcial.size && parcial.flavor) {
      if (!parcial.border) {
        return {
          messages: [`Pizza *${parcial.size}* de *${parcial.flavor}*! 😋\n\nVai querer borda recheada? 😋`],
          session: resetaTentativas({ ...sessionBase, step: "border_escolha", currentCategory: "pizza", currentSize: parcial.size, currentFlavor: parcial.flavor }),
        };
      }
      const item = criarItemPizza(parcial.size, parcial.flavor, parcial.border);
      if (!item) return respostaCombinacaoPizzaIndisponivel(parcial.size, sessionBase);
      const bordaTxt = parcial.border !== "Sem borda" ? ` com borda de *${parcial.border}*` : "";
      return continuarAposItemCompleto([...sessionBase.cart, item], sessionBase, `Pizza *${parcial.size}* de *${parcial.flavor}*${bordaTxt} anotada! 🤤`);
    }
    if (parcial.size) {
      return {
        messages: [`Pizza *${parcial.size}* anotada! 👌\n\nQual o sabor? 😋 Pode escolher até 2 sabores!\n\n${listaFlavors()}`],
        session: resetaTentativas({ ...sessionBase, step: "flavor", currentCategory: "pizza", currentSize: parcial.size }),
      };
    }
    return {
      messages: [`*${parcial.flavor}* boa pedida! 😋 Qual o tamanho?\n\n${sizeListComMiniPizza()}`],
      session: resetaTentativas({ ...sessionBase, step: "size", currentCategory: "pizza", currentFlavor: parcial.flavor }),
    };
  }

  // ---- Lanche ----
  if (lanche) {
    if (lanche.sizes && lanche.sizes.length > 0) {
      return { messages: [mensagemTamanhoProduto(lanche)], session: resetaTentativas({ ...sessionBase, step: "lanche_macarronada_size", currentLanche: lanche.name }) };
    }
    if (lanche.hasFlavors) {
      const flavors = saboresLanche(lanche);
      return {
        messages: [`*${lanche.name}* selecionado! 😋 Qual sabor?\n\n${flavors.map((flavor, i) => `  ${i + 1}. ${flavor}`).join("\n")}`],
        session: resetaTentativas({ ...sessionBase, step: "lanche_flavor", currentLanche: lanche.name }),
      };
    }
    const item: CartItem = { category: "lanche", name: lanche.name, price: lanche.price };
    return continuarAposItemCompleto([...sessionBase.cart, item], sessionBase, `*${lanche.name}* anotado! 😋`);
  }

  // ---- Sucos ----
  if (sucosItems.length > 0) {
    const leiteDetectado = detectaLeiteTexto(text);
    const algumAceitaLeite = sucosItems.some(aceitaLeite);
    const leite = algumAceitaLeite ? leiteDetectado : "sem";
    const labels = [...new Map(sucosItems.map(i => [i.name, i])).keys()].map(nome => `*${nome}*`).join(" e ");
    if (leite) {
      const itensComLeite = aplicarLeite(sucosItems, leite);
      return continuarAposItemCompleto([...sessionBase.cart, ...itensComLeite], sessionBase, `${labels} anotado${sucosItems.length > 1 ? "s" : ""}! 😋`);
    }
    return {
      messages: [`${labels} anotado${sucosItems.length > 1 ? "s" : ""}! 😋\n\nQuer com leite ou sem leite? 🥤\n\n  1. Com leite\n  2. Sem leite`],
      session: resetaTentativas({ ...sessionBase, step: "suco_leite", pendingSucosLeite: sucosItems }),
    };
  }

  // ---- Bebida ----
  if (bebida) {
    const item: CartItem = { category: "bebida", name: bebida.name, price: bebida.price };
    return continuarAposItemCompleto([...sessionBase.cart, item], sessionBase, `*${bebida.name}* anotada! 😋`);
  }

  return null;
}

// Aplica uma forma de pagamento e decide o próximo passo (troco se dinheiro, senão confirmação).
// Usado tanto no step payment quanto na captura inteligente. Limpa pagamentoPendente.
function aplicaPagamento(payment: string, session: BotSession): BotResponse {
  const updatedSession = { ...session, paymentMethod: payment, pagamentoPendente: undefined };
  // Se o cliente pulou a etapa de nome (foi direto pro pedido), pede agora, antes de fechar.
  if (!updatedSession.customerName) {
    return { messages: [`Quase lá! Só me diz seu nome pra eu finalizar o pedido 😊`], session: resetaTentativas({ ...updatedSession, step: "pedindo_nome" }) };
  }
  return continuaParaTrocoOuConfirm(updatedSession);
}

// Finaliza pedido de retirada direto, sem tela de confirmação.
// Para Pix: mantém aguardando_pix (regra existente). Para demais: vai a done com resumo.
function finalizarPedidoPickup(session: BotSession): BotResponse {
  const subtotal = cartSubtotal(session.cart);
  const total = subtotal + session.deliveryFee;
  const resumo = resumoCarrinho(session.cart);
  const obsLine = session.observacao ? `\n\n✏️ _Obs: ${session.observacao}_` : "";
  const trocoLine = session.troco && session.troco !== "Sem troco"
    ? `\n💵 _${session.troco}_`
    : session.troco === "Sem troco" ? `\n💵 _Troco: não precisa_` : "";
  if (temPixNoPagamento(session.paymentMethod)) {
    return {
      messages: [`Fechado ✅\n\nSeu pedido ficou confirmado para retirada no balcão.\n\n${resumo}${obsLine}\n\nPagamento: ${session.paymentMethod}\nTotal: ${formatCurrency(total)}\n\nPara finalizar, envie o comprovante do Pix.\n\nChave Pix: (configurada pelo admin) 💸\n\nAssim que confirmarmos o pagamento, seu pedido vai direto pra cozinha! 🍕`],
      session: { ...session, step: "aguardando_pix" },
    };
  }
  return {
    messages: [`Fechado ✅\n\nSeu pedido ficou confirmado para retirada no balcão.\n\n${resumo}${obsLine}${trocoLine}\n\nPagamento: ${session.paymentMethod}\nTotal: ${formatCurrency(total)}\n\nQuando chegar, é só falar o nome do pedido.`],
    session: { ...session, step: "done" },
  };
}

function continuaParaTrocoOuConfirm(session: BotSession): BotResponse {
  // BLOQUEIO DE SEGURANÇA: entrega nunca fecha sem bairro confirmado e taxa válida.
  // Rede de proteção final — preserva o pagamento já escolhido p/ retomar após o bairro.
  if (session.deliveryType === "delivery" && !bairroConfirmadoValido(session)) {
    return {
      messages: [`Antes de fechar, preciso confirmar o endereço de entrega 😊\n\nQual o bairro da entrega?`],
      session: resetaTentativas({
        ...session,
        step: "neighborhood",
        neighborhood: undefined,
        deliveryFee: 0,
        bairroConfirmado: false,
        pagamentoPendente: session.paymentMethod ?? session.pagamentoPendente,
      }),
    };
  }
  // RETIRADA: pula a tela de confirmação e finaliza direto com resumo.
  // Dinheiro na retirada: ainda pergunta troco (útil no balcão); o handler de troco
  // também detecta pickup e finaliza sem confirm após recolher o troco.
  if (session.deliveryType === "pickup") {
    if (temDinheiroNoPagamento(session.paymentMethod)) {
      return { messages: [`Combinado, pagamento em dinheiro ✅\n\nVai precisar de troco?\n\nSe precisar, me fala pra quanto.\nSe não precisar, pode responder só: não`], session: resetaTentativas({ ...session, step: "troco" }) };
    }
    return finalizarPedidoPickup(session);
  }
  if (temDinheiroNoPagamento(session.paymentMethod)) {
    return { messages: [`Combinado, pagamento em dinheiro ✅\n\nVai precisar de troco?\n\nSe precisar, me fala pra quanto.\nSe não precisar, pode responder só: não`], session: resetaTentativas({ ...session, step: "troco" }) };
  }
  const receipt = buildReceipt(session);
  return { messages: [`Confere seu pedido 👇\n\n${receipt}\n\nTá certinho?\n  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`], session: resetaTentativas({ ...session, step: "confirm" }) };
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
      messages: [`Qual o tamanho da pizza? 🍕\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
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
  const querCardapio = !intencao && detectaIntencaoCardapio(text);
  if (!intencao && !querCardapio) return null;
  const categoriaAtual = nomeCategoriaAtual(session.step, session.currentCategory);
  if (intencao && intencao.category === session.currentCategory) return null;
  const novaLabel = intencao ? intencao.label : "cardápio";
  const pendingCategory = intencao ? intencao.category : "category";
  return {
    messages: [`Ei, você ainda quer o *${categoriaAtual}*? Ou prefere ir pro *${novaLabel}*?\n\n  1. Manter o ${categoriaAtual}\n  2. Ir pro ${novaLabel}`],
    session: { ...session, step: "confirmando_mudanca", pendingCategory },
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
  // Frases/termos longos: substring simples é seguro (não colidem com palavras comuns)
  const frases = ["nao entendi", "nao entendeu", "nao percebi", "nao compreendi", "como assim", "que isso", "que e isso", "nao to entendendo", "nao estou entendendo", "confuso", "confused", "nao sei", "pode explicar", "explica"];
  if (frases.some(p => n.includes(p))) return true;
  // Termos curtos/ambíguos: exigem borda de palavra para não colidir com substrings
  // (ex: "ha" aparece dentro de "fechar"; "oque" pode aparecer colado em outras palavras digitadas errado)
  const termosCurtos = ["o que", "oque", "hein", "ha"];
  return termosCurtos.some(p => new RegExp(`(^|[^a-z])${p}([^a-z]|$)`).test(n));
}
function ePositiva(n: string): boolean {
  return n === "sim" || n === "s" || n === "1" || n.includes("sim") ||
    n.includes("quero") || n.includes("pode") || n.includes("bora") ||
    n.includes("claro") || n.includes("vai") || n.includes("beleza") ||
    n.includes("ok") || n.includes("certo") || n.includes("isso");
}
// Extrai quantidade + nome de produto de mensagens como "3 coca", "2x burguer", "quero 4 hambúrgueres".
// NUNCA chamada em steps de seleção (size/flavor/border/payment/delivery_type/category/confirm).
// Retorna null se a mensagem for só um número (ex: "2") — esses nunca são quantidade sem produto.
function parsearQtdEItem(text: string): { qty: number; produto: string } | null {
  const n = normalizar(text);
  const numPorExtenso: Record<string, number> = {
    "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6, "sete": 7,
  };
  // Remove prefixos de intenção comuns
  const semPrefixo = n
    .replace(/^(?:quero|me ve|me ve|me da|me da|pode ser|pode|manda|vou querer|queria|gostaria de|da um|da)\s+/, "");
  // Padrão: número (+ 'x' opcional) + produto (exige pelo menos 2 chars de produto)
  const m1 = semPrefixo.match(/^(\d{1,2})x?\s+(.{2,})$/);
  if (m1) {
    const qty = parseInt(m1[1]);
    const produto = m1[2].trim();
    if (qty >= 1 && qty <= 20) return { qty, produto };
  }
  // Padrão: número por extenso + produto
  const m2 = semPrefixo.match(/^(um[a]?|dois|duas|tres|quatro|cinco|seis|sete)\s+(.{2,})$/);
  if (m2) {
    const qty = numPorExtenso[m2[1]] ?? 0;
    const produto = m2[2].trim();
    if (qty >= 1) return { qty, produto };
  }
  return null;
}

// Interpreta mensagem com múltiplos sucos e quantidades individuais.
// Ex: "um de maracuja e 1 de bacuri" → [Maracujá, Bacuri]
// Ex: "maracuja e bacuri" → [Maracujá, Bacuri]
function parsearMultiSuco(text: string): CartItem[] | null {
  const n = normalizar(text).replace(/-/g, " ");
  const numMap: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3 };
  const nomesS = MENU.sucos.map(s => s.name);
  const partes = n.split(/\s+e\s+|,\s*|\s+mais\s+/).map(s => s.trim()).filter(Boolean);
  if (partes.length < 2) return null;
  const itens: CartItem[] = [];
  for (const parte of partes) {
    let qty = 1;
    let produto = parte;
    const mQtd = parte.match(/^(\d+|um[a]?|dois|duas|tres)\s+(?:de\s+)?(.+)$/);
    if (mQtd) {
      qty = parseInt(mQtd[1]) || numMap[mQtd[1]] || 1;
      produto = mQtd[2].trim();
    } else {
      produto = parte.replace(/^de\s+/, "");
    }
    const suco = resolveUmSabor(produto, nomesS);
    if (!suco) return null;
    const sucoData = MENU.sucos.find(s => s.name === suco)!;
    for (let i = 0; i < qty; i++) {
      itens.push({ category: "suco" as const, name: suco, price: sucoData.price });
    }
  }
  return itens.length >= 2 ? itens : null;
}
function detectaLeiteTexto(text: string): "com" | "sem" | null {
  const n = normalizar(text);
  if (n.includes("com leite") || n.includes("c/ leite")) return "com";
  if (n.includes("sem leite") || n.includes("s/ leite") || n.includes("puro") || n.includes("pura") || n === "sem") return "sem";
  return null;
}
function aceitaLeite(item: CartItem): boolean {
  if (item.category !== "suco") return false;
  return MENU.sucos.find((produto) => produto.name === item.name)?.acceptsMilk !== false;
}
function aplicarLeite(items: CartItem[], leite: "com" | "sem"): CartItem[] {
  return items.map(item => {
    if (!aceitaLeite(item)) return item;
    return { ...item, name: `${item.name}${leite === "com" ? " com leite" : " sem leite"}`, price: leite === "com" ? item.price + 1 : item.price };
  });
}
function finalizarSucos(novosItens: CartItem[], text: string, session: BotSession, label: string): BotResponse {
  const leiteTexto = detectaLeiteTexto(text);
  const algumAceitaLeite = novosItens.some(aceitaLeite);
  if (leiteTexto || !algumAceitaLeite) {
    const itensComLeite = aplicarLeite(novosItens, leiteTexto ?? "sem");
    const newCart = [...session.cart, ...itensComLeite];
    return { messages: [`${label} anotado${novosItens.length > 1 ? "s" : ""}! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, pendingQtdSuco: undefined, pendingSucosLeite: undefined }) };
  }
  return {
    messages: [`${label} anotado${novosItens.length > 1 ? "s" : ""}! 😋\n\nQuer com leite ou sem leite? 🥤\n\n  1. Com leite\n  2. Sem leite`],
    session: resetaTentativas({ ...session, step: "suco_leite", pendingSucosLeite: novosItens, pendingQtdSuco: undefined }),
  };
}
// Tenta adicionar qty unidades de uma bebida/suco/lanche (sem sabor, sem tamanho) ao carrinho.
// Retorna BotResponse se resolvido com sucesso, null se o produto não foi identificado.
function tentaAdicionarComQtd(
  qtdItem: { qty: number; produto: string },
  session: BotSession,
): BotResponse | null {
  const { qty, produto } = qtdItem;
  // Bebidas
  const nomesBebidas = MENU.bebidas.map(b => b.name);
  const resBebida = resolveSaborComAmbiguidade(produto, nomesBebidas);
  if (resBebida.tipo === "unico") {
    const bebida = MENU.bebidas.find(b => b.name === resBebida.nome);
    if (bebida && !isEsgotado(bebida.name)) {
      const novos: CartItem[] = Array.from({ length: qty }, () => ({ category: "bebida" as const, name: bebida.name, price: bebida.price }));
      const newCart = [...session.cart, ...novos];
      const label = qty > 1 ? `*${qty}x ${bebida.name}*` : `*${bebida.name}*`;
      return { messages: [`${label} anotado${qty > 1 ? "s" : ""}! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
    }
  }
  // Sucos
  const nomesSucos = MENU.sucos.map(s => s.name);
  const resSuco = resolveSaborComAmbiguidade(produto, nomesSucos);
  if (resSuco.tipo === "unico") {
    const suco = MENU.sucos.find(s => s.name === resSuco.nome);
    if (suco && !isEsgotado(suco.name)) {
      const novos: CartItem[] = Array.from({ length: qty }, () => ({ category: "suco" as const, name: suco.name, price: suco.price }));
      const newCart = [...session.cart, ...novos];
      const label = qty > 1 ? `*${qty}x ${suco.name}*` : `*${suco.name}*`;
      return { messages: [`${label} anotado${qty > 1 ? "s" : ""}! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
    }
  }
  // Lanches simples (sem sabor e sem tamanhos variáveis)
  const lancheSimples = MENU.lanches.filter(l => !l.hasFlavors && !l.sizes);
  const nomesLanches = lancheSimples.map(l => l.name);
  const resLanche = resolveSaborComAmbiguidade(produto, nomesLanches);
  if (resLanche.tipo === "unico") {
    const lanche = lancheSimples.find(l => l.name === resLanche.nome);
    if (lanche && !isEsgotado(lanche.name)) {
      const novos: CartItem[] = Array.from({ length: qty }, () => ({ category: "lanche" as const, name: lanche.name, price: lanche.price }));
      const newCart = [...session.cart, ...novos];
      const label = qty > 1 ? `*${qty}x ${lanche.name}*` : `*${lanche.name}*`;
      return { messages: [`${label} anotado${qty > 1 ? "s" : ""}! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
  }
  return null;
}

export function retomarFluxoDoBot(session: BotSession): string[] {
  const step = session.stepAnteriorEscalado ?? session.step;
  const nome = session.customerName ? ` *${session.customerName.split(" ")[0]}*,` : "";
  switch (step) {
    case "category":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\n${mensagemCategorias()}`];
    case "size":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nQual o tamanho da pizza?\n\n${sizeListComMiniPizza()}`];
    case "flavor":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nQual o sabor da pizza? Você pode escolher até *2 sabores*!\n\n${listaFlavors()}`];
    case "border_escolha":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nVai querer borda recheada? 😋`];
    case "add_more":
      return session.cart.length > 0
        ? [`Prontinho,${nome} voltei por aqui! 😊\n\n${mensagemAddMore(session.cart)}`]
        : [`Prontinho,${nome} voltei por aqui! 😊\n\n${mensagemCategorias()}`];
    case "lanche_escolha":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nNossos lanches 😋\n\n${listaLanches()}\n\nDigite o número ou o nome:`];
    case "product_family_choice": {
      const label = session.familiaLabel ?? "produto";
      const itens = session.candidatosFamilia ?? [];
      return [`Prontinho,${nome} voltei por aqui! 😊\n\n${mensagemFamilia(label, itens as typeof MENU.lanches)}`];
    }
    case "lanche_flavor":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nQual o sabor do lanche?`];
    case "bebida_escolha":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nEscolha a bebida:`];
    case "suco_escolha":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nQual o sabor do suco?`];
    case "observacao":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nTem alguma observação pro pedido?`];
    case "delivery_type":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nComo quer receber seu pedido?\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`];
    case "neighborhood":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nQual o seu bairro?`];
    case "address":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nMe passa o endereço completo:\n_(Rua, número e complemento)_`];
    case "payment":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nQual a forma de pagamento? 💸`];
    case "aguardando_pix":
      return [`Prontinho,${nome} voltei por aqui! 😊\n\nSó me manda o comprovante do Pix pra confirmar o pedido! 📄`];
    case "confirm":
      return session.cart.length > 0
        ? [`Prontinho,${nome} voltei por aqui! 😊\n\n${resumoCarrinho(session.cart)}\n\nConfirma o pedido?`]
        : [`Prontinho,${nome} voltei por aqui! 😊\n\nMe confirma rapidinho: você quer continuar o pedido ou começar de novo?`];
    default:
      return [`Prontinho,${nome} voltei por aqui 😊\n\nMe confirma rapidinho: você quer continuar o pedido ou começar de novo?\n\n  1. Continuar pedido\n  2. Começar de novo`];
  }
}

// ============================================================================
// RETOMADA INTELIGENTE PÓS-HANDOFF
// ----------------------------------------------------------------------------
// Quando o atendimento é devolvido do humano para o bot, NADA é enviado
// (prepararRetomadaSilenciosa). Só na PRÓXIMA mensagem real da cliente é que
// reorganizamos o contexto (retomarFluxoAposHandoff). O fluxo rígido continua
// sendo a fonte da verdade para preço, taxa, carrinho, pagamento e confirmação;
// a IA só entra como camada de interpretação quando a conversa está ambígua ou
// interrompida — e mesmo assim NUNCA inventa dados do pedido.
// ============================================================================

export type AutorMensagem = "cliente" | "atendente" | "bot";

export interface MensagemRelevante {
  autor: AutorMensagem;
  texto: string;
  ts?: number;
}

export interface RetomadaHandoff {
  // "deterministico": o fluxo rígido entendeu a nova mensagem e respondeu sozinho.
  // "ia": conversa ambígua/interrompida — recomenda reorganizar o contexto com a
  //       IA usando `promptContexto`; `messages` traz o fallback determinístico
  //       (a próxima pergunta correta) caso a IA não esteja disponível.
  tipo: "deterministico" | "ia";
  session: BotSession;
  messages: string[];
  promptContexto?: string;
  motivo?: string;
}

// Mensagens "de confusão" do bot — sinal de que o fluxo rígido não entendeu.
function ehRespostaConfusa(msg: string): boolean {
  const n = normalizar(msg);
  return [
    "nao entendi", "nao achei", "nao peguei", "nao tem isso",
    "essa nao ta na lista", "acho que nao tem isso",
  ].some(p => n.includes(p));
}

// Aberturas vagas / retomadas de conversa que, logo após um handoff humano, NÃO
// devem reiniciar o bot do zero — sinalizam que a IA deve recolocar a conversa no
// trilho do pedido em vez de tratar como saudação inicial.
function ehAberturaVaga(texto: string): boolean {
  const n = normalizar(texto);
  if (n.length === 0) return true;
  const exatos = [
    "oi", "ola", "ei", "opa", "e ai", "eai", "iae", "alo", "alou", "oi?",
    "voltei", "cheguei", "to aqui", "estou aqui", "e entao", "entao",
    "tudo bem", "tudo bom", "como assim", "?", "??", "???", "e ai?",
    "continua", "continuar", "vamos", "bora", "e a pizza", "e o pedido",
    "cade", "ue", "hein", "oi de novo", "e dai", "to esperando",
  ];
  return exatos.includes(n);
}

// Estado base de retomada: garante que a sessão saiu de "escalado" e limpa as
// flags de handoff, SEM tocar em carrinho / taxa / pagamento / bairro.
function estadoBaseRetomada(session: BotSession): BotSession {
  let step = session.stepAnteriorEscalado ?? session.step;
  if (step === "escalado") step = session.cart.length > 0 ? "add_more" : "category";
  return {
    ...session,
    step,
    escalado: false,
    stepAnteriorEscalado: undefined,
    aguardandoRetomada: false,
    tentativasInvalidas: 0,
  };
}

// Próxima pergunta correta segundo o ESTADO do pedido (fonte da verdade).
// Nunca inventa bairro / pagamento / taxa: apenas pergunta o que falta, na ordem
// do fluxo. Usada como fallback determinístico da IA e para garantir que, faltando
// bairro pede bairro, faltando pagamento pede pagamento, e se completo confirma.
export function proximaPerguntaPorEstado(session: BotSession): { session: BotSession; messages: string[] } {
  const nome = session.customerName ? ` *${session.customerName.split(" ")[0]}*,` : "";
  const pre = `Voltei por aqui,${nome} vamos continuar! 😊\n\n`;

  // 1. Carrinho vazio → escolher item
  if (!session.cart || session.cart.length === 0) {
    return {
      session: resetaTentativas({ ...session, step: "category" }),
      messages: [pre + mensagemCategorias()],
    };
  }
  // 2. Falta forma de recebimento
  if (!session.deliveryType) {
    return {
      session: resetaTentativas({ ...session, step: "delivery_type" }),
      messages: [pre + `Como quer receber seu pedido?\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`],
    };
  }
  // 3. Entrega sem bairro confirmado → pergunta o bairro
  if (session.deliveryType === "delivery" && !bairroConfirmadoValido(session)) {
    return {
      session: resetaTentativas({ ...session, step: "neighborhood" }),
      messages: [pre + `Qual o seu bairro? 😊`],
    };
  }
  // 4. Entrega sem endereço → pergunta o endereço
  if (session.deliveryType === "delivery" && !session.address) {
    return {
      session: resetaTentativas({ ...session, step: "address" }),
      messages: [pre + `Me passa o endereço completo:\n_(Rua, número e complemento)_`],
    };
  }
  // 5. Falta pagamento → pergunta o pagamento
  if (!session.paymentMethod) {
    return {
      session: resetaTentativas({ ...session, step: "payment" }),
      messages: [pre + `Qual a forma de pagamento? 💸\n\n  1. Pix\n  2. Dinheiro\n  3. Cartão`],
    };
  }
  // 6. Pix aguardando comprovante → segue aguardando
  if (temPixNoPagamento(session.paymentMethod) && session.step === "aguardando_pix") {
    return {
      session: resetaTentativas({ ...session, step: "aguardando_pix" }),
      messages: [pre + `Só me enviar o comprovante do Pix pra confirmar o pedido! 📄`],
    };
  }
  // 7. Pedido completo → confirmar
  return {
    session: resetaTentativas({ ...session, step: "confirm" }),
    messages: [pre + `${resumoCarrinho(session.cart)}\n\nPosso confirmar o pedido?`],
  };
}

function montarContextoRetomada(
  base: BotSession,
  novaMensagem: string,
  ultimas: MensagemRelevante[],
  prox: { session: BotSession; messages: string[] },
  intervencaoHumana: boolean,
): string {
  const itens = base.cart.length > 0
    ? base.cart.map(i => `${i.name}${i.size ? " " + i.size : ""}${i.flavor ? " " + i.flavor : ""}`).join("; ")
    : "(carrinho vazio)";
  const histLinhas = (ultimas || []).map(m => {
    const autor = m.autor === "cliente" ? "Cliente" : m.autor === "atendente" ? "Atendente humano" : "Bot";
    return `- ${autor}: ${m.texto}`;
  }).join("\n") || "- (sem histórico recente)";
  const faltas: string[] = [];
  if (!base.cart || base.cart.length === 0) faltas.push("itens do pedido");
  if (!base.deliveryType) faltas.push("forma de recebimento (entrega/retirada/consumo no local)");
  if (base.deliveryType === "delivery" && !bairroConfirmadoValido(base)) faltas.push("bairro");
  if (base.deliveryType === "delivery" && !base.address) faltas.push("endereço");
  if (!base.paymentMethod) faltas.push("forma de pagamento");

  return [
    `Carrinho atual: ${itens}`,
    `Etapa atual do pedido: ${prox.session.step}`,
    `Taxa de entrega atual: ${base.deliveryFee ? formatCurrency(base.deliveryFee) : "ainda não definida"}`,
    `Bairro: ${base.neighborhood ?? "não informado"}`,
    `Pagamento: ${base.paymentMethod ?? "não informado"}`,
    `Intervenção humana recente: ${intervencaoHumana ? "sim" : "não"}`,
    `O que ainda falta: ${faltas.length ? faltas.join(", ") : "nada — o pedido pode ser confirmado"}`,
    ``,
    `Duas últimas mensagens relevantes:`,
    histLinhas,
    ``,
    `Nova mensagem da cliente: "${novaMensagem}"`,
    ``,
    `Próxima pergunta sugerida pelo fluxo (fonte da verdade): "${prox.messages[0]}"`,
  ].join("\n");
}

// Decide, após uma NOVA mensagem real da cliente, como retomar o fluxo.
// Processa SOMENTE a mensagem nova (nunca reprocessa mensagem antiga). Usa as duas
// últimas mensagens relevantes apenas como CONTEXTO para a IA — nunca as injeta no
// fluxo determinístico.
export function retomarFluxoAposHandoff(params: {
  session: BotSession;
  novaMensagem: string;
  ultimasMensagens?: MensagemRelevante[];
  intervencaoHumanaRecente?: boolean;
}): RetomadaHandoff {
  const { novaMensagem } = params;
  const ultimas = params.ultimasMensagens ?? [];
  const base = estadoBaseRetomada(params.session);
  const intervencaoHumana = params.intervencaoHumanaRecente === true
    || ultimas.some(m => m.autor === "atendente");

  // Processa SOMENTE a nova mensagem da cliente.
  const det = processMessage(novaMensagem, base);
  const confuso = det.messages.some(ehRespostaConfusa);
  const aberturaVaga = ehAberturaVaga(novaMensagem);

  // O fluxo rígido resolve sozinho quando entendeu a mensagem e ela não é uma
  // abertura vaga logo após intervenção humana.
  if (!confuso && !(aberturaVaga && intervencaoHumana)) {
    return { tipo: "deterministico", session: det.session, messages: det.messages, motivo: "fluxo_rigido" };
  }

  // Conversa ambígua / interrompida → recomenda IA, com fallback determinístico.
  // A sessão devolvida NÃO altera carrinho / taxa / pagamento: só ajusta o step
  // para a próxima pergunta correta. A IA apenas formula o texto da pergunta.
  const prox = proximaPerguntaPorEstado(base);
  const promptContexto = montarContextoRetomada(base, novaMensagem, ultimas, prox, intervencaoHumana);
  return {
    tipo: "ia",
    session: prox.session,
    messages: prox.messages,
    promptContexto,
    motivo: confuso ? "ambiguo" : "abertura_pos_handoff",
  };
}

// Prepara a devolução do atendimento para o bot de forma SILENCIOSA: sai de
// "escalado", restaura o step anterior e marca que a próxima mensagem da cliente
// deve acionar a retomada. NÃO retorna mensagens — o bot não fala ao ser devolvido.
export function prepararRetomadaSilenciosa(session: BotSession): BotSession {
  let step = session.stepAnteriorEscalado ?? session.step;
  if (step === "escalado") step = session.cart.length > 0 ? "add_more" : "category";
  return {
    ...session,
    step,
    escalado: false,
    stepAnteriorEscalado: undefined,
    aguardandoRetomada: true,
  };
}

export function processMessage(input: string, session: BotSession): BotResponse {
  // Detecta o "ritmo" do cliente pela forma da resposta:
  // resposta que é só número (ex: "1", "2") => cliente apressado => respostas mais rápidas.
  // resposta com texto/palavras => cliente calmo => mantém o ritmo humano.
  const limpo = input.trim();
  let ritmoRapido = session.ritmoRapido;
  if (/^\d{1,2}$/.test(limpo)) {
    ritmoRapido = true;
  } else if (limpo.length > 3) {
    ritmoRapido = false;
  }
  const result = processMessageInner(input, session);
  result.session = { ...result.session, ritmoRapido };
  // Gate central: convites de início/retorno/continuação de pedido saem SEMPRE
  // com o link do cardápio digital (exceções por step/conteúdo no próprio gate).
  result.messages = garantirLinkCardapioEmMensagens(result.messages, result.session.step);
  return result;
}
function processMessageInner(input: string, session: BotSession): BotResponse {
  const text = input.trim();
  const n = normalizar(text);

  // ── REGRA PRIORITY #1: Pergunta sobre entrega/funcionamento ─────────────────
  // Roda antes de QUALQUER outra lógica para não cair em fallbacks de produto/cardápio.
  // Exceção: steps finais (confirm, aguardando_pix) e sessão escalada.
  if (
    session.step !== "escalado" &&
    session.step !== "confirm" &&
    session.step !== "aguardando_pix" &&
    detectaPerguntaEntregaFuncionamento(text)
  ) {
    return {
      messages: [
        `Sim, estamos fazendo entrega sim ✅\n\nHoje nosso atendimento vai até *${HORARIO_FUNCIONAMENTO}*.\n\nPode mandar seu pedido por aqui mesmo.\nO que vai ser hoje? 🍕`,
      ],
      session: resetaTentativas({ ...session, step: session.customerName ? "category" : "name" }),
    };
  }

  // Detecta quantidade de pizzas. Regra de ouro: número PURO sozinho ("2") NUNCA é quantidade —
  // nos steps category/add_more/size ele é opção de menu (1,2,3,4) ou opção de tamanho.
  // Quantidade por número só vale com a palavra "pizza" junto ("2 pizzas"). Palavra por extenso
  // ("duas", "três") pode indicar quantidade sozinha, pois não colide com opção de menu.
  if ((session.step === "size" || session.step === "category" || session.step === "add_more" || session.step === "name") && !session.pendingPizzas) {
    const qtdMap: Record<string, number> = { "uma": 1, "um": 1, "duas": 2, "dois": 2, "tres": 3, "três": 3, "quatro": 4, "cinco": 5 };
    const qtdMatchComPizza = n.match(/(\d+|duas?|dois|tr[eê]s|quatro|cinco)\s+pizzas?/);
    // Número PURO sozinho ("2") nunca conta como quantidade (é opção de menu/tamanho).
    // Só palavra por extenso sozinha ("duas", "tres") conta — e nunca no add_more/category onde vira opção.
    const qtdMatchExtenso = (session.step === "size" || session.step === "name")
      ? n.match(/^(?:quero\s+)?(duas?|dois|tr[eê]s|quatro|cinco)(?:\s+pizzas?)?$/)
      : null;
    // "quero 2 calabresa família", "3 portuguesa grande", "2x pizza calabresa média"
    // Apenas em category/add_more onde não colidem com seleção de tamanho.
    const qtdMatchNumSabor = (session.step === "category" || session.step === "add_more")
      ? (() => {
          const mf = n.match(/^(?:quero\s+)?(\d{1,2})x?\s+(?:pizza\s+)?(.+)$/);
          if (!mf) return null;
          const qty = parseInt(mf[1]);
          if (qty < 2 || qty > 5) return null;
          const todosFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
          if (!todosFlavors.some(f => mf[2].includes(normalizar(f).split(" ")[0]) || normalizar(f).split(" ").some(w => w.length > 3 && mf[2].includes(w)))) return null;
          return mf;
        })()
      : null;
    const qtdMatch = qtdMatchComPizza || qtdMatchExtenso || qtdMatchNumSabor;
    let qtd = 0;
    if (qtdMatch) qtd = parseInt(qtdMatch[1]) || qtdMap[qtdMatch[1].toLowerCase()] || 0;
    if (qtd >= 2 && qtd <= 5) {
      const pedidoCompleto = detectaPedidoCompleto(text);
      if (pedidoCompleto) {
        const { size, flavor, border } = pedidoCompleto;
        const item = criarItemPizza(size, flavor, border);
        if (!item) return respostaCombinacaoPizzaIndisponivel(size, session);
        const novasPizzas: CartItem[] = Array.from({ length: qtd }, () => ({ ...item }));
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
        messages: [`2️⃣ *${qtd} pizzas* anotadas! Vamos montar uma de cada vez 🍕\n\n*Pizza 1 de ${qtd}* — Qual o tamanho?\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
        session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza", pendingPizzas: qtd, pizzaAtualIndex: 1 }),
      };
    }
  }

  // Perguntas de identidade do bot ("você é humano?", "você é robô?") são conversa
  // leve, não pedido de atendente. Nos steps seguros, rota para contextoHumanoSkill
  // sem escalar nem incrementar tentativa inválida.
  if (
    session.step !== "escalado" &&
    (session.step === "category" || session.step === "add_more" || session.step === "name") &&
    ehPerguntaIdentidadeBot(n)
  ) {
    return { messages: [msgInvalida()], session: resetaTentativas(session) };
  }

  if (session.step !== "escalado" && precisaEscalar(text)) {
    return {
      messages: [`Já chamo alguém pra te ajudar! Aguarda um instantinho 😊`],
      session: { ...session, step: "escalado", escalado: true, stepAnteriorEscalado: session.step },
      escalar: true,
    };
  }
  if (session.step !== "escalado" && session.step !== "name" && session.step !== "address" && session.step !== "observacao" && eConfusao(n)) {
    const dicas: Partial<Record<BotStep, string>> = {
      category: `Sem estresse! É só escolher o que vai querer:\n\n${mensagemCategorias()}`,
      size: `É só escolher o tamanho da pizza:\n\n${sizeListComMiniPizza()}`,
      flavor: `É só digitar o número ou o nome do sabor que você quer! 😋`,
      border_escolha: `É só escolher o número da borda ou digitar o nome. Se não quiser borda é só digitar o número ${MENU.borders.length + 1}!`,
      add_more: `Se quiser, pode me dizer se deseja bebida, outro lanche ou se já podemos fechar 😊`,
      delivery_type: `Como quer receber?\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`,
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
        return { messages: [`Tudo bem! Qual o tamanho da pizza então? 😊\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "size", currentFlavor: undefined }) };
      case "border_escolha":
      case "segundo_sabor":
        return { messages: [`Tudo bem! Qual o sabor então? 😊\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "flavor", currentFlavor: undefined }) };
      case "observacao":
        return { messages: [mensagemAddMore(session.cart)], session: resetaTentativas({ ...session, step: "add_more" }) };
      case "delivery_type":
        return { messages: [mensagemAddMore(session.cart)], session: resetaTentativas({ ...session, step: "add_more" }) };
      case "neighborhood":
        return { messages: [`Tudo bem! Como quer receber seu pedido? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`], session: resetaTentativas({ ...session, step: "delivery_type" }) };
      case "confirma_bairro_fuzzy":
        return { messages: [`Tudo bem! Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", bairroFuzzyCandidato: undefined, neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false }) };
      case "confirma_produto_valor":
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", candidatosValorProduto: undefined }) };
      case "confirma_sabor_ambiguo":
        return { messages: [`Tudo bem! Qual o sabor então? 😊\n\n${listaFlavors()}`], session: resetaTentativas({ ...session, step: "flavor", candidatosSaborAmbiguo: undefined }) };
      case "confirma_item_ambiguo":
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", candidatosItemAmbiguo: undefined, itemAmbiguoTipo: undefined }) };
      case "address":
        return { messages: [`Tudo bem! Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false }) };
      case "payment":
        if (session.deliveryType === "pickup" || session.deliveryType === "dine_in") {
          return { messages: [`Tudo bem! Como quer receber seu pedido? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`], session: resetaTentativas({ ...session, step: "delivery_type" }) };
        }
        return { messages: [`Tudo bem! Me passa o endereço completo:\n_(Rua, número e complemento)_\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "address" }) };
      case "pedindo_nome": {
        return { messages: [`Tudo bem! Qual a forma de pagamento? 💸`], session: resetaTentativas({ ...session, step: "payment", paymentMethod: undefined }) };
      }
      case "troco": {
        return { messages: [`Tudo bem! Qual a forma de pagamento? 💸`], session: resetaTentativas({ ...session, step: "payment", paymentMethod: undefined, troco: undefined }) };
      }
      case "confirm": {
        return { messages: [`Tudo bem! Qual a forma de pagamento? 💸`], session: resetaTentativas({ ...session, step: "payment", paymentMethod: undefined }) };
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
      case "product_family_choice": {
        const labelFam = session.familiaLabel ?? "produto";
        const itensFam = (session.candidatosFamilia ?? []) as typeof MENU.lanches;
        return { messages: [mensagemFamilia(labelFam, itensFam)], session: resetaTentativas({ ...session, step: "product_family_choice" }) };
      }
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
        messages: [mensagemSaudacaoPadrao(), mensagemCategorias()],
        session: { ...session, step: "category" },
      };
    }
    case "returning": {
      const historico = session.historico!;
      const firstName = historico.nome.split(" ")[0];
      // Consulta de preço tem prioridade sobre pedido direto
      const resConsultaRet = verificaConsultaFatias(text, session) ?? verificaConsultaPreco(text, session);
      if (resConsultaRet) return resConsultaRet;
      // Cliente apressado: pedido completo com entrega/pagamento
      const pedidoCompletoRet = processarPedidoCompleto(text, { ...session, customerName: historico.nome });
      if (pedidoCompletoRet) return pedidoCompletoRet;
      // Cliente apressado: já mandou o pedido (completo ou parcial) na saudação -> processa direto
      const pedidoDireto = montarPizzaDoPedido(text, { ...session, customerName: historico.nome }, `Pode deixar, *${firstName}*! 🍕`);
      if (pedidoDireto) return pedidoDireto;
      // FAMÍLIA DE PRODUTO (ex: "quero uma macarronada") — ANTES de detectaIntencaoDireta
      const familiaRet = detectarFamiliaProduto(text);
      if (familiaRet) return responderFamiliaProduto({ ...session, customerName: historico.nome }, familiaRet);
      const intencaoRet = detectaIntencaoDireta(text);
      if (intencaoRet) {
        if (intencaoRet.category === "pizza" && (n.includes("mini-pizza") || n.includes("mini pizza"))) {
          return {
            messages: [`Pode deixar, *${firstName}*! 😄\n\nMini-Pizza anotada! 🍕 Qual sabor?\n\n${MENU.miniPizzaFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`],
            session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: "MINI", customerName: historico.nome }),
          };
        }
        const resp = handleCategory(intencaoRet.category, { ...session, step: "category", customerName: historico.nome });
        return { ...resp, messages: [`Pode deixar, *${firstName}*! 😄\n\n${resp.messages[0]}`, ...resp.messages.slice(1)], session: resetaTentativas(resp.session) };
      }
      // Opção 2 / "ver cardápio" / "outra coisa" — detecta ANTES de ePositiva (evita que "quero ver o cardápio" vire repetir)
      const querCardapio = n === "2" || n.includes("cardapio") || n.includes("menu") ||
        n.includes("outra coisa") || n.includes("variar") || n.includes("novidade") ||
        n.includes("outro") || n.includes("ver o") || eNegativa(n);
      if (querCardapio) {
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", customerName: historico.nome }) };
      }
      // Opção 1 / "o de sempre" / repetir
      const querRepetir = n === "1" || n.includes("de sempre") || n.includes("repetir") ||
        n.includes("mesmo") || n.includes("igual") || ePositiva(n);
      if (querRepetir) {
        if (historico.ultimoCart && historico.ultimoCart.length > 0) {
          // Repetição preserva o snapshot comercial do pedido anterior. A taxa
          // de entrega continua sendo atualizada abaixo, mas produto já vendido
          // nunca é reprecificado silenciosamente.
          const cart = historico.ultimoCart.map(item => ({ ...item }));

          // Se temos histórico completo de entrega, pré-preenche e vai direto para confirmação
          if (historico.ultimoDeliveryType && historico.ultimoPayment) {
            const isDeliveryHist = historico.ultimoDeliveryType === "delivery";
            // Para entrega, usa a taxa ATUAL do bairro no menu (mais correta que a do histórico).
            const nbHist = isDeliveryHist ? MENU.neighborhoods.find(b => b.name === historico.ultimoNeighborhood) : undefined;
            const deliveryFee = isDeliveryHist ? (nbHist?.fee ?? historico.ultimoDeliveryFee ?? 0) : 0;
            const sessionRapida: BotSession = {
              ...session,
              step: "confirm",
              cart,
              customerName: historico.nome,
              deliveryType: historico.ultimoDeliveryType as BotSession["deliveryType"],
              neighborhood: historico.ultimoNeighborhood,
              address: historico.ultimoEndereco,
              deliveryFee,
              // Bairro vem mostrado no resumo p/ o cliente confirmar; só conta como confirmado
              // se for um bairro cadastrado (senão o guard final pede o bairro de novo).
              bairroConfirmado: isDeliveryHist && !!nbHist,
              paymentMethod: historico.ultimoPayment,
              retornoRapido: true,
            };
            return {
              messages: [
                `Boa, *${firstName}*! 😋 Preparei tudo igual da última vez:\n\n${buildReceipt(sessionRapida)}\n\nConfirmo assim?\n  ✅ *1.* Confirmar\n  ✏️ *2.* Mudar algo`,
              ],
              session: resetaTentativas(sessionRapida),
            };
          }

          // Sem histórico de entrega: restaura carrinho e pede tipo de entrega
          const updatedSession: BotSession = {
            ...session,
            step: "delivery_type",
            cart,
            customerName: historico.nome,
            deliveryFee: 0,
          };
          return {
            messages: [
              `Boa, *${firstName}*! 😋 Anotei o seu de sempre:`,
              `🛒 *Itens:*\n${resumoCarrinho(cart)}\n\nComo quer receber? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`
            ],
            session: resetaTentativas(updatedSession),
          };
        }
        return {
          messages: [`Que bom te ver de novo, *${firstName}*! 😊\n\n${mensagemCategorias()}`],
          session: resetaTentativas({ ...session, step: "category", customerName: historico.nome }),
        };
      }
      return {
        messages: [montarSaudacaoRetorno(historico)],
        session,
      };
    }
    case "name": {
      if (!text || text.length < 1) return respostaInvalida("Me fala seu nome pra eu te atender melhor!", session);

      // 1) Intenção de ver o cardápio -> responde o cardápio, NÃO assume como nome
      if (detectaIntencaoCardapio(text)) {
        return {
          messages: [`Claro! 😊 ${mensagemCategorias()}`],
          session: resetaTentativas({ ...session, step: "category" }), // customerName fica vazio por enquanto
        };
      }

      // 2) Consulta de preço ("quanto tá a pizza pequena?")
      const resConsultaName = verificaConsultaFatias(text, session) ?? verificaConsultaPreco(text, session);
      if (resConsultaName) return resConsultaName;

      // 3) Pedido completo inteligente (produto + entrega/pagamento numa mensagem)
      const pedidoCompletoName = processarPedidoCompleto(text, session);
      if (pedidoCompletoName) return pedidoCompletoName;

      // 4) Pedido direto/completo de pizza já na primeira mensagem
      const pedidoDireto = montarPizzaDoPedido(text, { ...session }, `Prazer em te atender! 😊`);
      if (pedidoDireto) return pedidoDireto;

      // 5) FAMÍLIA DE PRODUTO (ex: "quero uma macarronada") — PRECISA rodar ANTES de
      // detectaIntencaoDireta/handleCategory, senão a macarronada vira categoria "lanche"
      // genérica e abre a lista completa de lanches. Não salva como nome nem pede nome.
      const familiaName = detectarFamiliaProduto(text);
      if (familiaName) return responderFamiliaProduto(session, familiaName);

      // 6) Intenção de categoria (pizza/lanche/bebida/suco) sem ser um pedido completo
      const intencao = detectaIntencaoDireta(text);
      if (intencao) {
        const nName = normalizar(text);
        if (intencao.category === "pizza" && (nName.includes("mini-pizza") || nName.includes("mini pizza"))) {
          return {
            messages: [`Perfeito! 😄\n\nMini-Pizza anotada! 🍕 Qual sabor?\n\n${MENU.miniPizzaFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`],
            session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: "MINI" }),
          };
        }
        const response = handleCategory(intencao.category, { ...session, step: "category" });
        return { ...response, messages: [`Perfeito! 😄\n\n${response.messages[0]}`], session: resetaTentativas(response.session) };
      }

      // 4) Só agora valida se REALMENTE parece um nome humano (heurística forte)
      if (pareceNomeHumano(text)) {
        const firstName = text.split(" ")[0];
        return {
          messages: [`Prazer, *${firstName}*! 😊 ${mensagemCategorias()}`],
          session: resetaTentativas({ ...session, step: "category", customerName: text }),
        };
      }

      // 5) Não é nome, não é pedido reconhecido, não é cardápio -> pede de novo sem travar o cliente
      if (ehSaudacaoSimples(n)) {
        return { messages: [msgInvalida()], session: resetaTentativas(session) };
      }
      if (detectarContextoHumano(text) !== null) {
        return { messages: [msgInvalida()], session: resetaTentativas(session) };
      }
      return respostaInvalida("Não entendi muito bem 😅 Me diz seu nome, ou já pode pedir direto (ex: _\"pizza calabresa\"_ ou _\"cardápio\"_)", session);
    }
    case "category": {
      // ===== CONSULTA DE PREÇO (ex: "quanto tá a pizza pequena?", "valor do x-burguer") =====
      const resConsultaCat = verificaConsultaFatias(text, session) ?? verificaConsultaPreco(text, session);
      if (resConsultaCat) return resConsultaCat;
      // ===== PEDIDO COMPLETO INTELIGENTE (produto + entrega + pagamento numa única mensagem) =====
      const pedidoCompletoCat = processarPedidoCompleto(text, session);
      if (pedidoCompletoCat) return pedidoCompletoCat;
      // ===== QTD + PRODUTO DIRETO (ex: "quero 2 x burguer", "manda uma coca", "pode ser 1 x tudo") =====
      const qtdItemCat = parsearQtdEItem(text);
      if (qtdItemCat) {
        // Se há intenção clara de pizza (qty=1 + "pizza"/"famil"), tenta pizza antes de sucos/bebidas
        // (evita fuzzy-match: "baiana" → "banana" → Vitamina de Banana)
        if (qtdItemCat.qty === 1 && (n.includes("pizza") || n.includes("famil"))) {
          const pizzaCat = montarPizzaDoPedido(text, session);
          if (pizzaCat) return pizzaCat;
        }
        const resQtdCat = tentaAdicionarComQtd(qtdItemCat, session);
        if (resQtdCat) return resQtdCat;
      }
      // ===== BUSCA INTELIGENTE POR VALOR (ex: "quero um hamburguer de 18", "lanche de 20") =====
      const catValor = detectaCategoriaEValor(text);
      if (catValor && catValor.categoria !== "pizza") {
        const candidatos = buscaProdutosPorValor(catValor.categoria, catValor.valor);
        if (candidatos.length === 1) {
          const p = candidatos[0];
          return {
            messages: [`Você quis dizer o *${p.name}* por *${formatCurrency(p.price)}*? 😊`],
            session: resetaTentativas({ ...session, step: "confirma_produto_valor", candidatosValorProduto: [{ ...p, categoria: catValor.categoria }] }),
          };
        }
        if (candidatos.length > 1) {
          const top = candidatos.slice(0, 3);
          const listaTxt = top.map(p => `*${p.name}* (${formatCurrency(p.price)})`).join("\n");
          return {
            messages: [`Tenho esses nessa faixa de preço:\n\n${listaTxt}\n\nQual prefere? 😊`],
            session: resetaTentativas({ ...session, step: "confirma_produto_valor", candidatosValorProduto: top.map(p => ({ ...p, categoria: catValor.categoria })) }),
          };
        }
        // Nenhum produto próximo -> cai no fallback normal (mostra cardápio da categoria)
      }
      // ===== FAMÍLIA DE PRODUTO (ex: "macarronada") — ANTES da detecção genérica de categoria =====
      const familiaCat = detectarFamiliaProduto(text);
      if (familiaCat) return responderFamiliaProduto(session, familiaCat);
      const intencao = detectaIntencaoDireta(text);
      let category = "";
      if (n === "1" || n.includes("pizza")) category = "pizza";
      else if (n === "2" || n.includes("lanche")) category = "lanche";
      else if (n === "3" || n.includes("bebida")) category = "bebida";
      else if (n === "4" || n.includes("suco") || n.includes("vitamina")) category = "suco";
      else if (intencao) category = intencao.category;
      if (!category) {
        const lancheEspFallback = detectarLancheEspecifico(text, session);
        if (lancheEspFallback) return lancheEspFallback;
        if (ehSaudacaoSimples(n)) {
          return { messages: [msgInvalida()], session: resetaTentativas({ ...session, step: "category" }) };
        }
        if (detectarContextoHumano(text) !== null) {
          return { messages: [msgInvalida()], session: resetaTentativas({ ...session, step: "category" }) };
        }
        return respostaInvalida(mensagemCategorias(), session);
      }
      if (category === "pizza") {
        if (n.includes("mini-pizza") || n.includes("mini pizza")) {
          return {
            messages: [`Mini-Pizza anotada! 🍕 Qual sabor?\n\n${MENU.miniPizzaFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`],
            session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: "MINI" }),
          };
        }
        const pedidoPizza = montarPizzaDoPedido(text, session);
        if (pedidoPizza) return pedidoPizza;
      }
      if (category === "suco" && qtdItemCat && qtdItemCat.qty > 1) {
        return {
          messages: [`Perfeito, ${qtdItemCat.qty === 2 ? "são" : "serão"} *${qtdItemCat.qty} sucos*! 😋 Quais sabores?\n\n${listaSucos()}\n\n_(Com leite: acréscimo de R$ 1,00)_\n\nDigite os números ou nomes:`],
          session: resetaTentativas({ ...session, step: "suco_escolha", currentCategory: "suco", pendingQtdSuco: qtdItemCat.qty }),
        };
      }
      if (category === "lanche") {
        const lancheEsp = detectarLancheEspecifico(text, session);
        if (lancheEsp) return lancheEsp;
      }
      return { ...handleCategory(category, session), session: resetaTentativas(handleCategory(category, session).session) };
    }
    case "confirma_produto_valor": {
      const candidatos = session.candidatosValorProduto || [];
      if (candidatos.length === 0) return respostaInvalida(mensagemCategorias(), session);
      let escolhido: { name: string; price: number; categoria: string } | undefined;
      if (candidatos.length === 1 && (ePositiva(n) || n === "1")) {
        escolhido = candidatos[0];
      } else {
        // tenta achar por nome ou número entre os candidatos listados
        const num = parseInt(text);
        if (!isNaN(num) && num >= 1 && num <= candidatos.length) escolhido = candidatos[num - 1];
        else escolhido = candidatos.find(c => n.includes(normalizar(c.name)));
      }
      if (!escolhido) {
        if (eNegativa(n)) {
          return { messages: [`Sem problema! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", candidatosValorProduto: undefined }) };
        }
        const listaTxt = candidatos.map(p => `*${p.name}* (${formatCurrency(p.price)})`).join("\n");
        return respostaInvalida(`Qual desses você quer?\n\n${listaTxt}`, session);
      }
      const newItem: CartItem = { category: escolhido.categoria, name: escolhido.name, price: escolhido.price };
      const newCart = [...session.cart, newItem];
      return {
        messages: [`*${escolhido.name}* anotado! 😋`, mensagemAddMore(newCart)],
        session: resetaTentativas({ ...session, step: "add_more", cart: newCart, candidatosValorProduto: undefined }),
      };
    }
    case "consulta_fatias": {
      // Nova consulta de fatias ou follow-up de tamanho
      const resFatiasF = verificaConsultaFatias(text, session);
      if (resFatiasF) return resFatiasF;
      const followUp = resolveFatiasFollowUp(text, session);
      if (followUp) return followUp;
      // Cliente quer pedir o último tamanho consultado
      const lastSize = session.pendingConsultaFatias?.size;
      const querPedirF = ePositiva(n) || n === "1" || n.includes("sim") || n.includes("quero") || n.includes("pode anotar") || n.includes("anota") || n.includes("manda") || n.includes("quero essa");
      if (querPedirF && lastSize) {
        return { messages: [`Pizza *${lastSize}* anotada! 👌\n\nQual o sabor? 😋 Você pode escolher até *2 sabores*!\n\n${listaFlavors()}`], session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: lastSize, pendingConsultaFatias: undefined }) };
      }
      // Ver outro / cardápio
      if (n === "2" || n.includes("ver outro") || n.includes("cardapio") || n.includes("menu") || eNegativa(n)) {
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", pendingConsultaFatias: undefined }) };
      }
      // Consulta de preço dentro do contexto de fatias
      const resPrecoF = verificaConsultaPreco(text, session);
      if (resPrecoF) return resPrecoF;
      return respostaInvalida(`Quer saber de outro tamanho? Ou posso anotar uma pizza pra você? 😊`, session);
    }
    case "consulta_preco": {
      // Nova consulta de preço tem prioridade sobre contexto anterior
      const novaConsultaPreco = verificaConsultaPreco(text, session);
      if (novaConsultaPreco) return novaConsultaPreco;
      // Consulta implícita sem palavra de preço ("e a pizza m?", "e a familia?")
      // Remove "e ", "e a ", "e o " do início e tenta detectar o produto
      const textSemConector = text.replace(/^(e\s+(a|o|as|os)\s+|e\s+)/i, "").trim();
      const consultaImplicita = textSemConector !== text ? verificaConsultaPreco("quanto " + textSemConector, session) : null;
      if (consultaImplicita) return consultaImplicita;
      const c = session.pendingConsultaPreco;
      if (!c) return { messages: [mensagemCategorias()], session: resetaTentativas({ ...session, step: "category", pendingConsultaPreco: undefined }) };
      const quer = ePositiva(n) || n === "1" || n.includes("sim") || n.includes("pode anotar") || n.includes("quero") || n.includes("manda") || n.includes("anota");
      const verOutro = n === "2" || n.includes("ver outro") || n.includes("outro produto") || n.includes("cardapio") || n.includes("menu") || eNegativa(n);
      if (verOutro) {
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", pendingConsultaPreco: undefined }) };
      }
      if (c.categoria === "pizza_ambiguo") {
        // Verificar se cliente escolheu um tamanho na resposta
        const novaConsulta = detectaConsultaPreco(text);
        if (novaConsulta && novaConsulta.categoria !== "pizza_ambiguo") {
          return { messages: [mensagemConsultaPreco(novaConsulta)], session: resetaTentativas({ ...session, step: "consulta_preco", pendingConsultaPreco: novaConsulta }) };
        }
        // Detecta tamanho direto
        const numShiftCP: Record<string, string> = { "2": "1", "3": "2", "4": "3", "5": "4" };
        const sizeCP = detectaTamanho(numShiftCP[n] ?? n);
        if (n === "1" && !quer) {
          return { messages: [mensagemConsultaPreco({ label: "Mini-Pizza", categoria: "pizza_mini", preco: 17, qty: 1 })], session: resetaTentativas({ ...session, step: "consulta_preco", pendingConsultaPreco: { label: "Mini-Pizza", categoria: "pizza_mini", preco: 17, qty: 1 } }) };
        }
        if (sizeCP) {
          const preco = MENU.sizes.find(s => s.code === sizeCP)?.price ?? 0;
          const sizeLabel = MENU.sizes.find(s => s.code === sizeCP)?.label ?? sizeCP;
          const novaC = { label: `Pizza ${sizeLabel} (${sizeCP})`, categoria: "pizza_size" as const, size: sizeCP, preco, qty: 1 };
          return { messages: [mensagemConsultaPreco(novaC)], session: resetaTentativas({ ...session, step: "consulta_preco", pendingConsultaPreco: novaC }) };
        }
        return respostaInvalida(mensagemConsultaPreco(c), session);
      }
      if (!quer) return respostaInvalida(`  1. Sim, quero pedir\n  2. Ver outro produto`, session);
      // Iniciar pedido conforme categoria
      if (c.categoria === "pizza_mini") {
        return { messages: [`Mini-Pizza anotada! 🍕 Qual sabor?\n\n${MENU.miniPizzaFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`], session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: "MINI", pendingConsultaPreco: undefined }) };
      }
      if (c.categoria === "pizza_size") {
        return { messages: [`Pizza *${c.size}* anotada! 👌\n\nQual o sabor? 😋 Você pode escolher até *2 sabores*!\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: c.size, pendingConsultaPreco: undefined }) };
      }
      if (c.categoria === "lanche") {
        const lanche = MENU.lanches.find(l => l.name === c.produto);
        if (lanche) {
          if (lanche.hasFlavors) {
            const flavors = lanche.flavorsKey ? (MENU as Record<string, unknown>)[lanche.flavorsKey] as string[] : [];
            return { messages: [`*${lanche.name}* anotado! 🍕 Qual sabor?\n\n${flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`], session: resetaTentativas({ ...session, step: "lanche_flavor", currentCategory: "lanche", currentLanche: lanche.name, pendingConsultaPreco: undefined }) };
          }
          const qty = c.qty ?? 1;
          const novos: CartItem[] = Array.from({ length: qty }, () => ({ category: "lanche" as const, name: lanche.name, price: lanche.price }));
          const newCart = [...session.cart, ...novos];
          const label = qty > 1 ? `*${qty}x ${lanche.name}*` : `*${lanche.name}*`;
          return { messages: [`${label} anotado${qty > 1 ? "s" : ""}! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, pendingConsultaPreco: undefined }) };
        }
      }
      if (c.categoria === "bebida") {
        const bebida = MENU.bebidas.find(b => b.name === c.produto);
        if (bebida) {
          const qty = c.qty ?? 1;
          const novos: CartItem[] = Array.from({ length: qty }, () => ({ category: "bebida" as const, name: bebida.name, price: bebida.price }));
          const newCart = [...session.cart, ...novos];
          const label = qty > 1 ? `*${qty}x ${bebida.name}*` : `*${bebida.name}*`;
          return { messages: [`${label} anotado${qty > 1 ? "s" : ""}! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, pendingConsultaPreco: undefined }) };
        }
      }
      if (c.categoria === "suco") {
        const suco = MENU.sucos.find(s => s.name === c.produto);
        if (suco) {
          const qty = c.qty ?? 1;
          if (qty > 1) {
            return { messages: [`Perfeito, ${qty} *${suco.name}*! 😋`, mensagemAddMore([...session.cart, ...Array.from({ length: qty }, () => ({ category: "suco" as const, name: suco.name, price: suco.price }))])], session: resetaTentativas({ ...session, step: "add_more", cart: [...session.cart, ...Array.from({ length: qty }, () => ({ category: "suco" as const, name: suco.name, price: suco.price }))], pendingConsultaPreco: undefined }) };
          }
          const newCart = [...session.cart, { category: "suco" as const, name: suco.name, price: suco.price }];
          return { messages: [`*${suco.name}* anotado! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, pendingConsultaPreco: undefined }) };
        }
      }
      return { messages: [mensagemCategorias()], session: resetaTentativas({ ...session, step: "category", pendingConsultaPreco: undefined }) };
    }
    case "confirmando_mudanca": {
      if (ePositiva(n) || n.includes("manter") || n.includes("continua")) {
        const categoriaAtual = session.currentCategory ?? "pizza";
        return { ...handleCategory(categoriaAtual, { ...session, step: "category", pendingCategory: undefined }), session: resetaTentativas(handleCategory(categoriaAtual, { ...session, step: "category", pendingCategory: undefined }).session) };
      }
      if (eNegativa(n) || n.includes("troca") || n.includes("muda") || n === "2") {
        const pendingCategory = session.pendingCategory ?? "pizza";
        if (pendingCategory === "category") {
          return {
            messages: [`Tudo bem! O que mais vai querer? 😊\n\n${mensagemCategorias()}`],
            session: resetaTentativas({ ...session, step: "category", pendingCategory: undefined, currentCategory: undefined }),
          };
        }
        return { ...handleCategory(pendingCategory, { ...session, pendingCategory: undefined }), session: resetaTentativas(handleCategory(pendingCategory, { ...session, pendingCategory: undefined }).session) };
      }
      return respostaInvalida(`  1. Manter\n  2. Ir pro outro`, session);
    }
    case "size": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const resFatiasSize = verificaConsultaFatias(text, session);
      if (resFatiasSize) return resFatiasSize;
      const size = detectaTamanho(n);
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      if (size) {
        // Se o tamanho permite meio a meio, tenta DOIS sabores primeiro (evita capturar só o primeiro)
        if (permiteMeioAMeio(size)) {
          const dois = detectaDoisSabores(n, allFlavors, flavorsDisponiveis());
          if (dois) {
            const flavorFinal = `${dois[0]}/${dois[1]}`;
            const bordaJunta = detectaBordaDaMensagem(n);
            if (bordaJunta) {
              const newItem = criarItemPizza(size, flavorFinal, bordaJunta);
              if (!newItem) return respostaCombinacaoPizzaIndisponivel(size, session);
              const newCart = [...session.cart, newItem];
              return {
                messages: [
                  `Pizza *${size}* meio a meio *${dois[0]}* e *${dois[1]}* com borda de *${bordaJunta}*! 🤤`,
                  mensagemAddMore(newCart),
                ],
                session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined }),
              };
            }
            return {
              messages: [
                `Pizza *${size}* meio a meio *${dois[0]}* e *${dois[1]}*! Ótima pedida! 😋`,
                `Vai querer borda recheada? 😋`
              ],
              session: resetaTentativas({ ...session, step: "border_escolha", currentSize: size, currentFlavor: flavorFinal }),
            };
          }
        }
        const saborJunto = detectaSaborDaMensagem(n);
        if (saborJunto) {
          const bordaJunta = detectaBordaDaMensagem(n);
          if (bordaJunta) {
            const newItem = criarItemPizza(size, saborJunto, bordaJunta);
            if (!newItem) return respostaCombinacaoPizzaIndisponivel(size, session);
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
              `Vai querer borda recheada? 😋`
            ],
            session: resetaTentativas({ ...session, step: "border_escolha", currentSize: size, currentFlavor: saborJunto }),
          };
        }
        return {
          messages: [
            `Pizza *${size}* anotada! 👌`,
            `Agora me conta — qual o sabor? 😋 Você pode escolher até *2 sabores*!\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
          ],
          session: resetaTentativas({ ...session, step: "flavor", currentSize: size }),
        };
      }
      const saborSemTamanho = detectaSaborDaMensagem(n);
      if (saborSemTamanho) {
        return {
          messages: [
            `*${saborSemTamanho}*, ótima escolha! 😋`,
            `Qual o tamanho da pizza?\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`
          ],
          session: resetaTentativas({ ...session, step: "size", currentFlavor: saborSemTamanho }),
        };
      }
      return respostaInvalida(`${sizeListComMiniPizza()}`, session);
    }
    case "flavor": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      // Aviso se o cliente tentar mais de 2 sabores
      const trechosSabores = n.split(/\s+e\s+|\/|,|\s+mais\s+/).map(s => s.trim()).filter(Boolean);
      const saboresEncontrados = trechosSabores.map(t => resolveUmSabor(t, allFlavors)).filter(Boolean);
      if (saboresEncontrados.length > 2) {
        return respostaInvalida(`A pizza aceita até *2 sabores*! 😊\n\nEscolha 1 ou 2 sabores:\n\n${listaFlavors()}`, session);
      }
      if (permiteMeioAMeio(session.currentSize)) {
        const dois = detectaDoisSabores(n, allFlavors, flavorsDisponiveis());
        if (dois) {
          const flavorFinal = `${dois[0]}/${dois[1]}`;
          return {
            messages: [
              `Meio a meio *${dois[0]}* e *${dois[1]}*! Que combinação! 😋`,
              `Vai querer borda recheada? 😋`
            ],
            session: resetaTentativas({ ...session, step: "border_escolha", currentFlavor: flavorFinal }),
          };
        }
      }
      let flavor: string | undefined;
      const num = parseInt(text);
      const flavorsParaNumero = flavorsDisponiveis();
      if (!isNaN(num) && num >= 1 && num <= flavorsParaNumero.length) {
        flavor = flavorsParaNumero[num - 1];
      } else {
        flavor = resolveUmSabor(n, allFlavors) ?? undefined;
      }
      if (!flavor) {
        // Sem match direto -> tenta por palavra-chave. Se houver mais de uma opção, pergunta antes de assumir.
        const resultado = resolveSaborComAmbiguidade(n, allFlavors);
        if (resultado.tipo === "unico") {
          flavor = resultado.nome;
        } else if (resultado.tipo === "ambiguo") {
          const listaOpcoes = resultado.opcoes.map(o => `*${o}*`).join(" ou ");
          return {
            messages: [`Você quis dizer qual desses? 🤔\n\n${resultado.opcoes.map(o => `• ${o}`).join("\n")}\n\n(${listaOpcoes})`],
            session: resetaTentativas({ ...session, step: "confirma_sabor_ambiguo", candidatosSaborAmbiguo: resultado.opcoes }),
          };
        }
      }
      if (!flavor) {
        return respostaInvalida(listaFlavors(), session);
      }
      if (session.currentFlavor && !flavor) {
        flavor = session.currentFlavor;
      }
      if (isEsgotado(flavor)) return respostaEsgotado(flavor, allFlavors, session);
      if (session.currentSize === "MINI") {
        const newItem = criarItemPizza("MINI", flavor);
        if (!newItem) return respostaCombinacaoPizzaIndisponivel("MINI", session);
        const newCart = [...session.cart, newItem];
        return {
          messages: [`Mini-Pizza de *${flavor}* anotada! 🍕`, mensagemAddMore(newCart)],
          session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined }),
        };
      }
      return {
        messages: [
          `*${flavor}*! Excelente escolha! 🤤`,
          `Vai querer borda recheada? 😋`
        ],
        session: resetaTentativas({ ...session, step: "border_escolha", currentFlavor: flavor }),
      };
    }
    case "confirma_sabor_ambiguo": {
      const candidatos = session.candidatosSaborAmbiguo || [];
      if (candidatos.length === 0) return respostaInvalida(listaFlavors(), session);
      const num = parseInt(text);
      let escolhido: string | undefined;
      if (!isNaN(num) && num >= 1 && num <= candidatos.length) escolhido = candidatos[num - 1];
      else escolhido = candidatos.find(c => n.includes(normalizar(c)));
      if (!escolhido) {
        const listaOpcoes = candidatos.map(o => `• ${o}`).join("\n");
        return respostaInvalida(`Qual desses você quer?\n\n${listaOpcoes}`, session);
      }
      if (isEsgotado(escolhido)) {
        const allF = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
        return respostaEsgotado(escolhido, allF, { ...session, candidatosSaborAmbiguo: undefined });
      }
      if (session.currentSize === "MINI") {
        const newItem = criarItemPizza("MINI", escolhido);
        if (!newItem) return respostaCombinacaoPizzaIndisponivel("MINI", session);
        const newCart = [...session.cart, newItem];
        return {
          messages: [`Mini-Pizza de *${escolhido}* anotada! 🍕`, mensagemAddMore(newCart)],
          session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentSize: undefined, currentFlavor: undefined, candidatosSaborAmbiguo: undefined }),
        };
      }
      return {
        messages: [
          `*${escolhido}*! Excelente escolha! 🤤`,
          `Vai querer borda recheada? 😋`
        ],
        session: resetaTentativas({ ...session, step: "border_escolha", currentFlavor: escolhido, candidatosSaborAmbiguo: undefined }),
      };
    }
    case "segundo_sabor": {
      const allFlavors = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
      const naoQuerSegundo = n === "2" || eNegativa(n) || n.includes("so esse") || n.includes("apenas esse") || n.includes("so um");
      if (naoQuerSegundo) {
        return {
          messages: [`Combinado! Vai querer borda recheada? 😋`],
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
      const flavorsParaNumero = flavorsDisponiveis();
      if (!isNaN(num) && num >= 1 && num <= flavorsParaNumero.length) {
        flavor2 = flavorsParaNumero[num - 1];
      } else {
        flavor2 = resolveUmSabor(n, allFlavors) ?? undefined;
      }
      if (!flavor2) {
        return respostaInvalida(listaFlavors(), session);
      }
      if (flavor2 === session.currentFlavor) {
        return {
          messages: [`Esse é o mesmo sabor! Vou considerar só *${flavor2}* então 😄\n\nVai querer borda recheada? 😋`],
          session: resetaTentativas({ ...session, step: "border_escolha" }),
        };
      }
      const flavorFinal = `${session.currentFlavor}/${flavor2}`;
      return {
        messages: [
          `Meio a meio *${session.currentFlavor}* e *${flavor2}*! Que combinação! 😋`,
          `Vai querer borda recheada? 😋`
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
        const newItem = criarItemPizza(session.currentSize!, session.currentFlavor!);
        if (!newItem) return respostaCombinacaoPizzaIndisponivel(session.currentSize!, session);
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
      if (!isNaN(num) && num >= 1 && num <= MENU.borders.length) {
        const b = getBorderByIndex(num - 1, session.currentSize!);
        if (b) borderLabel = b.label;
      } else {
        const found = MENU.borders.find(b => n.includes(normalizar(b.label)));
        if (found) {
          borderLabel = found.label;
        }
      }
      if (!borderLabel) {
        // Resposta positiva sem especificar qual borda (ex: "sim", "quero", "pode ser") -> mostra a lista agora
        if (ePositiva(n) || n.includes("quero") || n.includes("com borda") || n.includes("pode ser") || n.includes("manda")) {
          return { messages: [`Show! Qual borda você prefere? 😋\n\n${listaBordas(session.currentSize!)}`], session };
        }
        return respostaInvalida(`Vai querer borda recheada? 😋\n\nResponda *sim* pra ver as opções, ou *não* pra seguir sem borda.`, session);
      }
      const newItem = criarItemPizza(session.currentSize!, session.currentFlavor!, borderLabel);
      if (!newItem) return respostaCombinacaoPizzaIndisponivel(session.currentSize!, session);
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
      // ===== CONSULTA DE PREÇO =====
      const resConsultaAM = verificaConsultaFatias(text, session) ?? verificaConsultaPreco(text, session);
      if (resConsultaAM) return resConsultaAM;
      // ===== PEDIDO COMPLETO INTELIGENTE =====
      const pedidoCompletoAM = processarPedidoCompleto(text, session);
      if (pedidoCompletoAM) return pedidoCompletoAM;
      // ===== FAMÍLIA DE PRODUTO (ex: "macarronada", "massa") — ANTES dos gates de categoria =====
      const familiaAM = detectarFamiliaProduto(text);
      if (familiaAM) return responderFamiliaProduto(session, familiaAM);
      // ===== CARDÁPIO / MENU / VER OPÇÕES =====
      if (detectaIntencaoCardapio(text)) {
        return {
          messages: [`Claro! O que mais vai querer? 😊\n\n${mensagemCategorias()}`],
          session: resetaTentativas(session),
        };
      }
      // Nome exato de bebida (ex: "refrigerante 2l") → adiciona antes de outros checks
      const bebidaPorNome = MENU.bebidas.find(b => normalizar(b.name) === n);
      if (bebidaPorNome) {
        if (isEsgotado(bebidaPorNome.name)) return respostaEsgotado(bebidaPorNome.name, MENU.bebidas.map(b => b.name), session);
        const newCartBeb = [...session.cart, { category: "bebida" as const, name: bebidaPorNome.name, price: bebidaPorNome.price }];
        return { messages: [`*${bebidaPorNome.name}* anotada! 😋`, mensagemAddMore(newCartBeb)], session: resetaTentativas({ ...session, step: "add_more", cart: newCartBeb }) };
      }
      // === UPSELL BEBIDA: quando não há bebida no carrinho, números 1-5 mapeiam para a oferta curta ===
      const temBebidaNoCarrinho = session.cart.some(i => i.category === "bebida" || i.category === "suco");
      if (!temBebidaNoCarrinho && /^\d$/.test(n)) {
        const numUpsell = parseInt(n);
        if (numUpsell >= 1 && numUpsell <= 3) {
          const bebidaUpsell = MENU.bebidas[numUpsell - 1];
          if (isEsgotado(bebidaUpsell.name)) return respostaEsgotado(bebidaUpsell.name, MENU.bebidas.map(b => b.name), session);
          const newCart = [...session.cart, { category: "bebida" as const, name: bebidaUpsell.name, price: bebidaUpsell.price }];
          return { messages: [`*${bebidaUpsell.name}* anotada! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
        }
        if (numUpsell === 4) {
          const resp = handleCategory("bebida", { ...session, step: "category" });
          return { ...resp, session: resetaTentativas(resp.session) };
        }
        if (numUpsell === 5) {
          if (session.deliveryType) {
            return continuarAposItemCompleto(session.cart, session, "Show! Vamos fechar então 🍕");
          }
          return {
            messages: [`Show! Vamos fechar então 🍕\n\nComo quer receber seu pedido? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`],
            session: resetaTentativas({ ...session, step: "delivery_type" }),
          };
        }
      }
      // Número puro 1-4 após mostrar menu de categorias (quando já há bebida no carrinho)
      if (/^\d$/.test(n)) {
        const numCat = parseInt(n);
        const catMap: Record<number, string> = { 1: "pizza", 2: "lanche", 3: "bebida", 4: "suco" };
        if (catMap[numCat]) {
          const cat = catMap[numCat];
          const resp = cat === "pizza"
            ? { messages: [`Qual o tamanho da próxima pizza? 🍕\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza" }) }
            : handleCategory(cat, { ...session, step: "category" });
          return { ...resp, session: resetaTentativas(resp.session) };
        }
      }
      // ===== QTD + PRODUTO DIRETO (ex: "3 coca", "2x burguer", "2 calabresa", "2 portuguesa") =====
      const qtdItemAM = parsearQtdEItem(text);
      if (qtdItemAM) {
        // Se há intenção clara de pizza (qty=1 + "pizza"/"famil"), tenta pizza antes de sucos/bebidas
        // (evita fuzzy-match: "baiana" → "banana" → Vitamina de Banana)
        if (qtdItemAM.qty === 1 && (n.includes("pizza") || n.includes("famil"))) {
          const pizzaAM = montarPizzaDoPedido(text, session);
          if (pizzaAM) return pizzaAM;
        }
        const resQtd = tentaAdicionarComQtd(qtdItemAM, session);
        if (resQtd) return resQtd;
        // Não é bebida/suco/lanche — verifica se é sabor de pizza com quantidade
        if (qtdItemAM.qty >= 2 && qtdItemAM.qty <= 5) {
          const allFlavorsAM = [...MENU.saltyFlavors, ...MENU.sweetFlavors];
          // Tenta detectar pedido completo (sabor + tamanho) no texto original
          const pedidoParc = detectaPedidoParcial(text);
          const saborPizzaAM = (pedidoParc?.flavor) || resolveUmSabor(qtdItemAM.produto, allFlavorsAM);
          if (saborPizzaAM) {
            const sizeAM = pedidoParc?.size || detectaTamanhoDaMensagem(normalizar(text));
            if (sizeAM) {
              return {
                messages: [`${qtdItemAM.qty} pizzas *${sizeAM}* de *${saborPizzaAM}*! 🍕 Com qual borda?\n\n${listaBordas(sizeAM)}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
                session: resetaTentativas({ ...session, step: "border_escolha", currentCategory: "pizza", currentFlavor: saborPizzaAM, currentSize: sizeAM, pendingPizzas: qtdItemAM.qty, pizzaAtualIndex: 1 }),
              };
            }
            return {
              messages: [`${qtdItemAM.qty} pizzas de *${saborPizzaAM}*! 🍕 Qual o tamanho?\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
              session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza", currentFlavor: saborPizzaAM, pendingPizzas: qtdItemAM.qty, pizzaAtualIndex: 1 }),
            };
          }
        }
        // Não resolveu — cai no fluxo normal abaixo
      }
      // ===== BUSCA INTELIGENTE POR VALOR (ex: "tem lanche de 20?") =====
      const catValorAM = detectaCategoriaEValor(text);
      if (catValorAM && catValorAM.categoria !== "pizza") {
        const candidatosAM = buscaProdutosPorValor(catValorAM.categoria, catValorAM.valor);
        if (candidatosAM.length === 1) {
          const p = candidatosAM[0];
          return {
            messages: [`Você quis dizer o *${p.name}* por *${formatCurrency(p.price)}*? 😊`],
            session: resetaTentativas({ ...session, step: "confirma_produto_valor", candidatosValorProduto: [{ ...p, categoria: catValorAM.categoria }] }),
          };
        }
        if (candidatosAM.length > 1) {
          const top = candidatosAM.slice(0, 3);
          const listaTxt = top.map(p => `*${p.name}* (${formatCurrency(p.price)})`).join("\n");
          return {
            messages: [`Tenho esses nessa faixa de preço:\n\n${listaTxt}\n\nQual prefere? 😊`],
            session: resetaTentativas({ ...session, step: "confirma_produto_valor", candidatosValorProduto: top.map(p => ({ ...p, categoria: catValorAM.categoria })) }),
          };
        }
      }
      const querFinalizar = eNegativa(n) || n.includes("finalizar") || n.includes("fechar") || n.includes("so isso") ||
        n.includes("e so") || n.includes("e isso") || n.includes("nao quero") || n.includes("ja esta bom") ||
        n.includes("ja ta bom") || n.includes("nao precisa mais") || n.includes("nada mais") || n.includes("por hoje") ||
        n.includes("isso mesmo");
      const querPizza = n.includes("mais pizza") || n.includes("outra pizza") || (n.includes("pizza") && !n.includes("lanche"));
      const querMiniPizza = n.includes("mini-pizza") || n.includes("mini pizza");
      const querLanche = n.includes("lanche") || n.includes("calzone") || n.includes("porcao") || n.includes("batata") ||
        n.includes("burguer") || n.includes("hamburguer") || n.includes("macarronada");
      const querSuco = detectaIntencaoSuco(text);
      const querBebida = !querSuco && (n.includes("bebida") || n.includes("refri") || n.includes("guarana") || n.includes("agua") || n.includes("cerveja") || n.includes("coca") || n.includes("pepsi"));

      // PRIORIDADE MÁXIMA: se quer finalizar e não mencionou pizza/lanche/bebida explicitamente, vai direto pro fechamento
      if (querFinalizar && !querPizza && !querLanche && !querBebida) {
        // Se já tem info de entrega/pagamento (preenchida por pedido completo), pula para o próximo step necessário
        if (session.deliveryType) {
          return continuarAposItemCompleto(session.cart, session, "Show! Vamos fechar então 🍕");
        }
        return {
          messages: [`Show! Vamos fechar então 🍕\n\nComo quer receber seu pedido? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`],
          session: resetaTentativas({ ...session, step: "delivery_type" }),
        };
      }
      // Mini-Pizza usa o mesmo fluxo de sabor de pizza, sem borda.
      if (querMiniPizza) {
        return {
          messages: [`Mini-Pizza anotada! 🍕 Qual sabor?\n\n${MENU.miniPizzaFlavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}`],
          session: resetaTentativas({ ...session, step: "flavor", currentCategory: "pizza", currentSize: "MINI" }),
        };
      }
      // Pizza só se pedida explicitamente (regra: não voltar a pizza por engano)
      if (querPizza) {
        return { messages: [`Qual o tamanho da próxima pizza? 🍕\n\n${sizeListComMiniPizza()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza" }) };
      }
      // Lanche (sem pizza) — tenta produto específico antes de abrir cardápio completo
      if (querLanche) {
        const lancheEsp = detectarLancheEspecifico(text, session);
        if (lancheEsp) return lancheEsp;
        const resp = handleCategory("lanche", { ...session, step: "category" });
        return { ...resp, session: resetaTentativas(resp.session) };
      }
      // Suco — prioridade sobre bebida genérica
      if (querSuco) {
        const resp = handleCategory("suco", { ...session, step: "category" });
        return { ...resp, session: resetaTentativas(resp.session) };
      }
      // Bebida
      if (querBebida) {
        const resp = handleCategory("bebida", { ...session, step: "category" });
        return { ...resp, session: resetaTentativas(resp.session) };
      }
      // Finalizar (caso tenha mencionado algo de produto mas ainda assim a intenção predominante é fechar)
      if (querFinalizar) {
        return {
          messages: [`Show! Vamos fechar então 🍕\n\nComo quer receber seu pedido? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`],
          session: resetaTentativas({ ...session, step: "delivery_type" }),
        };
      }
      const intencaoDireta = detectaIntencaoDireta(text);
      if (intencaoDireta) {
        const resp = handleCategory(intencaoDireta.category, { ...session, step: "category" });
        return { ...resp, session: resetaTentativas(resp.session) };
      }
      if (ehSaudacaoSimples(n)) {
        return { messages: [msgInvalida()], session: resetaTentativas({ ...session, step: "add_more" }) };
      }
      if (detectarContextoHumano(text) !== null) {
        return { messages: [msgInvalida()], session: resetaTentativas({ ...session, step: "add_more" }) };
      }
      return respostaInvalida(`Quer adicionar algo a mais? Como bebida, outro lanche, ou podemos fechar esse pedido? 😊`, session);
    }
    case "observacao": {
      const semObservacao = n === "0" || n === "nao" || n === "n" || n === "nenhuma" ||
        n === "nao tenho" || n === "sem observacao" || n === "nada" || n === "nenhum" ||
        n === "nao preciso" || n === "nao ha" || n.includes("sem obs") || n.includes("ta bom assim") ||
        n.includes("nao tem") || n.includes("pode seguir") || n.includes("pode continuar");
      if (semObservacao) {
        return {
          messages: [`Combinado! Como quer receber seu pedido? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`],
          session: resetaTentativas({ ...session, step: "delivery_type", observacao: undefined }),
        };
      }
      return {
        messages: [`Anotei: _"${text}"_ ✏️\n\nComo quer receber seu pedido? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`],
        session: resetaTentativas({ ...session, step: "delivery_type", observacao: text }),
      };
    }
    case "delivery_type": {
      // ===== CONSUMO NO LOCAL (dine-in) =====
      const isDineIn = n === "3"
        || n.includes("consumo")
        || n.includes("consumir")
        || n.includes("vou comer")
        || n.includes("comer ai")
        || n.includes("comer aqui")
        || n.includes("local")
        || n.includes("ai mesmo")
        || (n.includes("na loja") && !n.includes("retirar") && !n.includes("buscar") && !n.includes("pegar"));
      if (isDineIn) {
        return { messages: [`Combinado! 🍽️ Consumo no local!\n\nQual a forma de pagamento? 💸`], session: resetaTentativas({ ...session, step: "payment", deliveryType: "dine_in", deliveryFee: 0, neighborhood: undefined }) };
      }

      // ===== CAPTURA INTELIGENTE: tenta extrair tipo + bairro + pagamento de uma vez =====
      const dados = detectaDadosEntrega(text);
      const pagDetectado = dados.pagamento || undefined;

      // Caminho RETIRADA detectada (com ou sem pagamento junto)
      if (dados.tipo === "pickup") {
        const baseSession = { ...session, deliveryType: "pickup" as const, deliveryFee: 0, neighborhood: undefined };
        if (pagDetectado) {
          // tipo + pagamento numa mensagem -> aplica pagamento e vai pro fechamento
          return aplicaPagamento(pagDetectado, { ...baseSession });
        }
        return { messages: [`Perfeito, retirada no balcão ✅\n\nSem taxa de entrega.\n\nQual vai ser a forma de pagamento?\nPix, dinheiro ou cartão?`], session: resetaTentativas({ ...baseSession, step: "payment" }) };
      }

      // Caminho DELIVERY com BAIRRO VÁLIDO (match exato) detectado -> confirma e pede o endereço
      if (dados.tipo === "delivery" && dados.bairro) {
        return proximoAposBairro({ ...session, pagamentoPendente: pagDetectado }, dados.bairro);
      }

      // ===== FLUXO NORMAL (fallback): não detectou com confiança =====
      if (n === "1" || n.includes("entrega") || n.includes("delivery") || n.includes("entregar") || n.includes("minha casa")) {
        // Bairro não bateu exato, mas pode ser erro de digitação -> tenta fuzzy (sempre confirma antes de aplicar taxa)
        const candidatoFuzzy = detectaBairroFuzzy(n);
        if (candidatoFuzzy) {
          return { messages: [`Você quis dizer *${candidatoFuzzy.name}*? 😊`], session: resetaTentativas({ ...session, step: "confirma_bairro_fuzzy", deliveryType: "delivery", bairroFuzzyCandidato: candidatoFuzzy.name, pagamentoPendente: pagDetectado }) };
        }
        const hist = session.historico;
        if (hist?.ultimoEndereco && hist?.ultimoNeighborhood) {
          const nbFound = MENU.neighborhoods.find(nb => nb.name === hist.ultimoNeighborhood);
          const fee = nbFound?.fee || hist.ultimoDeliveryFee || 0;
          return {
            messages: [`Entregar no mesmo endereço de antes? 📍\n\n*${hist.ultimoEndereco} - ${hist.ultimoNeighborhood}*\n\n  1. Sim, mesmo endereço\n  2. Não, quero outro endereço`],
            session: resetaTentativas({ ...session, step: "confirm_address", deliveryType: "delivery", neighborhood: hist.ultimoNeighborhood, deliveryFee: fee, address: hist.ultimoEndereco, pagamentoPendente: pagDetectado }),
          };
        }
        return { messages: [`Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", deliveryType: "delivery", neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false, pagamentoPendente: pagDetectado }) };
      }
      if (n === "2" || n.includes("retirar") || n.includes("loja") || n.includes("buscar") || n.includes("pegar") || n.includes("retiro")) {
        return { messages: [`Perfeito, retirada no balcão ✅\n\nSem taxa de entrega.\n\nQual vai ser a forma de pagamento?\nPix, dinheiro ou cartão?`], session: resetaTentativas({ ...session, step: "payment", deliveryType: "pickup", deliveryFee: 0, neighborhood: undefined }) };
      }
      return respostaInvalida(`Como quer receber?\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`, session);
    }
    case "neighborhood": {
      const num = parseInt(text);
      let found: { name: string; fee: number } | undefined;
      if (!isNaN(num) && num >= 1 && num <= MENU.neighborhoods.length) found = MENU.neighborhoods[num - 1];
      else found = detectaBairro(n) ?? undefined;
      if (found) {
        return proximoAposBairro(session, found);
      }
      // Sem match exato → tenta prefixo (3 primeiras letras)
      const prefixCandidatos = detectaBairroPrefix(n);
      if (prefixCandidatos.length === 1) {
        const c = prefixCandidatos[0];
        return { messages: [`Você quis dizer *${c.name}*? 😊`], session: resetaTentativas({ ...session, step: "confirma_bairro_fuzzy", bairroFuzzyCandidato: c.name, candidatosBairro: undefined }) };
      }
      if (prefixCandidatos.length > 1) {
        const lista = prefixCandidatos.map((c, i) => `  ${i + 1}. ${c.name}`).join("\n");
        return { messages: [`Encontrei esses bairros parecidos:\n\n${lista}\n\nQual é o seu? 😊`], session: resetaTentativas({ ...session, step: "confirma_bairro_fuzzy", bairroFuzzyCandidato: undefined, candidatosBairro: prefixCandidatos }) };
      }
      // Fallback: fuzzy levenshtein (erro de digitação)
      const candidato = detectaBairroFuzzy(n);
      if (candidato) {
        return { messages: [`Você quis dizer *${candidato.name}*? 😊`], session: resetaTentativas({ ...session, step: "confirma_bairro_fuzzy", bairroFuzzyCandidato: candidato.name, candidatosBairro: undefined }) };
      }
      return respostaInvalida(`Hmm, não encontrei esse bairro. Pode digitar novamente? 😊`, session);
    }
    case "confirma_bairro_fuzzy": {
      // Lista de múltiplos candidatos (prefix match)
      const candidatos = session.candidatosBairro;
      if (candidatos && candidatos.length > 1) {
        const numEscolha = parseInt(text);
        if (!isNaN(numEscolha) && numEscolha >= 1 && numEscolha <= candidatos.length) {
          return proximoAposBairro(session, candidatos[numEscolha - 1]);
        }
        // Tenta match por nome dentro dos candidatos
        const porNome = candidatos.find(c => n.includes(normalizar(c.name).split(/\s+/)[0]));
        if (porNome) {
          return proximoAposBairro(session, porNome);
        }
        if (eNegativa(n)) {
          return { messages: [`Sem problema! Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", candidatosBairro: undefined, neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false }) };
        }
        const lista = candidatos.map((c, i) => `  ${i + 1}. ${c.name}`).join("\n");
        return respostaInvalida(`Qual desses é o seu bairro?\n\n${lista}`, session);
      }
      // Candidato único (confirmação sim/não)
      const nomeCandidato = session.bairroFuzzyCandidato;
      const nb = MENU.neighborhoods.find(b => b.name === nomeCandidato);
      if (ePositiva(n) || n === "1") {
        if (!nb) return respostaInvalida(`Qual o seu bairro? 😊`, session);
        return proximoAposBairro(session, nb);
      }
      return { messages: [`Sem problema! Qual o seu bairro então? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", bairroFuzzyCandidato: undefined, neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false }) };
    }
    case "confirm_address": {
      if (ePositiva(n) || n === "1") {
        // Cliente confirmou explicitamente o endereço+bairro mostrado → bairro confirmado
        const sessaoConfirmada = { ...session, bairroConfirmado: true };
        if (sessaoConfirmada.pagamentoPendente) {
          return aplicaPagamento(sessaoConfirmada.pagamentoPendente, sessaoConfirmada);
        }
        return { messages: [`Ótimo! 📍 *${sessaoConfirmada.address} - ${sessaoConfirmada.neighborhood}*\n\nQual a forma de pagamento? 💸`], session: resetaTentativas({ ...sessaoConfirmada, step: "payment" }) };
      }
      if (eNegativa(n) || n === "2") {
        return { messages: [`Tudo bem! Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", address: undefined, neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false }) };
      }
      return respostaInvalida(`  1. Sim, mesmo endereço\n  2. Não, quero outro endereço`, session);
    }
    case "address": {
      if (!text || text.length < 5) return respostaInvalida("Me passa o endereço completo.\nExemplo: *Rua das Flores, 123, Apto 2*", session);
      // GUARD: entrega NUNCA avança sem bairro confirmado e taxa válida.
      // Salva o endereço parcial e pergunta o bairro (sem inventar bairro/taxa).
      if (session.deliveryType === "delivery" && !bairroConfirmadoValido(session)) {
        return {
          messages: [`Endereço anotado! 📍\n\nQual o bairro da entrega? 😊`],
          session: resetaTentativas({ ...session, step: "neighborhood", address: text, neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false }),
        };
      }
      // Se o cliente já tinha informado o pagamento na captura inteligente, aplica agora e pula a pergunta
      if (session.pagamentoPendente) {
        return aplicaPagamento(session.pagamentoPendente, { ...session, address: text });
      }
      return { messages: [`Endereço anotado! 📍 Qual a forma de pagamento? 💸`], session: resetaTentativas({ ...session, step: "payment", address: text }) };
    }
// Detecta pagamento híbrido (dois métodos na mesma mensagem), com ou sem valores.
// Retorna null se for só um método (fluxo normal de aplicaPagamento cuida disso).
function detectaPagamentoHibrido(text: string): { metodos: string[]; valores: Record<string, number> } | null {
  const n = normalizar(text);
  const metodosEncontrados: string[] = [];
  if (/\bpix\b/.test(n)) metodosEncontrados.push("Pix");
  if (n.includes("dinheiro") || n.includes("especie") || n.includes("cash")) metodosEncontrados.push("Dinheiro");
  if (n.includes("cartao") || n.includes("credito") || n.includes("debito")) metodosEncontrados.push("Cartão");
  if (metodosEncontrados.length < 2) return null;

  // Tenta extrair valores associados: "50 no pix", "30 pix", "metade pix"
  const valores: Record<string, number> = {};
  const regexValor: Record<string, RegExp> = {
    Pix: /(\d+(?:[.,]\d+)?)\s*(?:reais?\s*)?(?:no\s+|de\s+|em\s+)?pix|pix\s*(?:de\s+|no\s+valor de\s+)?(\d+(?:[.,]\d+)?)/,
    Dinheiro: /(\d+(?:[.,]\d+)?)\s*(?:reais?\s*)?(?:no\s+|de\s+|em\s+)?dinheiro|dinheiro\s*(?:de\s+|no\s+valor de\s+)?(\d+(?:[.,]\d+)?)/,
    Cartão: /(\d+(?:[.,]\d+)?)\s*(?:reais?\s*)?(?:no\s+|de\s+|em\s+)?cart[aã]o|cart[aã]o\s*(?:de\s+|no\s+valor de\s+)?(\d+(?:[.,]\d+)?)/,
  };
  for (const metodo of metodosEncontrados) {
    const m = n.match(regexValor[metodo]);
    if (m) {
      const valorStr = (m[1] || m[2] || "").replace(",", ".");
      const valor = parseFloat(valorStr);
      if (!isNaN(valor)) valores[metodo] = valor;
    }
  }
  return { metodos: metodosEncontrados, valores };
}

    case "payment": {
      let payment = "";
      if (n === "1" || n.includes("pix") || n.includes("transfer")) payment = "Pix";
      else if (n === "2" || n.includes("dinheiro") || n.includes("especie") || n.includes("cash")) payment = "Dinheiro";
      else if (n === "3" || n.includes("cartao") || n.includes("credito") || n.includes("debito")) payment = "Cartão";

      // ===== PAGAMENTO HÍBRIDO (dois métodos na mesma mensagem) =====
      const hibrido = detectaPagamentoHibrido(text);
      if (hibrido) {
        const total = cartSubtotal(session.cart) + session.deliveryFee;
        const [m1, m2] = hibrido.metodos;
        const v1 = hibrido.valores[m1];
        const v2 = hibrido.valores[m2];
        // Os dois valores vieram explícitos -> valida se a soma bate com o total
        if (v1 !== undefined && v2 !== undefined) {
          const soma = Math.round((v1 + v2) * 100) / 100;
          const diferenca = Math.round((total - soma) * 100) / 100;
          if (diferenca > 0.01) {
            // Faltou valor -> pede o complemento, sem perder o que já foi informado
            return {
              messages: [`Quase lá! ${m1} (${formatCurrency(v1)}) + ${m2} (${formatCurrency(v2)}) somam ${formatCurrency(soma)}, mas o pedido é ${formatCurrency(total)}.\n\nFaltam *${formatCurrency(diferenca)}* — como deseja pagar o restante? (${m1} ou ${m2})`],
              session: resetaTentativas({ ...session, step: "payment_hibrido_complemento", hibridoMetodos: [m1, m2], hibridoValorParcial: { [m1]: v1, [m2]: v2 } as Record<string, number> }),
            };
          }
          if (diferenca < -0.01) {
            // Valor maior que o total -> avisa e confirma mesmo assim (provável troco/erro de digitação, não bloqueia)
            const paymentLabel = `${m1} (${formatCurrency(v1)}) + ${m2} (${formatCurrency(v2)})`;
            return aplicaPagamento(paymentLabel, session);
          }
          const paymentLabel = `${m1} (${formatCurrency(v1)}) + ${m2} (${formatCurrency(v2)})`;
          return aplicaPagamento(paymentLabel, session);
        }
        // "metade pix metade dinheiro" / "parte pix parte dinheiro" -> divide o total
        if (n.includes("metade") || (n.includes("parte") && !v1 && !v2)) {
          const meio = Math.round((total / 2) * 100) / 100;
          const paymentLabel = `${m1} (${formatCurrency(meio)}) + ${m2} (${formatCurrency(total - meio)})`;
          return aplicaPagamento(paymentLabel, session);
        }
        // Um valor veio, falta o outro -> calcula o complemento automaticamente
        if (v1 !== undefined && v2 === undefined) {
          const restante = Math.round((total - v1) * 100) / 100;
          const paymentLabel = `${m1} (${formatCurrency(v1)}) + ${m2} (${formatCurrency(restante)})`;
          return aplicaPagamento(paymentLabel, session);
        }
        if (v2 !== undefined && v1 === undefined) {
          const restante = Math.round((total - v2) * 100) / 100;
          const paymentLabel = `${m1} (${formatCurrency(restante)}) + ${m2} (${formatCurrency(v2)})`;
          return aplicaPagamento(paymentLabel, session);
        }
        // Nenhum valor informado -> pede o complemento
        return {
          messages: [`Combinado, ${m1} e ${m2}! 💸\n\nQuanto deseja pagar no *${m1}*? (o restante fica no ${m2})`],
          session: resetaTentativas({ ...session, step: "payment_hibrido_valor", hibridoMetodos: [m1, m2] }),
        };
      }

      if (!payment) return respostaInvalida(`Qual a forma de pagamento? 💸\n\n_(Pix, Dinheiro ou Cartão)_`, session);
      // Tenta capturar o nome se vier junto (ex: "Lucas, pix" / "pix, Lucas")
      let nomeJunto: string | undefined;
      if (!session.customerName) {
        const restante = text
          .replace(/\bpix\b/gi, "").replace(/\btransfer[êe]ncia\b/gi, "")
          .replace(/\bdinheiro\b/gi, "").replace(/\bespecie\b/gi, "").replace(/\bcash\b/gi, "")
          .replace(/\bcart[aã]o\b/gi, "").replace(/\bcr[eé]dito\b/gi, "").replace(/\bd[eé]bito\b/gi, "")
          .replace(/[,.\-–]/g, " ").replace(/\s+/g, " ").trim();
        if (restante && pareceNomeHumano(restante)) nomeJunto = restante;
      }
      return aplicaPagamento(payment, nomeJunto ? { ...session, customerName: nomeJunto } : session);
    }
    case "payment_hibrido_complemento": {
      const [m1, m2] = session.hibridoMetodos || [];
      const parcial = session.hibridoValorParcial || {};
      let metodoComplemento = "";
      if (n.includes("pix")) metodoComplemento = "Pix";
      else if (n.includes("dinheiro") || n.includes("especie") || n.includes("cash")) metodoComplemento = "Dinheiro";
      else if (n.includes("cartao") || n.includes("credito") || n.includes("debito")) metodoComplemento = "Cartão";
      if (!metodoComplemento) {
        return respostaInvalida(`Como prefere pagar o restante? Pode ser ${m1}, ${m2} ou outra forma.`, session);
      }
      const total = cartSubtotal(session.cart) + session.deliveryFee;
      const somaParcial = Object.values(parcial).reduce((s, v) => s + v, 0);
      const restante = Math.round((total - somaParcial) * 100) / 100;
      // Junta o valor do complemento ao mesmo método já existente, ou adiciona como terceira parte
      const partes = { ...parcial };
      partes[metodoComplemento] = Math.round(((partes[metodoComplemento] || 0) + restante) * 100) / 100;
      const paymentLabel = Object.entries(partes).filter(([, v]) => v > 0).map(([m, v]) => `${m} (${formatCurrency(v)})`).join(" + ");
      return aplicaPagamento(paymentLabel, { ...session, hibridoMetodos: undefined, hibridoValorParcial: undefined });
    }
    case "payment_hibrido_valor": {
      const total = cartSubtotal(session.cart) + session.deliveryFee;
      const valor = parseFloat(n.replace(",", ".").replace(/[^0-9.]/g, ""));
      const [m1, m2] = session.hibridoMetodos || [];
      if (isNaN(valor) || valor <= 0 || valor >= total || !m1 || !m2) {
        return respostaInvalida(`Me diz um valor entre 0 e ${formatCurrency(total)} pro *${m1}*. O restante fica no ${m2}.`, session);
      }
      const restante = Math.round((total - valor) * 100) / 100;
      const paymentLabel = `${m1} (${formatCurrency(valor)}) + ${m2} (${formatCurrency(restante)})`;
      return aplicaPagamento(paymentLabel, { ...session, hibridoMetodos: undefined });
    }
    case "pedindo_nome": {
      if (!pareceNomeHumano(text)) {
        return respostaInvalida("Só preciso do seu nome pra finalizar 😊 (ex: _Lucas_, _Maria Silva_)", session);
      }
      return continuaParaTrocoOuConfirm({ ...session, customerName: text });
    }
    case "troco": {
      const total = cartSubtotal(session.cart) + session.deliveryFee;
      // No híbrido, o troco é calculado só sobre a parte em dinheiro; no dinheiro puro, sobre o total.
      const baseTroco = valorDinheiroEsperado(session.paymentMethod, total) || total;
      let troco = "";
      const naoQuerTroco = n.includes("nao") || n.includes("sem troco") || n === "0" || n.includes("exato") || n.includes("nao precisa");
      if (naoQuerTroco) {
        troco = "Sem troco";
      } else {
        const valor = parseFloat(n.replace(",", ".").replace(/[^0-9.]/g, ""));
        if (isNaN(valor) || valor < baseTroco) {
          return respostaInvalida(`O total é *${formatCurrency(baseTroco)}*. Me diz um valor maior ou igual ao total, ou digita *não* se não precisar de troco.`, session);
        }
        const valorTroco = valor - baseTroco;
        troco = `Troco de ${formatCurrency(valorTroco)} para ${formatCurrency(valor)}`;
      }
      const updatedSession = { ...session, troco };
      // RETIRADA: após troco, finaliza direto sem tela de confirmação.
      if (updatedSession.deliveryType === "pickup") {
        const result = finalizarPedidoPickup(updatedSession);
        const trocoAck = troco === "Sem troco" ? "Fechou, sem troco então ✅" : `Anotado! 💵 _${troco}_ ✅`;
        return { messages: [`${trocoAck}\n\n${result.messages[0]}`], session: result.session };
      }
      const receipt = buildReceipt(updatedSession);
      return { messages: [`${troco === "Sem troco" ? "Fechou, sem troco então ✅" : `Anotado! 💵 _${troco}_ ✅`}\n\nConfere seu pedido 👇\n\n${receipt}\n\nTá certinho?\n  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`], session: resetaTentativas({ ...updatedSession, step: "confirm" }) };
    }
    case "confirm": {
      const confirma = ePositiva(n) || n.includes("confirmar") || n.includes("correto") ||
        n.includes("ta bom") || n.includes("fechou") || n.includes("pode");
      const retira = n === "2" || n.includes("retirar") || n.includes("cancela") || n.includes("errado") ||
        (eNegativa(n) && !n.includes("nao obrigado"));
      if (confirma) {
        // ESTOQUE — Fase 8: revalida disponibilidade no exato momento da
        // confirmação (ESGOTADOS já foi recarregado do Redis nesta mesma
        // requisição — ver setEsgotados em src/app/api/whatsapp/route.ts).
        // Sem isso, um item que esgota nos minutos entre "adicionar ao
        // carrinho" e "confirmar" seguia pra cozinha do mesmo jeito.
        const { disponiveis, removidos } = separarItensEsgotados(session.cart);
        if (removidos.length > 0) {
          const nomesRemovidos = removidos.map((item) => item.flavor ? `${item.name} (${item.flavor})` : item.name).join(", ");
          if (disponiveis.length === 0) {
            return {
              messages: [`Poxa, ${nomesRemovidos} esgotou agora e era o único item do seu pedido 😅\n\n${mensagemCategorias()}`],
              session: resetaTentativas({ ...session, cart: [], step: "category", currentCategory: undefined }),
            };
          }
          const sessionAtualizada = { ...session, cart: disponiveis };
          const receipt = buildReceipt(sessionAtualizada);
          return {
            messages: [`Poxa, ${nomesRemovidos} esgotou agora e precisei tirar do seu pedido 😅\n\nConfere de novo 👇\n\n${receipt}\n\nTá certinho?\n  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`],
            session: resetaTentativas({ ...sessionAtualizada, step: "confirm" }),
          };
        }
        // BLOQUEIO FINAL: entrega não pode ser confirmada sem bairro confirmado + taxa válida.
        if (session.deliveryType === "delivery" && !bairroConfirmadoValido(session)) {
          return {
            messages: [`Opa! Antes de confirmar, preciso do bairro pra calcular a entrega certinho 😊\n\nQual o bairro da entrega?`],
            session: resetaTentativas({ ...session, step: "neighborhood", neighborhood: undefined, deliveryFee: 0, bairroConfirmado: false, pagamentoPendente: session.paymentMethod ?? session.pagamentoPendente }),
          };
        }
        if (temPixNoPagamento(session.paymentMethod)) {
          return { messages: [`Ótimo! 😊 Para finalizar, envie o comprovante do Pix.\n\nChave Pix: (configurada pelo admin) 💸\n\nAssim que confirmarmos o pagamento, seu pedido vai direto pra cozinha! 🍕`], session: { ...session, step: "aguardando_pix" } };
        }
        const timeMsg = session.deliveryType === "delivery" ? CONFIG_BOT.tempoEntregaDelivery : CONFIG_BOT.tempoEntregaRetirada;
        const confirmMsg = session.deliveryType === "dine_in"
          ? `Pedido confirmado! 🎉 Já foi pra cozinha!\n\nObrigado, *${session.customerName?.split(" ")[0]}*! Seu pedido fica prontinho em *${timeMsg}* 🍽️\n\nQualquer dúvida é só chamar. Bom apetite! 🍕`
          : `Pedido confirmado! 🎉 Já foi pra cozinha!\n\nObrigado, *${session.customerName?.split(" ")[0]}*! Sua pizza chega em *${timeMsg}* 🛵\n\nQualquer dúvida é só chamar. Bom apetite! 🍕`;
        return { messages: [confirmMsg], session: { ...session, step: "done" } };
      }
      if (retira) {
        if (session.retornoRapido) {
          return { messages: [`Tudo bem! Como quer receber? 😊\n\n  1. Entrega 🛵\n  2. Retirada na loja 🏪\n  3. Consumo no local 🍽️`], session: resetaTentativas({ ...session, step: "delivery_type", retornoRapido: false }) };
        }
        return { messages: [`Tudo bem, pedido cancelado! Se mudar de ideia é só chamar. 😊`], session: { ...session, step: "done" } };
      }
      return respostaInvalida(`  ✅ *1.* Confirmar\n  ❌ *2.* Cancelar`, session);
    }
    case "lanche_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      // Qty + produto (ex: "2x burguer", "3 hamburguer artesanal")
      const qtdLanche = parsearQtdEItem(text);
      if (qtdLanche && qtdLanche.qty >= 2) {
        const resQtdLan = tentaAdicionarComQtd(qtdLanche, session);
        if (resQtdLan) return resQtdLan;
      }
      // parseInt só quando texto for puramente numérico — evita "2 calabresa" selecionar o 2º lanche
      const numPuro = /^\d+$/.test(text.trim());
      const num = numPuro ? parseInt(text) : NaN;
      // O número escolhido resolve contra a MESMA lista filtrada exibida por listaLanches()
      // (sem Mini-Pizza, sem esgotados) — nunca contra o array cru do cardápio.
      const lanchesParaNumero = lanchesDisponiveis();
      let lanche = MENU.lanches.find((l) => normalizar(l.name) === n);
      if (!lanche && !isNaN(num) && num >= 1 && num <= lanchesParaNumero.length) lanche = lanchesParaNumero[num - 1];
      if (!lanche) lanche = MENU.lanches.find((l) => n.includes(normalizar(l.name)));
      if (!lanche) {
        // Sem match direto -> tenta por palavra-chave. Se houver mais de um nome de lanche batendo, pergunta antes.
        const nomesLanches = MENU.lanches.map(l => l.name);
        const candidatosLanche = buscaPorPalavraChave(n, nomesLanches);
        if (candidatosLanche.length === 1) {
          lanche = MENU.lanches.find(l => l.name === candidatosLanche[0]);
        } else if (candidatosLanche.length > 1) {
          return {
            messages: [`Você quis dizer qual desses? 🤔\n\n${candidatosLanche.map(o => `• ${o}`).join("\n")}`],
            session: resetaTentativas({ ...session, step: "confirma_item_ambiguo", candidatosItemAmbiguo: candidatosLanche, itemAmbiguoTipo: "lanche" }),
          };
        }
      }
      if (!lanche) return respostaInvalida(listaLanches(), session);
      if (isEsgotado(lanche.name)) return respostaEsgotado(lanche.name, MENU.lanches.map(l => l.name), session);
      if (lanche.sizes && lanche.sizes.length > 0) {
        return { messages: [mensagemTamanhoProduto(lanche)], session: resetaTentativas({ ...session, step: "lanche_macarronada_size", currentLanche: lanche.name }) };
      }
      if (lanche.hasFlavors) {
        const flavors = saboresLanche(lanche);
        const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return { messages: [`*${lanche.name}* selecionado! 😋 Qual sabor?\n\n${lista}`], session: resetaTentativas({ ...session, step: "lanche_flavor", currentLanche: lanche.name }) };
      }
      const newItem: CartItem = { category: "lanche", name: lanche.name, price: lanche.price };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "lanche_flavor": {
      const lanche = MENU.lanches.find(l => l.name === session.currentLanche)!;
      const flavors = saboresLanche(lanche);
      const num = parseInt(text);
      let flavor: string | undefined;
      if (!isNaN(num) && num >= 1 && num <= flavors.length) flavor = flavors[num - 1];
      else flavor = flavors.find(f => normalizar(f) === n) || resolveUmSabor(n, flavors) || undefined;
      if (!flavor) {
        const resultado = resolveSaborComAmbiguidade(n, flavors);
        if (resultado.tipo === "unico") {
          flavor = resultado.nome;
        } else if (resultado.tipo === "ambiguo") {
          return {
            messages: [`Você quis dizer qual desses? 🤔\n\n${resultado.opcoes.map(o => `• ${o}`).join("\n")}`],
            session: resetaTentativas({ ...session, step: "confirma_item_ambiguo", candidatosItemAmbiguo: resultado.opcoes, itemAmbiguoTipo: "lanche_flavor" }),
          };
        }
      }
      if (!flavor) {
        const mudanca = tentaMudanca(text, session);
        if (mudanca) return mudanca;
        return respostaInvalida(flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n"), session);
      }
      const newItem: CartItem = { category: "lanche", name: lanche.name, flavor, price: precoLancheComSabor(lanche, flavor) };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "confirma_item_ambiguo": {
      const candidatos = session.candidatosItemAmbiguo || [];
      if (candidatos.length === 0) return respostaInvalida(mensagemCategorias(), session);
      const num = parseInt(text);
      let escolhido: string | undefined;
      if (!isNaN(num) && num >= 1 && num <= candidatos.length) escolhido = candidatos[num - 1];
      else escolhido = candidatos.find(c => n.includes(normalizar(c)));
      if (!escolhido) {
        const listaOpcoes = candidatos.map(o => `• ${o}`).join("\n");
        return respostaInvalida(`Qual desses você quer?\n\n${listaOpcoes}`, session);
      }
      if (session.itemAmbiguoTipo === "lanche") {
        const lanche = MENU.lanches.find(l => l.name === escolhido);
        if (!lanche) return respostaInvalida(listaLanches(), session);
        if (lanche.sizes && lanche.sizes.length > 0) {
          return { messages: [mensagemTamanhoProduto(lanche)], session: resetaTentativas({ ...session, step: "lanche_macarronada_size", currentLanche: lanche.name, candidatosItemAmbiguo: undefined }) };
        }
        if (lanche.hasFlavors) {
          const flavors = saboresLanche(lanche);
          const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
          return { messages: [`*${lanche.name}* selecionado! 😋 Qual sabor?\n\n${lista}`], session: resetaTentativas({ ...session, step: "lanche_flavor", currentLanche: lanche.name, candidatosItemAmbiguo: undefined }) };
        }
        const newItem: CartItem = { category: "lanche", name: lanche.name, price: lanche.price };
        const newCart = [...session.cart, newItem];
        return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined, candidatosItemAmbiguo: undefined }) };
      }
      if (session.itemAmbiguoTipo === "lanche_flavor") {
        const lanche = MENU.lanches.find(l => l.name === session.currentLanche);
        if (!lanche) return respostaInvalida(listaLanches(), session);
        const newItem: CartItem = { category: "lanche", name: lanche.name, flavor: escolhido, price: lanche.price };
        const newCart = [...session.cart, newItem];
        return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined, candidatosItemAmbiguo: undefined }) };
      }
      if (session.itemAmbiguoTipo === "bebida") {
        const bebida = MENU.bebidas.find(b => b.name === escolhido);
        if (!bebida) return respostaInvalida(listaBebidas(), session);
        const newItem: CartItem = { category: "bebida", name: bebida.name, price: bebida.price };
        const newCart = [...session.cart, newItem];
        return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, candidatosItemAmbiguo: undefined }) };
      }
      return respostaInvalida(mensagemCategorias(), session);
    }
    case "product_family_choice": {
      const candidatosFam = (session.candidatosFamilia ?? []) as typeof MENU.lanches;
      const labelFam = session.familiaLabel ?? "produto";
      if (candidatosFam.length === 0) return respostaInvalida(mensagemCategorias(), { ...session, step: "category" });

      // Tenta detectar tamanho por nome/letra (não por número, pois número = índice de produto)
      const tamFam = (() => {
        if (n.includes("pequen") || n === "p") return "P";
        if (n.includes("medi") || n === "m") return "M";
        if (n.includes("grand") || n === "g") return "G";
        if (n.includes("famil") || n === "f") return "F";
        return null;
      })();
      // Tenta detectar número (escolha do item)
      const numPuroFam = /^\d+$/.test(text.trim());
      const numFam = numPuroFam ? parseInt(text) : NaN;

      let escolhidoFam: typeof MENU.lanches[0] | undefined;
      if (!isNaN(numFam) && numFam >= 1 && numFam <= candidatosFam.length) {
        escolhidoFam = candidatosFam[numFam - 1];
      } else if (!tamFam) {
        // Casa por sabor/nome em qualquer direção: "carne" → "Macarronada de Carne",
        // "macarronada de frango" → "Macarronada de Frango". Se ficar ambíguo
        // (ex: só "macarronada"), reexibe a lista para o cliente escolher.
        const matches = candidatosFam.filter(c => {
          const cn = normalizar(c.name);
          return cn === n || cn.includes(n) || n.includes(cn);
        });
        if (matches.length === 1) escolhidoFam = matches[0];
      }

      // Tamanho digitado sem número: se só um produto na família, seleciona ele
      if (!escolhidoFam && tamFam && candidatosFam.length === 1) {
        escolhidoFam = candidatosFam[0];
      }

      if (!escolhidoFam) {
        const mudancaFam = tentaMudanca(text, session);
        if (mudancaFam) return mudancaFam;
        return respostaInvalida(mensagemFamilia(labelFam, candidatosFam), session);
      }

      if (isEsgotado(escolhidoFam.name)) {
        return respostaEsgotado(escolhidoFam.name, candidatosFam.map(c => c.name), session);
      }

      // Produto com tamanhos variáveis (ex: Macarronada)
      if (escolhidoFam.sizes && escolhidoFam.sizes.length > 0) {
        if (tamFam) {
          const sizeItem = escolhidoFam.sizes.find((s: { code: string; price: number }) => s.code === tamFam);
          if (sizeItem) {
            const newItem: CartItem = { category: "lanche", name: escolhidoFam.name, size: tamFam, price: sizeItem.price };
            const newCart = [...session.cart, newItem];
            return {
              messages: [mensagemAddMore(newCart)],
              session: resetaTentativas({ ...session, step: "add_more", cart: newCart, candidatosFamilia: undefined, familiaLabel: undefined }),
            };
          }
        }
        return {
          messages: [mensagemTamanhoProduto(escolhidoFam)],
          session: resetaTentativas({ ...session, step: "lanche_macarronada_size", currentCategory: "lanche", currentLanche: escolhidoFam.name, candidatosFamilia: undefined, familiaLabel: undefined }),
        };
      }
      // Produto com sabores
      if (escolhidoFam.hasFlavors) {
        const flavors = saboresLanche(escolhidoFam);
        const lista = flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n");
        return {
          messages: [`*${escolhidoFam.name}* selecionado! 😋 Qual sabor?\n\n${lista}`],
          session: resetaTentativas({ ...session, step: "lanche_flavor", currentCategory: "lanche", currentLanche: escolhidoFam.name, candidatosFamilia: undefined, familiaLabel: undefined }),
        };
      }
      // Lanche simples
      const newItem: CartItem = { category: "lanche", name: escolhidoFam.name, price: escolhidoFam.price };
      const newCart = [...session.cart, newItem];
      return {
        messages: [mensagemAddMore(newCart)],
        session: resetaTentativas({ ...session, step: "add_more", cart: newCart, candidatosFamilia: undefined, familiaLabel: undefined }),
      };
    }
    case "lanche_macarronada_size": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      // Usa o produto selecionado (Macarronada de Carne, de Frango, ...) e os preços
      // dos tamanhos do próprio item do cardápio — nada hardcoded.
      const lancheTam = MENU.lanches.find(l => l.name === session.currentLanche);
      const sizes = lancheTam?.sizes ?? [];
      const numero = /^\d+$/.test(n) ? Number(n) : NaN;
      const sizeItem = !Number.isNaN(numero) && numero >= 1 && numero <= sizes.length
        ? sizes[numero - 1]
        : sizes.find((entry) => normalizar(entry.code) === n);
      if (!sizeItem) {
        return respostaInvalida(mensagemTamanhoProduto(lancheTam ?? MENU.lanches.find(l => l.name === "Macarronada de Carne")!), session);
      }
      const size = sizeItem.code;
      const newItem: CartItem = { category: "lanche", name: lancheTam!.name, size, price: sizeItem.price };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, currentLanche: undefined }) };
    }
    case "bebida_escolha": {
      // Se o cliente pedir suco enquanto está na lista de bebidas, redireciona
      if (detectaIntencaoSuco(text)) {
        const resp = handleCategory("suco", { ...session, step: "category" });
        return { ...resp, session: resetaTentativas(resp.session) };
      }
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      // Qty + produto (ex: "3 coca", "2x guarana")
      const qtdBebida = parsearQtdEItem(text);
      if (qtdBebida && qtdBebida.qty >= 2) {
        const resQtdBeb = tentaAdicionarComQtd(qtdBebida, session);
        if (resQtdBeb) return resQtdBeb;
      }
      // O número (simples ou par "1 e 3") resolve contra a MESMA lista filtrada exibida
      // por listaBebidas() (sem esgotados) — nunca contra o array cru do cardápio.
      const bebidasParaNumero = bebidasDisponiveis();
      const nums = n.match(/\d+/g);
      if (nums && nums.length >= 2) {
        const i1 = parseInt(nums[0]) - 1;
        const i2 = parseInt(nums[1]) - 1;
        if (i1 >= 0 && i1 < bebidasParaNumero.length && i2 >= 0 && i2 < bebidasParaNumero.length) {
          const b1 = bebidasParaNumero[i1];
          const b2 = bebidasParaNumero[i2];
          const novosItens: CartItem[] = [
            { category: "bebida", name: b1.name, price: b1.price },
            { category: "bebida", name: b2.name, price: b2.price },
          ];
          const newCart = [...session.cart, ...novosItens];
          return { messages: [`*${b1.name}* e *${b2.name}* anotadas! 😋`, mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
        }
      }
      const numPuroBeb = /^\d+$/.test(text.trim());
      const num = numPuroBeb ? parseInt(text) : NaN;
      let bebida = MENU.bebidas.find(b => normalizar(b.name).includes(n));
      if (!bebida && !isNaN(num) && num >= 1 && num <= bebidasParaNumero.length) bebida = bebidasParaNumero[num - 1];
      if (!bebida) {
        // Sem match direto -> tenta por palavra-chave (ex: "guarana" bate em várias). Pergunta se houver mais de uma.
        const nomesBebidas = MENU.bebidas.map(b => b.name);
        const candidatosBebida = buscaPorPalavraChave(n, nomesBebidas);
        if (candidatosBebida.length === 1) {
          bebida = MENU.bebidas.find(b => b.name === candidatosBebida[0]);
        } else if (candidatosBebida.length > 1) {
          return {
            messages: [`Você quis dizer qual desses? 🤔\n\n${candidatosBebida.map(o => `• ${o}`).join("\n")}`],
            session: resetaTentativas({ ...session, step: "confirma_item_ambiguo", candidatosItemAmbiguo: candidatosBebida, itemAmbiguoTipo: "bebida" }),
          };
        }
      }
      if (!bebida) return respostaInvalida(listaBebidas(), session);
      if (isEsgotado(bebida.name)) return respostaEsgotado(bebida.name, MENU.bebidas.map(b => b.name), session);
      const newItem: CartItem = { category: "bebida", name: bebida.name, price: bebida.price };
      const newCart = [...session.cart, newItem];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart }) };
    }
    case "suco_escolha": {
      const mudanca = tentaMudanca(text, session);
      if (mudanca) return mudanca;
      // Multi-suco: "um de maracuja e 1 de bacuri", "maracuja e bacuri"
      const multiSuco = parsearMultiSuco(text);
      if (multiSuco) {
        const totalMulti = multiSuco.length;
        const pendingQtd = session.pendingQtdSuco;
        const nomesSucoMap = new Map<string, number>();
        for (const i of multiSuco) nomesSucoMap.set(i.name, (nomesSucoMap.get(i.name) || 0) + 1);
        const labels = [...nomesSucoMap.entries()].map(([nome, q]) => q > 1 ? `*${q}x ${nome}*` : `*${nome}*`).join(" e ");
        if (pendingQtd && totalMulti < pendingQtd) {
          const faltam = pendingQtd - totalMulti;
          const accumulated = [...(session.pendingSucosLeite ?? []), ...multiSuco];
          return {
            messages: [`${labels} anotados! 😋 Falta${faltam === 1 ? "" : "m"} *${faltam} ${faltam === 1 ? "suco" : "sucos"}*. Qual ${faltam === 1 ? "seria" : "seriam"}?\n\n${listaSucos()}`],
            session: resetaTentativas({ ...session, pendingSucosLeite: accumulated, pendingQtdSuco: faltam }),
          };
        }
        const accumulated = [...(session.pendingSucosLeite ?? []), ...multiSuco];
        return finalizarSucos(accumulated, text, session, labels);
      }
      // Qty + produto (ex: "2 laranja", "3x acai")
      const qtdSuco = parsearQtdEItem(text);
      if (qtdSuco && qtdSuco.qty >= 2) {
        const resSucoNome = resolveSaborComAmbiguidade(qtdSuco.produto, MENU.sucos.map(s => s.name));
        if (resSucoNome.tipo === "unico") {
          const sucoData = MENU.sucos.find(s => s.name === resSucoNome.nome);
          if (sucoData && !isEsgotado(sucoData.name)) {
            const novos: CartItem[] = Array.from({ length: qtdSuco.qty }, () => ({ category: "suco" as const, name: sucoData.name, price: sucoData.price }));
            const accumulated = [...(session.pendingSucosLeite ?? []), ...novos];
            return finalizarSucos(accumulated, text, session, `*${qtdSuco.qty}x ${sucoData.name}*`);
          }
        }
        const resQtdSuc = tentaAdicionarComQtd(qtdSuco, session);
        if (resQtdSuc) return { ...resQtdSuc, session: { ...resQtdSuc.session, pendingQtdSuco: undefined } };
      }
      // O número (simples ou par "1 e 3") resolve contra a MESMA lista filtrada exibida
      // por listaSucos() (sem esgotados) — nunca contra o array cru do cardápio.
      const sucosParaNumero = sucosDisponiveis();
      const nums = n.match(/\d+/g);
      if (nums && nums.length >= 2) {
        const i1 = parseInt(nums[0]) - 1;
        const i2 = parseInt(nums[1]) - 1;
        if (i1 >= 0 && i1 < sucosParaNumero.length && i2 >= 0 && i2 < sucosParaNumero.length) {
          const s1 = sucosParaNumero[i1];
          const s2 = sucosParaNumero[i2];
          const novosItens: CartItem[] = [
            { category: "suco", name: s1.name, price: s1.price },
            { category: "suco", name: s2.name, price: s2.price },
          ];
          const pendQtd2 = session.pendingQtdSuco;
          if (pendQtd2 && pendQtd2 > 2) {
            const faltam2 = pendQtd2 - 2;
            const accumulated2 = [...(session.pendingSucosLeite ?? []), ...novosItens];
            return { messages: [`*${s1.name}* e *${s2.name}* anotados! 😋 Faltam *${faltam2} sucos*. Quais seriam?\n\n${listaSucos()}`], session: resetaTentativas({ ...session, pendingSucosLeite: accumulated2, pendingQtdSuco: faltam2 }) };
          }
          const accumulated2 = [...(session.pendingSucosLeite ?? []), ...novosItens];
          return finalizarSucos(accumulated2, text, session, `*${s1.name}* e *${s2.name}*`);
        }
      }
      const numPuroSuc = /^\d+$/.test(text.trim());
      const num = numPuroSuc ? parseInt(text) : NaN;
      let suco = MENU.sucos.find(s => normalizar(s.name).includes(n));
      if (!suco && !isNaN(num) && num >= 1 && num <= sucosParaNumero.length) suco = sucosParaNumero[num - 1];
      if (!suco) return respostaInvalida(`${listaSucos()}`, session);
      if (isEsgotado(suco.name)) return respostaEsgotado(suco.name, MENU.sucos.map(s => s.name), session);
      const newItem: CartItem = { category: "suco", name: suco.name, price: suco.price };
      const pendQtd1 = session.pendingQtdSuco;
      if (pendQtd1 && pendQtd1 > 1) {
        const faltam1 = pendQtd1 - 1;
        const accumulated1 = [...(session.pendingSucosLeite ?? []), newItem];
        return {
          messages: [`*${suco.name}* anotado! 😋 Falt${faltam1 === 1 ? "a" : "am"} *${faltam1} ${faltam1 === 1 ? "suco" : "sucos"}*. Qual ${faltam1 === 1 ? "seria" : "seriam"}?\n\n${listaSucos()}`],
          session: resetaTentativas({ ...session, pendingSucosLeite: accumulated1, pendingQtdSuco: faltam1 }),
        };
      }
      const accumulated1 = [...(session.pendingSucosLeite ?? []), newItem];
      return finalizarSucos(accumulated1, text, session, `*${suco.name}*`);
    }
    case "suco_leite": {
      const pending = session.pendingSucosLeite ?? [];
      let leite: "com" | "sem" | null = null;
      if (n === "1" || n === "com leite" || n === "leite" || n.includes("com leite")) leite = "com";
      else if (n === "2" || n === "sem leite" || n === "sem" || n.includes("sem leite")) leite = "sem";
      if (!leite) return respostaInvalida(`Quer os sucos com leite ou sem leite? 🥤\n\n  1. Com leite\n  2. Sem leite`, session);
      const itensComLeite = aplicarLeite(pending, leite);
      const newCart = [...session.cart, ...itensComLeite];
      return { messages: [mensagemAddMore(newCart)], session: resetaTentativas({ ...session, step: "add_more", cart: newCart, pendingSucosLeite: undefined }) };
    }
    case "done": {
      return { messages: [comLinkCardapio(`_Oi! Sua sessão expirou por inatividade. Vamos começar de novo? 😊_\n\n${mensagemCategorias()}`)], session: resetaTentativas({ step: "category", cart: [], deliveryFee: 0, customerName: session.customerName }) };
    }
    default:
      return { messages: ["Eita, me perdi aqui! Vamos começar de novo?"], session: { step: "welcome", cart: [], deliveryFee: 0 } };
  }
}
export function createInitialSession(): BotSession {
  return { step: "welcome", cart: [], deliveryFee: 0, tentativasInvalidas: 0 };
}
export function montarSaudacaoRetorno(h: ClienteHistorico): string {
  const nome = h.nome.split(" ")[0];
  const total = h.totalPedidos || 1;
  const dias = h.ultimaVisita ? Math.floor((Date.now() - h.ultimaVisita) / (1000 * 60 * 60 * 24)) : 0;
  const qtdItens = h.ultimoPedido.length;
  // Resume o pedido anterior: 1 item cita ele; vários, cita o 1º + "e mais N"
  const favorito = qtdItens === 0 ? "uma pizza"
    : qtdItens === 1 ? h.ultimoPedido[0]
    : `${h.ultimoPedido[0]} e mais ${qtdItens - 1} ${qtdItens - 1 === 1 ? "item" : "itens"}`;
  const escolhe = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
  const rodape = "\n\n  1. Pedir o de sempre\n  2. Ver o cardápio";

  let texto: string;
  if (dias > 20) {
    texto = escolhe([
      `Oi *${nome}*! Quanto tempo, hein? 😄 Que saudade! Bora repetir aquele pedido (*${favorito}*)?`,
      `Eita, *${nome}* apareceu! 🍕 Tava com saudade. Vai querer o de sempre (*${favorito}*)?`,
    ]);
  } else if (total >= 5) {
    texto = escolhe([
      `Opa, *${nome}*! Que bom te ver de novo 🍕 Vai no seu clássico (*${favorito}*) ou hoje é dia de inventar?`,
      `E aí *${nome}*! 😄 Já sei, já sei... o de sempre (*${favorito}*)? Ou hoje muda o jogo?`,
      `Salve *${nome}*! Sempre um prazer 🍕 Manda o de sempre (*${favorito}*) ou vamos de novidade hoje?`,
    ]);
  } else if (total >= 2) {
    texto = escolhe([
      `Oi *${nome}*, que bom te ver de novo! 😊 Bora repetir (*${favorito}*) ou quer ver o cardápio?`,
      `Opa *${nome}*! 🍕 Da última vez você pediu *${favorito}*. Vai nele de novo ou quer variar?`,
    ]);
  } else {
    texto = `Oi *${nome}*! Que bom te ver por aqui 😊 Vai querer o de sempre (*${favorito}*) de novo ou prefere ver o cardápio?`;
  }
  return comLinkCardapio(texto + rodape);
}
export function createReturningSession(historico: ClienteHistorico): BotSession {
  return { step: "returning", cart: [], deliveryFee: 0, historico, tentativasInvalidas: 0 };
}
export function getWelcomeMessages(): string[] {
  return [`Olá! Seja bem-vindo à *Chefe da Pizza*! 🍕\n\nO que vai ser hoje? Temos coisa boa te esperando!`];
}
