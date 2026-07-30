// Pagamento composto (Pix + Dinheiro na mesma conta) — módulo puro, sem I/O.
//
// Antes deste módulo a string canônica era montada e re-parseada em três
// lugares independentes (checkout do cardápio, edição do pedido pelo cliente e
// os helpers centralizados de src/lib/bot.ts), com duas divergências reais:
//
//  1. a tela de edição gravava `Pix (R$ 30.00) + Dinheiro (R$ 20.00)` (ponto
//     como separador decimal), enquanto o checkout e o bot gravam
//     `Pix (R$ 30,00) + Dinheiro (R$ 20,00)` (vírgula). Como
//     `valorPixEsperado`/`valorDinheiroEsperado` (src/lib/bot.ts) tratam o
//     ponto como separador de MILHAR, "30.00" era lido como 3000 — cobrança
//     Pix e base de cálculo do troco iam para a casa dos milhares;
//  2. ninguém revalidava a soma contra o total DEPOIS de o cliente alterar os
//     itens: um pagamento misto válido no momento da criação continuava sendo
//     aceito mesmo quando o total do pedido mudava durante a edição.
//
// A regra passa a ser: a interface nunca monta a string por conta própria —
// ela pede ao validador, que devolve a forma canônica já formatada. Assim o
// que é gravado é sempre parseável depois pelos mesmos helpers.
//
// Toda aritmética é feita em CENTAVOS INTEIROS; a comparação de igualdade
// admite a tolerância de um centavo (arredondamento de exibição), nunca uma
// soma de reais em ponto flutuante.

/** Tolerância de igualdade entre a soma das partes e o total, em centavos. */
export const TOLERANCIA_CENTAVOS = 1;

export type PagamentoComposto = { pix: number; dinheiro: number };

export type ResultadoPagamentoComposto =
  | { ok: true; valor: string }
  | { ok: false; erro: string };

/** Converte reais para centavos inteiros — única porta de entrada da aritmética. */
export function emCentavos(valor: number): number {
  return Math.round(valor * 100);
}

/**
 * Parse tolerante de um valor monetário digitado ou lido de registro antigo.
 * Aceita símbolo monetário, espaços, separador de milhar e vírgula decimal.
 * Nunca lança: devolve `null` quando não consegue interpretar com segurança.
 *
 * Ambiguidade do ponto: `1.234` é milhar, `30.00` é decimal. A regra é o
 * tamanho do último grupo — 3 dígitos depois do último ponto e nenhuma
 * vírgula significa separador de milhar; qualquer outro tamanho é decimal.
 * Essa direção existe porque os registros legados gravados pela tela de
 * edição usavam ponto decimal com 2 casas.
 */
export function parseValorMonetario(bruto: string | number | null | undefined): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== "string") return null;

  const limpo = bruto.replace(/[^\d.,-]/g, "").trim();
  if (!limpo || !/\d/.test(limpo)) return null;

  let normalizado: string;
  if (limpo.includes(",")) {
    // Vírgula presente: ela é o separador decimal e todo ponto é milhar.
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else {
    const partes = limpo.split(".");
    normalizado =
      partes.length > 1 && partes[partes.length - 1].length === 3
        ? partes.join("") // 1.234 / 1.234.567 → milhar
        : limpo; // 30.00 / 30.5 → decimal
  }

  const valor = parseFloat(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

/** Formata um valor na forma canônica usada dentro da string de pagamento. */
export function formatarValorPagamento(valor: number): string {
  return "R$ " + valor.toFixed(2).replace(".", ",");
}

// Regex ancorada: só reconhece a string composta inteira, nunca um trecho
// solto dentro de um texto maior. O grupo aceita ponto e vírgula porque
// registros antigos existem nos dois formatos (ver comentário do topo).
const RE_COMPOSTO = /^Pix\s*\(R\$\s*([\d.,]+)\)\s*\+\s*Dinheiro\s*\(R\$\s*([\d.,]+)\)$/i;

/**
 * Parse reverso da string canônica. Devolve `null` quando o pagamento não é
 * composto (forma simples, vazio ou formato desconhecido) — a ausência é uma
 * resposta legítima, não um erro.
 */
export function extrairPagamentoComposto(
  pagamento: string | null | undefined
): PagamentoComposto | null {
  if (!pagamento || typeof pagamento !== "string") return null;
  const m = pagamento.trim().match(RE_COMPOSTO);
  if (!m) return null;

  const pix = parseValorMonetario(m[1]);
  const dinheiro = parseValorMonetario(m[2]);
  if (pix === null || dinheiro === null) return null;
  if (pix < 0 || dinheiro < 0) return null;

  return { pix, dinheiro };
}

/** `true` quando a string representa um pagamento composto bem formado. */
export function ehPagamentoComposto(pagamento: string | null | undefined): boolean {
  return extrairPagamentoComposto(pagamento) !== null;
}

/**
 * Valida as duas partes contra o total e devolve a string canônica que será
 * persistida. Resultado discriminado: quem chama decide o que fazer com o
 * erro, e a mensagem já está redigida para exibição.
 */
export function montarPagamentoComposto(
  pixBruto: string | number | null | undefined,
  dinheiroBruto: string | number | null | undefined,
  total: number
): ResultadoPagamentoComposto {
  const pix = parseValorMonetario(pixBruto);
  const dinheiro = parseValorMonetario(dinheiroBruto);

  if (pix === null || dinheiro === null) {
    return { ok: false, erro: "Informe os dois valores." };
  }
  if (pix < 0 || dinheiro < 0) {
    return { ok: false, erro: "Os valores não podem ser negativos." };
  }

  const pixCent = emCentavos(pix);
  const dinheiroCent = emCentavos(dinheiro);
  if (pixCent === 0 || dinheiroCent === 0) {
    return {
      ok: false,
      erro: "Informe um valor maior que zero no Pix e no Dinheiro. Se for só um método, escolha ele direto.",
    };
  }

  const totalCent = emCentavos(Number.isFinite(total) ? total : NaN);
  if (!Number.isFinite(totalCent)) {
    return { ok: false, erro: "Não foi possível conferir o total do pedido agora." };
  }

  const soma = pixCent + dinheiroCent;
  if (Math.abs(soma - totalCent) > TOLERANCIA_CENTAVOS) {
    return {
      ok: false,
      erro: `A soma (${formatarValorPagamento(soma / 100)}) precisa ser igual ao total do pedido (${formatarValorPagamento(totalCent / 100)}).`,
    };
  }

  return {
    ok: true,
    valor: `Pix (${formatarValorPagamento(pix)}) + Dinheiro (${formatarValorPagamento(dinheiro)})`,
  };
}

/**
 * Revalida um pagamento JÁ GRAVADO contra o total ATUAL do pedido.
 *
 * Esta é a peça-chave da edição: quando os itens mudam, o total muda, e um
 * pagamento composto que fechava na criação pode deixar de fechar. Pagamentos
 * não compostos (Pix puro, Dinheiro, Cartão) sempre retornam `true` — não há
 * invariante de soma a verificar neles.
 */
export function pagamentoAindaValido(
  pagamento: string | null | undefined,
  total: number
): boolean {
  const composto = extrairPagamentoComposto(pagamento);
  if (!composto) return true;
  if (!Number.isFinite(total)) return false;

  const soma = emCentavos(composto.pix) + emCentavos(composto.dinheiro);
  return Math.abs(soma - emCentavos(total)) <= TOLERANCIA_CENTAVOS;
}

/**
 * Renormaliza um pagamento composto legado para a forma canônica atual
 * (vírgula decimal). Registros gravados com ponto decimal continuam
 * editáveis: o valor lido é o mesmo, só a grafia é corrigida. Pagamentos não
 * compostos são devolvidos intactos.
 */
export function normalizarPagamentoComposto(pagamento: string | null | undefined): string | null {
  if (pagamento === null || pagamento === undefined) return null;
  const composto = extrairPagamentoComposto(pagamento);
  if (!composto) return pagamento;
  return `Pix (${formatarValorPagamento(composto.pix)}) + Dinheiro (${formatarValorPagamento(composto.dinheiro)})`;
}
