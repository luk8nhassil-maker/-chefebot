// Log sanitizado para o módulo de sobrevivência — nunca grava o objeto de
// erro inteiro (poderia carregar URL/token/payload de um provider externo),
// nunca telefone/PII. Só categoria + estágio + código estável + o nome do
// construtor do erro (ex.: "TypeError"), o suficiente para diagnosticar sem
// vazar dado sensível nos runtime logs (visíveis no painel da Vercel).
export function logSurvivalErro(categoria: string, estagio: string, codigo: string, err?: unknown): void {
  const tipoErro = err instanceof Error ? err.constructor.name : typeof err;
  console.error(`[survival] categoria=${categoria} estagio=${estagio} codigo=${codigo} tipoErro=${tipoErro}`);
}
