export type IdentidadeCheckout = {
  nome: string;
  apelido: string;
  exibicao: string;
  valida: boolean;
};

function normalizarCampoIdentidade(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
}

/**
 * Regra do checkout:
 * - Nome OU Apelido satisfazem a identificação.
 * - Se ambos existirem, Nome continua sendo a identificação principal.
 * - clienteLegado existe só para compatibilidade de payloads antigos no
 *   servidor; a UI nova não usa esse fallback para liberar o formulário.
 */
export function resolverIdentidadeCheckout(input: {
  nome?: unknown;
  apelido?: unknown;
  clienteLegado?: unknown;
}): IdentidadeCheckout {
  const nome = normalizarCampoIdentidade(input.nome);
  const apelido = normalizarCampoIdentidade(input.apelido);
  const legado = normalizarCampoIdentidade(input.clienteLegado);
  const exibicao = nome || apelido || legado;

  return {
    nome,
    apelido,
    exibicao,
    valida: Boolean(nome || apelido),
  };
}
