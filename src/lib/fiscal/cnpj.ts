/** Validação de CNPJ numérico e alfanumérico (Receita Federal, 2026). Não comprova titularidade ou regularidade fiscal. */
export function cnpjValido(cnpj: string): boolean {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (parcial: string) => {
    const pesos = parcial.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...parcial].reduce((acc, n, i) => acc + (n.charCodeAt(0) - 48) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? "0" : String(11 - resto);
  };
  return cnpj[12] === dv(cnpj.slice(0,12)) && cnpj[13] === dv(cnpj.slice(0,13));
}
