import { redis } from "./redis";

// Gera o número sequencial do pedido para o dia atual (1, 2, 3...).
// Usa INCR atômico no Redis — seguro mesmo se dois pedidos chegarem ao mesmo tempo.
// A chave inclui a data (America/Sao_Paulo) para resetar naturalmente todos os dias.
// O cron das 3am também limpa essa chave explicitamente (ver /api/cron), então o reset
// acontece tanto pela troca de data quanto por limpeza ativa — não depende de timestamp nem de ID aleatório.
export async function proximoNumeroPedido(): Promise<number> {
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }); // ex: "17/06/2026"
  const chave = `contador_pedidos:${hoje}`;
  const numero = await redis.incr(chave);
  // Garante que a chave não fique acumulando para sempre (expira em 36h, bem depois do reset das 3am)
  if (numero === 1) {
    await redis.expire(chave, 60 * 60 * 36);
  }
  return numero;
}
