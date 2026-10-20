import { materializarPizza, type Premio } from "./domain";
import type { PizzaCatalog } from "../catalog/pizzas";
export const PREMIO_CARRINHO = "cf_premio_ranking3";
export type ReferenciaPremio = { id: string; selecao: { sizeId: "size-f"; flavorIds: string[] }; clientRequestId: string };
// Referência não reserva nem autoriza: API e checkout sempre revalidam o titular.
export function validarReferenciaPremio(ref: ReferenciaPremio, premios: Pick<Premio, "id" | "estado" | "tetoCents">[], catalogo: PizzaCatalog) {
  const premio = premios.find((p) => p.id === ref?.id && p.estado === "disponivel");
  if (!premio || !/^[a-zA-Z0-9_-]{16,100}$/.test(ref.clientRequestId)) return null;
  try { return materializarPizza(premio, ref.selecao, catalogo); } catch { return null; }
}
