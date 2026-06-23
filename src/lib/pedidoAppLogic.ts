// Pure helpers for the /api/pedido-app route — extracted so they can be unit-tested.

export function computeTaxaApp(
  tipoEntrega: string,
  bairro: string | undefined,
  neighborhoods: Array<{ name: string; fee: number }>,
): number {
  if (tipoEntrega !== "delivery" || !bairro) return 0;
  const bairroNorm = bairro.toLowerCase().trim();
  return neighborhoods.find((n) => n.name.toLowerCase().trim() === bairroNorm)?.fee ?? 0;
}

export function buildEnderecoApp(body: {
  tipoEntrega: string;
  rua?: string;
  numero?: string;
  bairro?: string;
}): string {
  if (body.tipoEntrega === "dine_in") return "Consumo no local";
  if (body.tipoEntrega === "retirada") return "Retirada na loja";
  // delivery
  const partes = [body.rua || "", body.numero || ""].filter(Boolean).join(", ");
  return `${partes}${body.bairro ? ` - ${body.bairro}` : ""}`.trim();
}
