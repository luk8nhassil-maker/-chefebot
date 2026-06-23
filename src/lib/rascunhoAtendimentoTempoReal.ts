import { MENU } from "./menu";
import type { BotSession } from "./bot";

// ─────────────────────────────────────────────────────────────────────────────
// Rascunho de atendimento em tempo real.
//
// Lê cada mensagem do cliente e tenta encaixar um "pedido vivo" para a atendente
// ler enquanto conduz a conversa. É puro: NÃO chama Redis, NÃO envia mensagem,
// NÃO processa o fluxo do bot e NÃO altera o carrinho oficial. Só preenche o
// campo novo session.rascunhoAtendimento. Quando não tem confiança, não inventa.
// ─────────────────────────────────────────────────────────────────────────────

export interface RascunhoAtendimento {
  nome?: string;
  itens: string[];
  tipoEntrega?: "delivery" | "retirada" | "dine_in";
  bairro?: string;
  endereco?: string;
  pagamento?: string;
  troco?: string;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function capitalizar(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Pizza: tamanho + sabores + meio a meio ───────────────────────────────────
function detectarPizza(texto: string): string | null {
  const n = norm(texto);

  let tamanho = "";
  if (/\bfamilia\b/.test(n)) tamanho = "Família";
  else if (/\bgrande\b/.test(n)) tamanho = "G";
  else if (/\bmedia\b/.test(n)) tamanho = "M";
  else if (/\bpequena\b/.test(n)) tamanho = "P";

  // Só busca sabores em contexto de pizza, para não confundir com outros itens.
  const contextoPizza = /\bpizza\b/.test(n) || tamanho !== "";
  if (!contextoPizza) return null;

  const flavors = MENU.saltyFlavors.concat(MENU.sweetFlavors);
  const encontrados: { display: string; idx: number }[] = [];
  for (const f of flavors) {
    const fn = norm(f);
    const idxFull = n.indexOf(fn);
    if (idxFull >= 0) {
      encontrados.push({ display: f, idx: idxFull });
      continue;
    }
    const primeira = fn.split(" ")[0];
    if (primeira.length >= 4) {
      const m = new RegExp(`\\b${primeira}\\b`).exec(n);
      if (m) encontrados.push({ display: capitalizar(primeira), idx: m.index });
    }
  }

  if (encontrados.length === 0) return null;

  // Dedup por display, ordena por ordem de aparição, máximo 2 (meio a meio).
  const vistos = new Set<string>();
  const sabores = encontrados
    .sort((a, b) => a.idx - b.idx)
    .filter(e => (vistos.has(e.display) ? false : (vistos.add(e.display), true)))
    .slice(0, 2)
    .map(e => e.display)
    .join("/");

  return `Pizza ${tamanho ? tamanho + " " : ""}${sabores}`.replace(/\s+/g, " ").trim();
}

// ── Bebidas / sucos / lanches: gatilhos distintivos e conservadores ──────────
function detectarOutrosItens(texto: string): string[] {
  const n = norm(texto);
  const itens: string[] = [];

  if (/\brefrigerante\b|\brefri\b/.test(n)) itens.push("Refrigerante");
  if (/\bguarana\b/.test(n)) itens.push("Guaraná");
  if (/\bpepsi\b/.test(n)) itens.push("Pepsi");
  if (/\bcerveja\b/.test(n)) itens.push("Cerveja");

  if (/\bsuco\b|\bvitamina\b/.test(n)) {
    const sabor = MENU.sucos
      .map(s => norm(s.name).replace(/^vitamina de /, ""))
      .find(tok => tok.length >= 4 && new RegExp(`\\b${tok}\\b`).test(n));
    itens.push(sabor ? `Suco de ${capitalizar(sabor)}` : "Suco");
  }

  if (/\bx[-\s]?tudo\b/.test(n)) itens.push("X-Tudo");
  if (/\bx[-\s]?bacon\b/.test(n)) itens.push("X-Bacon");
  if (/\bx[-\s]?burgu?er\b|\bx[-\s]?burg\b/.test(n)) itens.push("X-Burguer");
  if (/\bcalzone\b/.test(n)) itens.push("Calzone");
  if (/\bmacarronada\b/.test(n)) itens.push("Macarronada");
  if (/\bbatata|\bfritas?\b/.test(n)) itens.push("Porção de Batatas");

  return itens;
}

function detectarItens(texto: string): string[] {
  const itens: string[] = [];
  const pizza = detectarPizza(texto);
  if (pizza) itens.push(pizza);
  itens.push(...detectarOutrosItens(texto));
  return itens;
}

// ── Endereço / bairro / tipo de entrega ──────────────────────────────────────
function detectarEntrega(texto: string): {
  endereco?: string;
  bairro?: string;
  tipoEntrega?: "delivery";
} {
  let bairro: string | undefined;
  const mB = texto.match(/bairro\s+([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\s]*?)(?:[,.;]|$)/i);
  if (mB) {
    const cand = mB[1].trim();
    const known = MENU.neighborhoods.find(
      nb =>
        norm(nb.name) === norm(cand) ||
        norm(cand).startsWith(norm(nb.name)) ||
        norm(nb.name).startsWith(norm(cand)),
    );
    bairro = known ? known.name : capitalizar(cand);
  }

  let endereco: string | undefined;
  const mE = texto.match(
    /\b(rua|avenida|av|travessa|trav|estrada|rodovia|rod|alameda|pra[cç]a|ladeira|beco|conjunto|quadra)\b/i,
  );
  if (mE && mE.index !== undefined) {
    let resto = texto.slice(mE.index);
    const idxBairro = norm(resto).indexOf("bairro");
    if (idxBairro >= 0) resto = resto.slice(0, idxBairro);
    endereco = resto.replace(/[,;\s]+$/, "").trim();
    if (endereco) endereco = capitalizar(endereco);
  }

  const tipoEntrega = endereco || bairro ? ("delivery" as const) : undefined;
  return { endereco, bairro, tipoEntrega };
}

// ── Pagamento ─────────────────────────────────────────────────────────────────
function detectarPagamento(texto: string): string | undefined {
  const n = norm(texto);
  if (/\bpix\b/.test(n)) return "Pix";
  if (/\bdinheiro\b|\bespecie\b/.test(n)) return "Dinheiro";
  if (/\bcartao\b|\bcredito\b|\bdebito\b/.test(n)) return "Cartão";
  return undefined;
}

// ── Troco ─────────────────────────────────────────────────────────────────────
function detectarTroco(texto: string): string | undefined {
  const m = texto.match(/troco\s+(?:para|pra|de)?\s*(r?\$?\s*\d+(?:[.,]\d{1,2})?)/i);
  if (m) return `Para ${m[1].trim()}`;
  return undefined;
}

// Contexto externo passado pelo webhook — não polui o contrato puro do helper.
export interface RascunhoContexto {
  ultimaMensagemAtendente?: string;
}

// ── Nome (só quando declarado claramente; nunca a partir do telefone) ────────
function detectarNome(texto: string): string | undefined {
  const m = texto.match(
    /\b(?:meu nome (?:e|é)|me chamo|sou (?:o|a)|aqui (?:e|é)|pode chamar de)\s+([a-zA-ZÀ-ÿ]{2,})/i,
  );
  if (m) return capitalizar(m[1].trim());
  return undefined;
}

// Palavras que NUNCA são nomes — evita confundir respostas comuns com o nome
// do cliente quando o bot está esperando a resposta para "qual o seu nome?".
const BLOCKLIST_NOME = new Set([
  "dinheiro","pix","cartao","cartão","credito","crédito","debito","débito",
  "entrega","delivery","retirada","dine","pizza","lanche","hamburguer","hamburger",
  "bebida","suco","refrigerante","guarana","guaraná","cerveja","pepsi","coca",
  "rua","avenida","av","bairro","travessa","estrada","rodovia","alameda","praca","praça",
  "troco","real","reais","sim","nao","não","ok","oi","ola","olá","bom","boa",
  "noite","tarde","dia","tudo","obrigado","obrigada","por","favor","preciso","quero",
]);

// Conjunto de termos do cardápio (sabores, bebidas, lanches) em forma normalizada.
// Construído uma única vez a partir do MENU para evitar falsos positivos de nome.
const TERMOS_CARDAPIO: Set<string> = (() => {
  const set = new Set<string>();
  const add = (t: string) => { const n = norm(t); if (n.length >= 2) set.add(n); };

  // Sabores: indexa o nome completo e cada palavra individual.
  for (const f of [...MENU.saltyFlavors, ...MENU.sweetFlavors]) {
    add(f);
    for (const w of f.split(" ")) add(w);
  }
  // Bebidas, sucos e lanches: apenas o nome completo (palavras individuais já cobertas).
  for (const b of MENU.bebidas ?? []) add(b.name);
  for (const s of MENU.sucos ?? []) add(s.name);
  for (const l of MENU.lanches ?? []) add(l.name);

  return set;
})();

// Rejeita uma resposta que provavelmente seja um item/sabor do cardápio.
// Usado apenas na captura de nome contextual.
function pareceItemDeCardapio(texto: string): boolean {
  const partes = norm(texto).split(/\s+/);
  return partes.some(p => TERMOS_CARDAPIO.has(p));
}

// Verifica se a mensagem da atendente indica que ela estava pedindo o nome.
function atendentePerguNome(msg: string): boolean {
  if (!msg) return false;
  const n = norm(msg).trim();
  return (
    /qual\s+(?:o\s+)?seu\s+nome/.test(n) ||
    /me\s+diga\s+(?:o\s+)?(?:seu\s+)?nome/.test(n) ||
    /me\s+passa\s+(?:o\s+)?(?:seu\s+)?nome/.test(n) ||
    /como\s+(?:voce|você)\s+se\s+chama/.test(n) ||
    /seu\s+nome\s+por\s+favor/.test(n) ||
    /^nome\??$/.test(n)
  );
}

// Detecta nome simples (1-2 palavras, apenas letras) quando:
// • o bot está aguardando nome (step "name"/"pedindo_nome"), OU
// • a última mensagem da atendente perguntou o nome.
function detectarNomeContextual(
  session: BotSession,
  texto: string,
  contexto?: RascunhoContexto,
): string | undefined {
  const stepNome = session.step === "name" || session.step === "pedindo_nome";
  const atendentePerguntou =
    !!contexto?.ultimaMensagemAtendente &&
    atendentePerguNome(contexto.ultimaMensagemAtendente);

  if (!stepNome && !atendentePerguntou) return undefined;

  const partes = texto.trim().split(/\s+/);
  if (partes.length === 0 || partes.length > 2) return undefined;

  // Aceita apenas letras (incluindo acentuadas); rejeita números e símbolos.
  if (!partes.every(p => /^[a-zA-ZÀ-ÿ]{2,}$/.test(p))) return undefined;

  // Rejeita se qualquer parte estiver na blocklist de palavras comuns.
  if (partes.some(p => BLOCKLIST_NOME.has(norm(p)))) return undefined;

  // Rejeita se a resposta parecer um sabor, bebida ou lanche do cardápio.
  if (pareceItemDeCardapio(texto)) return undefined;

  return partes.map(capitalizar).join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Função principal: recebe a sessão e o texto novo do cliente; devolve uma NOVA
// sessão com session.rascunhoAtendimento atualizado (merge incremental). Nunca
// muta a sessão original nem qualquer campo oficial.
// ─────────────────────────────────────────────────────────────────────────────
export function atualizarRascunhoAtendimentoTempoReal(
  session: BotSession,
  textoCliente: string,
  contexto?: RascunhoContexto,
): BotSession {
  const texto = (textoCliente || "").trim();
  if (!texto) return session;

  const atual: RascunhoAtendimento = session.rascunhoAtendimento ?? { itens: [] };

  const itens = [...atual.itens];
  for (const it of detectarItens(texto)) if (!itens.includes(it)) itens.push(it);

  const entrega = detectarEntrega(texto);
  const pagamento = detectarPagamento(texto);
  const troco = detectarTroco(texto);
  // Declarações explícitas ("me chamo X") sempre vencem.
  // Contextual só dispara quando não há nome ainda e há contexto seguro.
  const nomeExplicito = detectarNome(texto);
  const nomeContextual =
    !nomeExplicito && !session.customerName && !atual.nome
      ? detectarNomeContextual(session, texto, contexto)
      : undefined;
  const nome = nomeExplicito ?? nomeContextual;

  const rascunhoAtendimento: RascunhoAtendimento = {
    nome: nome ?? atual.nome,
    itens,
    tipoEntrega: entrega.tipoEntrega ?? atual.tipoEntrega,
    bairro: entrega.bairro ?? atual.bairro,
    endereco: entrega.endereco ?? atual.endereco,
    pagamento: pagamento ?? atual.pagamento,
    troco: troco ?? atual.troco,
  };

  return { ...session, rascunhoAtendimento };
}
