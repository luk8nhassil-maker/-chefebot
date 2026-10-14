# Capacidade WhatsApp e pedidos — 14/10/2026

Estado: implementação local pronta para revisão, **não aprovada para alegar 100+ operações reais na Evolution**. Branch local `feat/whatsapp-capacity-20261014`, baseada em `73a9fed` e `1eef0d6`. Nenhum deploy, merge ou chamada à Evolution real foi feito.

## Evidência medida

Com `CHEFEBOT_CAPACITY_BENCH=1`, os testes opt-in exercitam a rota de criação e o mutex com Redis em memória. Os números são de simulação, não de Upstash ou Evolution em produção. Latências são por operação; p95 é o índice `ceil(0,95*n)-1` das latências ordenadas.

| Ensaio | Operações | Persistidos/aceitos | Falhas | Média | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rota de pedido, Redis sem latência de rede | 50 | 50 | 0 | 130 ms | 151 ms |
| Rota de pedido, Redis sem latência de rede | 100 | 100 | 0 | 146 ms | 190 ms |
| Rota de pedido, Redis sem latência de rede | 200 | 200 | 0 | 273 ms | 333 ms |
| Mutex, 5 ms/comando | 50 | 50 | 0 | 540 ms | 1199 ms |
| Mutex, 5 ms/comando | 100 | 100 | 0 | 1023 ms | 2223 ms |
| Mutex, 5 ms/comando | 200 | 200 | 0 | 2039 ms | 4843 ms |
| Mutex, 10 ms/comando | 50 | 50 | 0 | 1092 ms | 2519 ms |
| Mutex, 10 ms/comando | 100 | 100 | 0 | 2145 ms | 5062 ms |
| Mutex, 10 ms/comando | 200 | 200 | 0 | 4105 ms | 9437 ms |
| Mutex, 20 ms/comando | 50 | 50 | 0 | 2112 ms | 5272 ms |
| Mutex, 20 ms/comando | 100 | 100 | 0 | 4227 ms | 9623 ms |
| Mutex, 20 ms/comando | 200 | 165 | 35 | 6806 ms dos êxitos | 14189 ms dos êxitos |

Antes da correção, com 5 ms/comando, o mutex persistiu 50/50, mas só 50/100 no segundo patamar: o orçamento antigo de ~1 segundo expirava. O backoff reduz a rajada, mas **não é a solução estrutural**: o array global continua serializando as gravações. O limite medido é 100 a 20 ms simulados; 200 falha nesse cenário, sempre com erro explícito e sem aceite silencioso. Pedidos duplicados nos patamares bem-sucedidos: zero.

O ensaio separado da outbox aceitou e entregou 50/50, 100/100 e 200/200 mensagens simuladas; o limite efetivo foi **4 saídas globais** por lote. Em todos os casos, não houve duplicação. A recuperação de lease expirado marca o job como `ambiguous`; timeout, rede e 5xx também são ambíguos e nunca recebem retry automático. O job fica preservado por sete dias para reconciliação. Esses resultados não medem a Evolution real.

## Auditoria de risco

- `pedidos` é um único array Redis sob mutex global. Toda criação, alteração de status e confirmação Pix concorre pelo mesmo lock, e cada gravação reescreve o array. A correção de espera reduz recusas precoces, mas não remove a serialização/O(n); com latência maior o teto de 20 s da rota de pedidos limita a capacidade.
- `whatsappOutbox` persiste o job no Redis antes do envio, tem prioridades `critica`, `normal` e `promocional`, lock por conversa, lease distribuído e teto global. `sendText` passa por ela; OTP, cron, notificações, ranking e atendimento humano foram migrados. A resposta só é `ok:true` após confirmação da Evolution; `queued_pending` não finge entrega.
- O worker autenticado `/api/interno/whatsapp-outbox/processar` pode ser despertado por QStash (flow control 1); QStash é apenas despertador, não a fonte de durabilidade. Sem token/callback o dreno síncrono ainda processa uma tarefa por chamada, mas recuperação autônoma depende da configuração do worker.
- Imagens também usam a mesma outbox, prioridade, lock por conversa e teto global; os únicos requests `sendText`/`sendMedia` restantes vivem no executor interno da outbox.
- A Evolution não oferece chave de idempotência comprovada para `sendText`; timeout após envio é um resultado ambíguo. Retry automático pode duplicar mensagem e permanece proibido.
- O teste da rota usa mocks de Redis e efeitos secundários. Ele prova persistência no armazenamento simulado, **não** valida estoque, fidelidade, latência de rede, custo ou entrega real. O teste de mutex mede só a seção crítica, não checkout completo.

## Mudança maior necessária antes da aprovação

1. Persistir a outbox na mesma transação lógica da transição de pedido/pagamento/entrega. Hoje ela persiste antes do envio, mas a transição de pedido e a criação do job ainda não são uma única operação Redis.
2. Registrar um evento de conversa/eco para mensagens recuperadas assincronamente, antes de expor esse modo a atendimento humano.
3. Para resultado ambíguo após timeout, consultar o estado do provider por ID/evento antes de repetir ou encaminhar à revisão humana. Sem idempotência no provider, exatamente-uma-vez não é demonstrável apenas com Redis/QStash.
4. Calibrar o limite com métricas de latência, 429/5xx e desconexões numa instância Evolution **isolada**, com destinatários de teste autorizados e sem mensagens reais a clientes. Subir 50 → 100 → 200 gradualmente e fazer ensaios de falha/reconexão. Sem essa instância/credenciais, não é possível comprovar capacidade real nem quantificar tempo de recuperação ou custo adicional. QStash, invocações Vercel e comandos Upstash terão custo dependente do volume e do plano; não há preço medido neste ambiente.

## Verificação executada

`npx vitest run src/lib/whatsappOutbox.test.ts src/lib/whatsappMensagem.test.ts src/lib/pedidosConcorrencia.test.ts src/app/api/pedido-app/route.test.ts src/app/api/conversas/enviar-mensagem-humana/route.test.ts src/app/api/cron/sessoes/route.test.ts src/app/api/cron/pix-pendente/route.test.ts src/app/api/orders/route.notificacaoStatus.test.ts`: 219 aprovados, 3 benchmarks opt-in ignorados. `npx tsc --noEmit`: aprovado. `git diff --check`: aprovado.
