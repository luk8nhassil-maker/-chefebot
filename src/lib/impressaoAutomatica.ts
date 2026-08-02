import { redis } from "./redis";

// Proteção contra impressão automática duplicada do mesmo pedido — nunca
// substitui nem altera a impressão em si (a rota /pedidos/[id]/imprimir
// continua exatamente igual), só decide QUEM tem o direito de disparar o
// gatilho AUTOMÁTICO (window.print silencioso ao aceitar um pedido).
//
// Por que persistente em vez de em memória: duas abas do painel (ou dois
// dispositivos) podem estar olhando o mesmo pedido "novo" e clicar em
// "aceitar" quase ao mesmo tempo — cada uma roda seu próprio processo de
// navegador, então qualquer guarda em memória (useRef, variável de módulo)
// só protege a própria aba. Um SET NX no Redis é a única forma de garantir
// que, entre todos os concorrentes possíveis, só um recebe o direito de
// imprimir automaticamente — mesmo sob concorrência real, mesmo depois de
// reiniciar o servidor.
//
// A reimpressão manual (botão "Imprimir" em /pedidos, sempre visível) NUNCA
// passa por aqui: ela é uma ação explícita e autorizada da atendente, não o
// disparo automático que este módulo protege.

function chaveClaimImpressaoAutomatica(pedidoId: string): string {
  return `pedido:auto-print-claim:${pedidoId}`;
}

/**
 * Reivindica, de forma atômica e permanente, o direito de disparar a
 * impressão automática deste pedido. `true` só para quem chega primeiro —
 * todo mundo depois (outra aba, outro dispositivo, um retry) recebe `false`
 * e não deve chamar a impressão silenciosa de novo. Nunca expira: o mesmo
 * evento automático (aceite novo → em_preparo) só acontece uma vez na vida
 * do pedido.
 */
export async function reivindicarImpressaoAutomatica(pedidoId: string): Promise<boolean> {
  const ok = await redis.set(chaveClaimImpressaoAutomatica(pedidoId), String(Date.now()), { nx: true });
  return !!ok;
}
