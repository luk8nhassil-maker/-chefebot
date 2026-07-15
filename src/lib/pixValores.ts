// Divisão segura (em centavos) entre a parte paga via Pix e a parte em
// dinheiro de um pedido misto, usada pela tela de retomada do Pix
// (/pedido/pagamento/[token]). Nunca faz aritmética de ponto flutuante
// direta em reais — converte para centavos, calcula, converte de volta —
// para não gerar diferenças como 59.999999999999 ou valores negativos por
// arredondamento.
export type DivisaoPixDinheiro = {
  isHibrido: boolean;
  pix: number;
  dinheiro: number;
};

function paraCentavosSeguro(valor: number): number {
  const seguro = Number.isFinite(valor) ? valor : 0;
  return Math.round(seguro * 100);
}

export function calcularDivisaoPixDinheiro(total: number, valorPix: number | undefined): DivisaoPixDinheiro {
  const totalCentavos = paraCentavosSeguro(total);
  const pixCentavosBruto = typeof valorPix === "number" ? paraCentavosSeguro(valorPix) : totalCentavos;
  // Nunca deixa o valor Pix exceder o total nem ficar negativo — protege
  // contra dado inconsistente vindo do backend sem travar a tela.
  const pixCentavos = Math.max(0, Math.min(pixCentavosBruto, totalCentavos));
  const dinheiroCentavos = Math.max(0, totalCentavos - pixCentavos);
  const isHibrido = pixCentavos > 0 && pixCentavos < totalCentavos;

  return {
    isHibrido,
    pix: pixCentavos / 100,
    dinheiro: dinheiroCentavos / 100,
  };
}
