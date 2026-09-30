# Política de timeout Pix Mercado Pago — 6/13 minutos

## Objetivo

Pedidos novos com cobrança Pix Mercado Pago ainda não confirmada recebem um aviso no marco de 6 minutos. No marco de 13 minutos, o sistema tenta encerrar a cobrança pendente no Mercado Pago e só então cancela o pedido local.

## Regras

- Aplica somente a `pix.provider === "mercadopago"`, com `providerPaymentId`, pedido `novo` e Pix não confirmado.
- Pix manual/comprovante não entra nesta automação.
- 6 minutos: consulta o estado oficial; se ainda estiver pendente, envia um único aviso ao cliente.
- 13 minutos: tenta cancelar a cobrança no Mercado Pago. O pedido local só é cancelado quando o provider confirmou cancelamento ou estado não cobravel.
- Se o provider indicar pagamento aprovado, a conciliação oficial é acionada e o pedido nunca é cancelado por tempo.
- Timeout, rate limit, falha de rede ou estado ambíguo nunca cancelam o pedido às cegas; o sistema agenda retry curto.
- A mudança local para `cancelado` é atômica e revalida o estado fresco do pedido, protegendo corrida com webhook/conciliação.
- O cancelamento preserva as compensações necessárias de pontos, resgate e Jornada do Chef.

## Orquestração

O caminho principal é a cadeia QStash já existente do Guardião Pix. O agendamento é limitado para nunca pular os marcos de 6 e 13 minutos. O Guardião acionado pelo painel executa a mesma política como fallback operacional.

## Painel e impressão

A transição `novo -> em_preparo` continua persistindo primeiro. A notificação de WhatsApp dessa transição passa a executar depois da resposta HTTP, evitando que a latência da Evolution segure o botão do painel e a entrega do campo `podeImprimirAutomaticamente` que dispara o iframe de impressão já existente.

## Rollback

Reverter este conjunto restaura a cadência anterior sem remover o conciliador, webhook, Guardião, Pix manual ou reimpressão manual.
