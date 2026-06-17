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
  return `🛒 *Seu pedido:*\n${resumoCarrinho(cart)}\n  Subtotal: *${formatCurrency(subtotal)}*\n\nQuer adicionar algo a mais? Como bebida, outro lanche, ou podemos fechar esse pedido? 😊`;
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
  ritmoRapido?: boolean;
  pagamentoPendente?: string;
  enderecoAConfirmar?: string;
  hibridoMetodos?: string[];
  bairroFuzzyCandidato?: string;
  hibridoValorParcial?: Record<string, number>;
  candidatosValorProduto?: { name: string; price: number; categoria: string }[];
  candidatosSaborAmbiguo?: string[];
  candidatosItemAmbiguo?: string[];
  itemAmbiguoTipo?: "lanche" | "lanche_flavor" | "bebida";
  stepAposSabor?: BotStep;
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
  // Todos os tamanhos permitem meio a meio (inclusive a Pequena).
  return !!size;
}
// ===== MOTOR DE RECONHECIMENTO DE SABOR (tolerante a erro humano) =====
// Apelidos: variações que o fuzzy sozinho não pegaria (números por extenso vs dígito,
// abreviações e grafias alternativas comuns no WhatsApp).
const APELIDOS_SABOR: Record<string, string[]> = {
  "Quatro Queijos": ["4 queijos", "4 queijo", "quatro queijo"],
  "Tres Queijos": ["3 queijos", "3 queijo", "tres queijo"],
  "Frango Catupiry": ["frango", "frango c catupiry", "frango com catupiry", "frango catupiri"],
  "Mussarela": ["mucarela", "muzarela", "muzzarela", "mozarela", "mucarella", "mussarella", "mozzarela"],
  "Romeu e Julieta": ["romeu", "romeu julieta"],
  "Calabresa": ["calabreza", "calabre"],
  "Portuguesa": ["portugesa", "portugues"],
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
  for (const f of flavors) {
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
function detectaDoisSabores(n: string, allFlavors: string[]): [string, string] | null {
  // Por número ("1 e 8"), evitando o caso em que o dígito faz parte de um apelido ("3 queijos")
  const nums = n.match(/\d+/g);
  if (nums && nums.length >= 2) {
    const digitoEhApelido = allFlavors.some(f =>
      (APELIDOS_SABOR[f] || []).some(ap => /\d/.test(ap) && n.includes(normalizar(ap)))
    );
    if (!digitoEhApelido) {
      const i1 = parseInt(nums[0]) - 1;
      const i2 = parseInt(nums[1]) - 1;
      if (i1 >= 0 && i1 < allFlavors.length && i2 >= 0 && i2 < allFlavors.length && i1 !== i2) {
        return [allFlavors[i1], allFlavors[i2]];
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
        `${pre}Boa! Só me diz o tamanho dessa pizza 😋\n\n${sizeList()}\n\n_(Digite *voltar* para corrigir)_`,
      ],
      session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza", currentFlavor: parcial.flavor }),
    };
  }

  // 2) Falta sabor -> pergunta sabor (guarda o tamanho)
  if (!parcial.flavor) {
    return {
      messages: [
        `${pre}Pizza *${parcial.size}* anotada! 👌`,
        `Agora me conta — qual o sabor? 😋\n\n${listaFlavors()}\n\n_(Digite *voltar* para corrigir)_`,
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
  const basePrice = getSizePrice(size);
  const borderPrice = border !== "Sem borda" ? getBorderPrice(size) : 0;
  const newItem: CartItem = { category: "pizza", name: "Pizza", size, flavor, border, price: basePrice + borderPrice };
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

// Detecta forma de pagamento numa mensagem (lista fechada e segura)
function detectaPagamento(n: string): string | null {
  if (/\bpix\b/.test(n) || n.includes("transfer")) return "Pix";
  if (n.includes("dinheiro") || n.includes("especie") || n.includes("cash") || /\ba vista\b/.test(n)) return "Dinheiro";
  if (n.includes("cartao") || n.includes("credito") || n.includes("debito") || /\bcard\b/.test(n)) return "Cartão";
  return null;
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
function continuaParaTrocoOuConfirm(session: BotSession): BotResponse {
  if (session.paymentMethod === "Dinheiro") {
    return { messages: [`Combinado! 💵 Vai precisar de troco?\n\nSe sim, me diz o valor que vai pagar. Ex: *100*\nSe não, é só digitar *não*`], session: resetaTentativas({ ...session, step: "troco" }) };
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
  return result;
}
function processMessageInner(input: string, session: BotSession): BotResponse {
  const text = input.trim();
  const n = normalizar(text);
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
    const qtdMatch = qtdMatchComPizza || qtdMatchExtenso;
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
      add_more: `Se quiser, pode me dizer se deseja bebida, outro lanche ou se já podemos fechar 😊`,
      delivery_type: `Vai querer entrega ou prefere buscar na loja? Se for entrega, me informa seu endereço completo com bairro, por favor 😊`,
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
        return { messages: [mensagemAddMore(session.cart)], session: resetaTentativas({ ...session, step: "add_more" }) };
      case "delivery_type":
        return { messages: [mensagemAddMore(session.cart)], session: resetaTentativas({ ...session, step: "add_more" }) };
      case "neighborhood":
        return { messages: [`Tudo bem! Vai querer entrega ou prefere buscar na loja? Se for entrega, me informa seu endereço completo com bairro, por favor 😊`], session: resetaTentativas({ ...session, step: "delivery_type" }) };
      case "confirma_bairro_fuzzy":
        return { messages: [`Tudo bem! Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", bairroFuzzyCandidato: undefined }) };
      case "confirma_produto_valor":
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", candidatosValorProduto: undefined }) };
      case "confirma_sabor_ambiguo":
        return { messages: [`Tudo bem! Qual o sabor então? 😊\n\n${listaFlavors()}`], session: resetaTentativas({ ...session, step: "flavor", candidatosSaborAmbiguo: undefined }) };
      case "confirma_item_ambiguo":
        return { messages: [`Tudo bem! ${mensagemCategorias()}`], session: resetaTentativas({ ...session, step: "category", candidatosItemAmbiguo: undefined, itemAmbiguoTipo: undefined }) };
      case "address":
        return { messages: [`Tudo bem! Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood" }) };
      case "payment":
        if (session.deliveryType === "pickup") {
          return { messages: [`Tudo bem! Vai querer entrega ou prefere buscar na loja? Se for entrega, me informa seu endereço completo com bairro, por favor 😊`], session: resetaTentativas({ ...session, step: "delivery_type" }) };
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
        messages: [`Olá! Seja bem-vindo à *Chefe da Pizza*! 🍕\n\n${mensagemCategorias()}`],
        session: { ...session, step: "category" },
      };
    }
    case "returning": {
      const historico = session.historico!;
      const firstName = historico.nome.split(" ")[0];
      // Cliente apressado: já mandou o pedido (completo ou parcial) na saudação -> processa direto
      const pedidoDireto = montarPizzaDoPedido(text, { ...session, customerName: historico.nome }, `Pode deixar, *${firstName}*! 🍕`);
      if (pedidoDireto) return pedidoDireto;
      const intencaoRet = detectaIntencaoDireta(text);
      if (intencaoRet) {
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
          const cart = historico.ultimoCart.map(item => {
            if (item.category === "pizza" && item.size) {
              const basePrice = getSizePrice(item.size);
              const borderPrice = item.border && item.border !== "Sem borda" ? getBorderPrice(item.size) : 0;
              return { ...item, price: basePrice + borderPrice };
            }
            return item;
          });
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
              `🛒 *Itens:*
${resumoCarrinho(cart)}

Vai querer entrega ou prefere buscar na loja? Se for entrega, me informa seu endereço completo com bairro, por favor 😊`
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

      // 2) Pedido direto/completo de pizza já na primeira mensagem
      const pedidoDireto = montarPizzaDoPedido(text, { ...session }, `Prazer em te atender! 😊`);
      if (pedidoDireto) return pedidoDireto;

      // 3) Intenção de categoria (pizza/lanche/bebida/suco) sem ser um pedido completo
      const intencao = detectaIntencaoDireta(text);
      if (intencao) {
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
      return respostaInvalida("Não entendi muito bem 😅 Me diz seu nome, ou já pode pedir direto (ex: _\"pizza calabresa\"_ ou _\"cardápio\"_)", session);
    }
    case "category": {
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
      const intencao = detectaIntencaoDireta(text);
      let category = "";
      if (n === "1" || n.includes("pizza")) category = "pizza";
      else if (n === "2" || n.includes("lanche")) category = "lanche";
      else if (n === "3" || n.includes("bebida")) category = "bebida";
      else if (n === "4" || n.includes("suco") || n.includes("vitamina")) category = "suco";
      else if (intencao) category = intencao.category;
      if (!category) return respostaInvalida(mensagemCategorias(), session);
      if (category === "pizza") {
        const pedidoPizza = montarPizzaDoPedido(text, session);
        if (pedidoPizza) return pedidoPizza;
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
        // Se o tamanho permite meio a meio, tenta DOIS sabores primeiro (evita capturar só o primeiro)
        if (permiteMeioAMeio(size)) {
          const dois = detectaDoisSabores(n, allFlavors);
          if (dois) {
            const flavorFinal = `${dois[0]}/${dois[1]}`;
            const bordaJunta = detectaBordaDaMensagem(n);
            if (bordaJunta) {
              const basePrice = getSizePrice(size);
              const borderPrice = bordaJunta !== "Sem borda" ? getBorderPrice(size) : 0;
              const itemPrice = basePrice + borderPrice;
              const newItem: CartItem = { category: "pizza", name: "Pizza", size, flavor: flavorFinal, border: bordaJunta, price: itemPrice };
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
              `Vai querer borda recheada? 😋`
            ],
            session: resetaTentativas({ ...session, step: "border_escolha", currentSize: size, currentFlavor: saborJunto }),
          };
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
              `Vai querer borda recheada? 😋`
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
      if (!isNaN(num) && num >= 1 && num <= allFlavors.length) {
        flavor2 = allFlavors[num - 1];
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
        // Resposta positiva sem especificar qual borda (ex: "sim", "quero", "pode ser") -> mostra a lista agora
        if (ePositiva(n) || n.includes("quero") || n.includes("com borda") || n.includes("pode ser") || n.includes("manda")) {
          return { messages: [`Show! Qual borda você prefere? 😋\n\n${listaBordas(session.currentSize!)}`], session };
        }
        return respostaInvalida(`Vai querer borda recheada? 😋\n\nResponda *sim* pra ver as opções, ou *não* pra seguir sem borda.`, session);
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
      const querLanche = n.includes("lanche") || n.includes("calzone") || n.includes("porcao") || n.includes("batata") ||
        n.includes("burguer") || n.includes("hamburguer") || n.includes("mini-pizza") || n.includes("mini pizza") || n.includes("macarronada");
      const querBebida = n.includes("bebida") || n.includes("refri") || n.includes("guarana") || n.includes("suco") || n.includes("agua") || n.includes("cerveja") || n.includes("coca") || n.includes("pepsi");

      // PRIORIDADE MÁXIMA: se quer finalizar e não mencionou pizza/lanche/bebida explicitamente, vai direto pro fechamento
      if (querFinalizar && !querPizza && !querLanche && !querBebida) {
        return {
          messages: [`Show! Vamos fechar então 🍕\n\nVai querer entrega ou prefere buscar aqui na loja? 😊`],
          session: resetaTentativas({ ...session, step: "delivery_type" }),
        };
      }
      // Pizza só se pedida explicitamente (regra: não voltar a pizza por engano)
      if (querPizza) {
        return { messages: [`Qual o tamanho da próxima pizza? 🍕\n\n${sizeList()}\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "size", currentCategory: "pizza" }) };
      }
      // Lanche (sem pizza) — vai direto pro cardápio de lanches
      if (querLanche) {
        const resp = handleCategory("lanche", { ...session, step: "category" });
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
          messages: [`Show! Vamos fechar então 🍕\n\nVai querer entrega ou prefere buscar aqui na loja? 😊`],
          session: resetaTentativas({ ...session, step: "delivery_type" }),
        };
      }
      const intencaoDireta = detectaIntencaoDireta(text);
      if (intencaoDireta) {
        const resp = handleCategory(intencaoDireta.category, { ...session, step: "category" });
        return { ...resp, session: resetaTentativas(resp.session) };
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
          messages: [`Combinado! Vai querer entrega ou prefere buscar na loja? Se for entrega, me informa seu endereço completo com bairro, por favor 😊`],
          session: resetaTentativas({ ...session, step: "delivery_type", observacao: undefined }),
        };
      }
      return {
        messages: [`Anotei: _"${text}"_ ✏️\n\nVai querer entrega ou prefere buscar na loja? Se for entrega, me informa seu endereço completo com bairro, por favor 😊`],
        session: resetaTentativas({ ...session, step: "delivery_type", observacao: text }),
      };
    }
    case "delivery_type": {
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
        return { messages: [`Combinado, você retira aqui na loja! 🏪\n\nQual a forma de pagamento? 💸`], session: resetaTentativas({ ...baseSession, step: "payment" }) };
      }

      // Caminho DELIVERY com BAIRRO VÁLIDO detectado -> aplica taxa e pede só o endereço (pagamento guardado p/ depois)
      if (dados.tipo === "delivery" && dados.bairro) {
        return {
          messages: [`*${dados.bairro.name}*, taxa de entrega: *${formatCurrency(dados.bairro.fee)}* 🛵\n\nMe passa o endereço completo:\n_(Rua, número e complemento)_\n\n_(Digite *voltar* para corrigir a etapa anterior)_`],
          session: resetaTentativas({ ...session, step: "address", deliveryType: "delivery", neighborhood: dados.bairro.name, deliveryFee: dados.bairro.fee, pagamentoPendente: pagDetectado }),
        };
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
        return { messages: [`Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", deliveryType: "delivery", pagamentoPendente: pagDetectado }) };
      }
      if (n === "2" || n.includes("retirar") || n.includes("loja") || n.includes("buscar") || n.includes("pegar") || n.includes("retiro")) {
        return { messages: [`Combinado, você retira aqui na loja! 🏪\n\nQual a forma de pagamento? 💸`], session: resetaTentativas({ ...session, step: "payment", deliveryType: "pickup", deliveryFee: 0, neighborhood: undefined }) };
      }
      return respostaInvalida(`Vai querer entrega ou prefere buscar na loja? 😊`, session);
    }
    case "neighborhood": {
      const num = parseInt(text);
      let found: { name: string; fee: number } | undefined;
      if (!isNaN(num) && num >= 1 && num <= MENU.neighborhoods.length) found = MENU.neighborhoods[num - 1];
      else found = detectaBairro(n) ?? undefined;
      if (found) {
        return { messages: [`*${found.name}*, taxa de entrega: *${formatCurrency(found.fee)}* 🛵\n\nMe passa o endereço completo:\n_(Rua, número e complemento)_\n\n_(Digite *voltar* para corrigir a etapa anterior)_`], session: resetaTentativas({ ...session, step: "address", neighborhood: found.name, deliveryFee: found.fee }) };
      }
      // Sem match exato -> tenta fuzzy (erro de digitação). NUNCA aplica taxa direto: sempre confirma.
      const candidato = detectaBairroFuzzy(n);
      if (candidato) {
        return { messages: [`Você quis dizer *${candidato.name}*? 😊`], session: resetaTentativas({ ...session, step: "confirma_bairro_fuzzy", bairroFuzzyCandidato: candidato.name }) };
      }
      return respostaInvalida(`Qual o seu bairro? 😊`, session);
    }
    case "confirma_bairro_fuzzy": {
      const nomeCandidato = session.bairroFuzzyCandidato;
      const nb = MENU.neighborhoods.find(b => b.name === nomeCandidato);
      if (ePositiva(n) || n === "1") {
        if (!nb) return respostaInvalida(`Qual o seu bairro? 😊`, session);
        return { messages: [`*${nb.name}*, taxa de entrega: *${formatCurrency(nb.fee)}* 🛵\n\nMe passa o endereço completo:\n_(Rua, número e complemento)_`], session: resetaTentativas({ ...session, step: "address", neighborhood: nb.name, deliveryFee: nb.fee, bairroFuzzyCandidato: undefined }) };
      }
      return { messages: [`Sem problema! Qual o seu bairro então? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", bairroFuzzyCandidato: undefined }) };
    }
    case "confirm_address": {
      if (ePositiva(n) || n === "1") {
        if (session.pagamentoPendente) {
          return aplicaPagamento(session.pagamentoPendente, session);
        }
        return { messages: [`Ótimo! 📍 *${session.address} - ${session.neighborhood}*\n\nQual a forma de pagamento? 💸`], session: resetaTentativas({ ...session, step: "payment" }) };
      }
      if (eNegativa(n) || n === "2") {
        return { messages: [`Tudo bem! Qual o seu bairro? 😊`], session: resetaTentativas({ ...session, step: "neighborhood", address: undefined }) };
      }
      return respostaInvalida(`  1. Sim, mesmo endereço\n  2. Não, quero outro endereço`, session);
    }
    case "address": {
      if (!text || text.length < 5) return respostaInvalida("Me passa o endereço completo.\nExemplo: *Rua das Flores, 123, Apto 2*", session);
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
      if (!flavor) return respostaInvalida(flavors.map((f, i) => `  ${i + 1}. ${f}`).join("\n"), session);
      const newItem: CartItem = { category: "lanche", name: lanche.name, flavor, price: lanche.price };
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
        if (lanche.name === "Macarronada de Carne") {
          return { messages: [`Ótima escolha! 😋 Qual tamanho da *Macarronada de Carne*?\n\n  1. Pequena (P) · *R$ 28,00*\n  2. Média (M) · *R$ 40,00*\n  3. Grande (G) · *R$ 50,00*\n\n_(Bacon ou ovos: acréscimo de R$ 10,00)_`], session: resetaTentativas({ ...session, step: "lanche_macarronada_size", currentLanche: lanche.name, candidatosItemAmbiguo: undefined }) };
        }
        if (lanche.hasFlavors) {
          const flavors = MENU[lanche.flavorsKey as keyof typeof MENU] as string[];
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
  return texto + rodape;
}
export function createReturningSession(historico: ClienteHistorico): BotSession {
  return { step: "returning", cart: [], deliveryFee: 0, historico, tentativasInvalidas: 0 };
}
export function getWelcomeMessages(): string[] {
  return [`Olá! Seja bem-vindo à *Chefe da Pizza*! 🍕\n\nPra começar, me fala seu nome?`];
}
