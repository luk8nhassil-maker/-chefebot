import { montarPagamentoComposto, parseValorMonetario } from "./pagamentoComposto";
import { norm } from "./pedidoAppItens";

export type PagamentoContaSalao = {
  pagamento: string;
  troco?: string;
};

function pagamentoOficialSelecionado(valor: unknown, formasOficiais: string[]): string | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const procurado = norm(valor);
  return formasOficiais.find((forma) => norm(forma) === procurado) ?? null;
}

function ehDinheiro(forma: string): boolean {
  return norm(forma).includes("dinheiro");
}

function ehMisto(forma: string): boolean {
  const n = norm(forma);
  return n.includes("misto") || (n.includes("pix") && n.includes("dinheiro"));
}

export function validarPagamentoContaSalao(params: {
  pagamento: unknown;
  troco?: unknown;
  valorPix?: unknown;
  valorDinheiro?: unknown;
  totalCentavos: number;
  formasOficiais: string[];
}): { ok: true; valor: PagamentoContaSalao } | { ok: false; error: string } {
  const forma = pagamentoOficialSelecionado(params.pagamento, params.formasOficiais);
  if (!forma) {
    return { ok: false, error: "Escolha uma forma de pagamento disponível no cardápio oficial." };
  }

  const total = params.totalCentavos / 100;
  if (ehMisto(forma)) {
    const composto = montarPagamentoComposto(params.valorPix, params.valorDinheiro, total);
    if (!composto.ok) return { ok: false, error: composto.erro };
    return { ok: true, valor: { pagamento: composto.valor } };
  }

  if (!ehDinheiro(forma)) {
    return { ok: true, valor: { pagamento: forma } };
  }

  const trocoBruto = typeof params.troco === "string" ? params.troco.trim() : "";
  if (!trocoBruto || /^sem troco$/i.test(trocoBruto)) {
    return { ok: true, valor: { pagamento: forma, troco: "Sem troco" } };
  }

  const valorTroco = parseValorMonetario(trocoBruto);
  if (valorTroco === null || Math.round(valorTroco * 100) < params.totalCentavos) {
    return { ok: false, error: "O valor para troco precisa ser igual ou maior que o total da conta." };
  }

  return {
    ok: true,
    valor: {
      pagamento: forma,
      troco: `Troco para R$ ${valorTroco.toFixed(2).replace(".", ",")}`,
    },
  };
}
