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

const CLAIM_ID_PEDIDO_TTL_SEGUNDOS = 5;
const MAX_TENTATIVAS_ID_PEDIDO = 5;

// Gera o `id` de um pedido — chave usada em TODA busca/atualização de status
// (PATCH, notificação, mutex de edição, etc.), portanto é o único campo cuja
// colisão pode fazer o sistema resolver o pedido ERRADO. `Date.now().toString()`
// sozinho tem resolução de 1ms e não garante unicidade sob criação concorrente
// (dois clientes finalizando pedido no mesmo milissegundo) — a raiz comprovada
// da mistura de nome/telefone entre clientes nas notificações de status.
//
// Reivindicação atômica (SET NX, mesmo padrão já usado para idempotência de
// mensagem do WhatsApp em src/app/api/whatsapp/route.ts): no caso comum (sem
// colisão) o id retornado é EXATAMENTE `Date.now().toString()`, idêntico ao
// comportamento anterior — não muda formato nem tamanho do id em nenhum fluxo
// existente (ordenação em timestampOrdenacaoPedido, txid do Pix em
// gerarTxidPixInterno, etc.). Só no caso raro de colisão real o id ganha um
// dígito extra de desempate, ainda como string puramente numérica.
export async function gerarIdPedidoUnico(): Promise<string> {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_ID_PEDIDO; tentativa++) {
    const candidato = tentativa === 0 ? Date.now().toString() : `${Date.now()}${tentativa}`;
    const reivindicado = await redis.set(`pedido_id_claim:${candidato}`, 1, {
      nx: true,
      ex: CLAIM_ID_PEDIDO_TTL_SEGUNDOS,
    });
    if (reivindicado) return candidato;
  }
  // Praticamente inalcançável (5 colisões consecutivas no mesmo milissegundo):
  // ainda assim nunca devolve um id sem tentar garantir unicidade.
  return `${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
}
