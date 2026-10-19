/** Converte somente o destino técnico canário ao formato aceito pela Evolution.
 * Não deve ser aplicado a telefones de clientes nem a outros envios.
 */
export function normalizarTelefoneCanarioWhatsapp(configurado: string | undefined): string | null {
  const digitos = (configurado ?? "").trim().replace(/\D/g, "");
  const phone = digitos.length === 10 || digitos.length === 11 ? `55${digitos}` : digitos;
  return /^55[1-9]\d{9,10}$/.test(phone) ? phone : null;
}
