# Capacidade WhatsApp e pedidos — 14/10/2026

Estado: implementação local pronta para revisão, **não aprovada para alegar 100+ operações reais na Evolution**. Branch local `feat/whatsapp-capacity-20261014`, preservando `1eef0d6`, `73a9fed`, `000f569` e `b17726b`. Nenhum deploy, merge, push ou chamada à Evolution real foi feito.

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

O ensaio separado da outbox aceitou e entregou 50/50, 100/100 e 200/200 mensagens simuladas; o limite efetivo foi **4 saídas globais** por lote. Em todos os casos, não houve duplicação. A recuperação de lease expirado marca o job como `ambiguous`; timeout, rede e 5xx também são ambíguos e nunca recebem retry automático. A cabeça da conversa permanece bloqueada para que uma mensagem posterior não a ultrapasse. Jobs ausentes sob lease viram entradas auditáveis `unresolved`, liberando somente a capacidade global. Esses resultados não medem a Evolution real.

## Auditoria de risco

- `pedidos` é um único array Redis sob mutex global. Toda criação, alteração de status e confirmação Pix concorre pelo mesmo lock, e cada gravação reescreve o array. A correção de espera reduz recusas precoces, mas não remove a serialização/O(n); com latência maior o teto de 20 s da rota de pedidos limita a capacidade.
- `whatsappOutbox` persiste o job no Redis antes do envio, tem prioridades `critica`, `normal` e `promocional`, lock por conversa, lease distribuído e teto global. `sendText` e `sendMedia` passam por ela; OTP, cron, notificações, ranking, atendimento humano e imagens usam o mesmo executor. A resposta só é `ok:true` após confirmação da Evolution; `queued_pending` não finge entrega.
- `WHATSAPP_OUTBOX_CONCURRENCY` controla leases simultâneos; `WHATSAPP_OUTBOX_RATE_LIMIT_PER_MINUTE`, quando configurado, controla separadamente o máximo distribuído por janela de 60 segundos. O padrão de velocidade é desabilitado: não foi assumido nenhum limite oficial da Evolution sem medição. A seleção percorre todos os jobs vencidos da prioridade, para que uma conversa bloqueada não esconda outra apta após uma janela fixa.
- Em Preview, texto e imagem são recusados antes de enfileirar ou executar; inclusive um callback assinado que encontre job pendente não chama a Evolution.
- Toda mensagem gerada pelo sistema marca seu `messageId` como eco antes do histórico. Eventos `fromMe` sem essa marca (por exemplo, digitados no iPhone) continuam registrados como atendimento humano.
- O worker autenticado `/api/interno/whatsapp-outbox/processar` é despertado por QStash (flow control 1). Ao receber o callback validado contra a URL canônica, ele reconcilia leases, drena até 100 jobs sem ultrapassar o lease global, persiste o histórico e agenda continuação se restar fila. A agenda QStash persistente roda a cada cinco minutos, independente dos limites do Vercel Cron; QStash é apenas despertador, não a fonte de durabilidade.
- A agenda é criada/atualizada quando há o primeiro aceite em Production. Antes da implantação é obrigatório provisionar `QSTASH_TOKEN`, as duas chaves de assinatura e `WHATSAPP_OUTBOX_CALLBACK_URL` estável (ou `VERCEL_URL` de Production). Preview é bloqueado mesmo com callback explícito. Se o primeiro agendamento falhar ou se já houver jobs antes da primeira execução, o Redis preserva os jobs, mas **não existe mecanismo somente de código que possa acordar uma serverless sem QStash/cron externo**; o operador deve criar/verificar a agenda QStash antes de liberar a mudança.
- Histórico de entrega assíncrona usa EVAL idempotente por `jobId`; uma queda entre entrega e atualização pode repetir o callback sem duplicar a conversa. O painel recebe estados separados para `queued`, `delivered`, `failed` e `ambiguous`.
- Imagens também usam a mesma outbox, prioridade, lock por conversa e teto global; os únicos requests `sendText`/`sendMedia` restantes vivem no executor interno da outbox.
- A Evolution não oferece chave de idempotência comprovada para `sendText`; timeout após envio é um resultado ambíguo. Retry automático pode duplicar mensagem e permanece proibido.
- O teste da rota usa mocks de Redis e efeitos secundários. Ele prova persistência no armazenamento simulado, **não** valida estoque, fidelidade, latência de rede, custo ou entrega real. O teste de mutex mede só a seção crítica, não checkout completo.

## Rollout seguro sem alterar o atendimento atual

O módulo `src/lib/whatsappMensagem.ts` aplica `WHATSAPP_OUTBOX_ROLLOUT`:

- **Sem configuração em Production:** modo `canary`, restrito ao número de teste já autorizado em `WHATSAPP_CANARY_PHONE`; os demais números mantêm o envio direto anterior, inclusive mensagens humanas, imagens, OTP e notificações. Se o número canário não estiver configurado, nenhuma mensagem usará a outbox.
- `WHATSAPP_OUTBOX_ROLLOUT=off`: nenhuma nova mensagem vai para a outbox. Não desliga processamento de jobs já aceitos.
- `WHATSAPP_OUTBOX_ROLLOUT=canary`: apenas o número canário autorizado.
- `WHATSAPP_OUTBOX_ROLLOUT=all`: todas as mensagens usam a outbox. **Só habilitar após prova real da agenda QStash, callback assinado, destinatário canário, painel humano, OTP e inexistência de duplicações.**
- Preview nunca utiliza o transporte real, independentemente do modo.
- Os testes usam `NODE_ENV=test` e exercitam a outbox por padrão, com casos específicos de `off` e `canary`.

**Rollback operacional:** antes de reverter um deployment que inclua o worker, **pausar/remover a agenda QStash com ID `chefebot-whatsapp-outbox-recovery-v1`** para não atingir uma rota inexistente da versão antiga a cada cinco minutos. Não apagar dados/jobs Redis; primeiro inspecionar `pending`, `inFlight`, `ambiguous` e `unresolved`. Usar rollback Vercel apenas com alias/commit corretos e verificar WhatsApp, pedidos e Pix em leitura.

**Limite de custo:** o Free QStash tem teto diário sujeito ao plano. Um schedule a cada cinco minutos dispara aproximadamente 288 vezes por dia, além dos despertares imediatos e das funções já existentes. Verificar uso real antes de `all`; não mudar para plano pago automaticamente.

## Mudança maior necessária antes da aprovação

1. Persistir a outbox na mesma transação lógica da transição de pedido/pagamento/entrega. Hoje ela persiste antes do envio, mas a transição de pedido e a criação do job ainda não são uma única operação Redis.
2. Para resultado ambíguo após timeout, consultar o estado do provider por ID/evento antes de repetir ou encaminhar à revisão humana. Sem idempotência no provider, exatamente-uma-vez não é demonstrável apenas com Redis/QStash.
3. Calibrar o limite com métricas de latência, 429/5xx e desconexões numa instância Evolution **isolada**, com destinatários de teste autorizados e sem mensagens reais a clientes. Subir 50 → 100 → 200 gradualmente e fazer ensaios de falha/reconexão. Sem essa instância/credenciais, não é possível comprovar capacidade real nem quantificar tempo de recuperação ou custo adicional. QStash, invocações Vercel e comandos Upstash terão custo dependente do volume e do plano; não há preço medido neste ambiente.
4. Rotacionar externamente a credencial Evolution historicamente exposta em um arquivo removido do HEAD; este trabalho não reescreve histórico Git nem revela o valor. A exposição deve ser tratada como comprometimento até a rotação e invalidação no provedor. Procedimento: `docs/operations/EVOLUTION_CREDENTIAL_ROTATION.md`.

## Verificação executada

Auditoria adversarial local realizada em 14/10/2026: recuperação de lease, ordem por conversa, ausência de retry para timeout/rede/5xx, expiração de OTP, pausa de promoção enfileirada, limite global, callback QStash com audience URL, Pix e histórico humano idempotente.

`npx vitest run src/lib/whatsappOutbox.test.ts src/lib/whatsappOutbox.qstash.test.ts src/lib/whatsappMensagem.test.ts src/lib/conversasHistorico.test.ts src/lib/mercadoPagoReconciliacao.test.ts src/app/api/cliente/login/route.test.ts src/app/api/conversas/enviar-mensagem-humana/route.test.ts src/app/api/interno/whatsapp-outbox/processar/route.test.ts`: **119 aprovados, 1 ignorado**. Regressões diretamente afetadas de pedido, Pix, entrega, cron, ranking e bot: **117 aprovados**. `npx tsc --noEmit` e `git diff --check`: aprovados na auditoria local.
