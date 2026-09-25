// Rastreia o "último nível conhecido" só para disparar o fato "nivel_subiu"
// uma única vez por nível — o próprio nível em si é sempre recalculado ao
// vivo a partir do XP (calcularNivelChef, puro), nunca fica desatualizado
// aqui; este módulo só existe para saber "isso é novidade?" na hora de
// decidir se dispara o fato de negócio.
import "server-only";
import { redis } from "./redis";
import { registrarFatoRankingGamificacao } from "./rankingGamificacaoFatos";

function chave(tenantId: string, clienteId: string): string {
  return `ranking:nivelChef:ultimo:${tenantId}:${clienteId}`;
}

export async function sincronizarNivelChefCliente(
  tenantId: string,
  clienteId: string,
  nivelAtual: number,
): Promise<void> {
  if (!tenantId || !clienteId || !Number.isFinite(nivelAtual) || nivelAtual <= 0) return;
  const ultimo = await redis.get<number>(chave(tenantId, clienteId));
  if (ultimo !== null && ultimo >= nivelAtual) return;
  await redis.set(chave(tenantId, clienteId), nivelAtual);
  await registrarFatoRankingGamificacao("nivel_subiu", `${clienteId}:${nivelAtual}`);
}
