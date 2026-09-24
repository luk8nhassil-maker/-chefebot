/**
 * Trava de release do primeiro envio controlado.
 *
 * Esta branch prepara toda a infraestrutura, mas não autoriza envio real.
 * A ativação exige um patch separado, revisado e aprovado depois que esta
 * base estiver em produção e passar health check.
 */
export function envioControladoLiberadoNestaVersao(): boolean {
  return false;
}
