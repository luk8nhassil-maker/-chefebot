import { redis } from "@/lib/redis";

const CHAVE_JANELA = "whatsapp:rebuild:janela";
const JANELA_SEGUNDOS = 15 * 60; // 15 minutos
const MAX_TENTATIVAS_NA_JANELA = 2;

/**
 * Rate limit simples de janela fixa para a ação destrutiva de reconstrução:
 * no máximo 2 reconstruções a cada 15 minutos, independente de quem chama —
 * evita reconstruções em sequência por engano/script, sem precisar de um
 * limitador genérico só pra isso.
 */
export async function podeReconstruir(): Promise<{ permitido: true } | { permitido: false; tentativasNaJanela: number }> {
  const tentativas = (await redis.get<number>(CHAVE_JANELA)) || 0;
  if (tentativas >= MAX_TENTATIVAS_NA_JANELA) {
    return { permitido: false, tentativasNaJanela: tentativas };
  }
  return { permitido: true };
}

export async function registrarTentativaReconstrucao(): Promise<void> {
  const tentativas = (await redis.get<number>(CHAVE_JANELA)) || 0;
  await redis.set(CHAVE_JANELA, tentativas + 1, { ex: JANELA_SEGUNDOS });
}
