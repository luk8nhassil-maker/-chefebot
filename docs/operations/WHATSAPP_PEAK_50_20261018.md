# ChefeBot — preparo para pico de 50 mensagens (18/10/2026)

## Escopo e invariantes
- Continuar na Evolution v2.3.7; nenhuma migração para API oficial.
- Meta: aceitar duravelmente 50 mensagens juntas, sem corrida de sessão nem
  duplicação cega de efeitos comerciais. Responder com concorrência controlada
  (50 chegadas não implicam 50 envios simultâneos).
- Não chamar Evolution real em teste de carga, não publicar preview pago.
- Não ativar bot global nem reconfigurar PIX/pedidos.
- Preservar Redis e quarentenas em rollback; nunca usar FLUSHDB.

## O que o PR #502 prepara
- Mutex distribuído por telefone no processamento legado.
- Inbox Redis em `src/lib/whatsappInbox.ts`: enfileiramento atômico Lua,
  dedupe por telefone/messageId, sequência global, fila por conversa,
  limite 1000, lease de 90s e quarentena sem retry automático de efeitos
  desconhecidos.
- `/api/whatsapp` faz enqueue + HTTP 200 apenas após Redis aceitar o job.
  Processamento comercial segue o código original no worker.
- Worker QStash assinado `/api/interno/whatsapp-inbox/processar`, até 4
  eventos paralelos, nunca duas mensagens da mesma conversa simultaneamente.
- Wake QStash best-effort e recuperação periódica a cada 5min (288 execuções
  previstas/dia se o cron estiver ativo; confirmar quota e cobrança Upstash).
- `/api/dev/whatsapp/inbox-status`: painel técnico somente leitura com
  contagem da fila e incidentes de ambiguidade.

## Como funciona o rollout
`WHATSAPP_INBOX_ROLLOUT` permanece AUSENTE/OFF por padrão. O sistema
continua no caminho antigo até ativação controlada. Para ligar só após
aprovação de critérios abaixo:
- `WHATSAPP_INBOX_ROLLOUT=all` (inbox entrada).
- `WHATSAPP_OUTBOX_ROLLOUT=all` (fila saída); default ainda canário.
- `WHATSAPP_OUTBOX_CONCURRENCY=4` (já é default).
- Verificar `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`,
  `QSTASH_NEXT_SIGNING_KEY` e `WHATSAPP_OUTBOX_CALLBACK_URL`, cujo caminho
  deve ser `/api/interno/whatsapp-outbox/processar`. A inbox deriva seu
  callback do mesmo domínio, sem nova credencial.

Se falta a configuração QStash, o webhook mantém o processamento legado,
registrando erro sanitizado. `inbox-status` mostra `active=false`.
Não tratar `WHATSAPP_INBOX_ROLLOUT=all` como garantia se active=false.

## Evidências disponíveis hoje
- Teste canário real anterior: Evolution HTTP 201, chegada no WhatsApp
  Business, inbound `CBTEST-ELS8` e resposta automática às 19:00.
- Simulação local independente de mutex (node --test):
  4 testes aprovados em 18/10, 50 contatos paralelos,
  8 eventos da mesma conversa serializados, token de dono protegido e
  contenção falhando fechado. **Não é teste de integração Next.js**.
- Vitest no repositório: `whatsappInboundMutex.test.ts`,
  `whatsappInbox.test.ts` e `whatsappOutbox.test.ts` com cargas 50/100/200
  e falhas. **Novos testes ainda precisam executar com dependências
  instaladas em ambiente isolado**; não afirmar aprovação sem logs.
- Auditoria da produção: deploy anterior READY `2581f713`, bot global
  PAUSADO. Este PR não altera produção.

## Bloqueadores antes de dizer '50 em produção aprovado'
1. Executar Vitest focado em ambiente com Node + dependências (não CI pago).
2. Executar TypeScript/build local e sanar erros novos sem mascarar falhas legadas.
3. Rodar 50/100/200 POSTs sintéticos contra Next local com Redis descartável,
   QStash mock e Evolution mock. Medir HTTP accepted, p95, throughput,
   fila final 0, 0 inconsistências, 0 pedidos/Pix duplicados.
4. Teste adversarial: 20 eventos mesma conversa, múltiplos pedidos,
   comprovante Pix, fallbacks, 400/429/5xx, Redis down, worker morto.
5. Conferir `/api/dev/whatsapp/inbox-status` e métricas de outbox com
   `ambiguous=0`, `unresolved=0`. Quarentenas exigem inspeção humana.
6. Só então consolidar uma publicação autorizada e um canário mínimo.

## Riscos residuais explícitos
- Evolution API Node não possui garantia de retry em 503 estabelecida aqui.
  A inbox evita 503 por *ocupação normal*, mas 503 por Redis indisponível ou
  fila 1000 cheia ainda pode resultar em perda na origem. Alertar.
- Redis pode aceitar e QStash falhar: payload persiste; recuperação depende
  de cron QStash ativo, sem o qual o atendimento pode ficar parado.
- Lease vencido fica AMBIGUOUS e bloqueia a conversa até reconciliação;
  não existe reenvio automático porque poderia duplicar pedido ou Pix.
- 50/100/200 testes sintéticos não provam limite de um número WhatsApp não oficial
  nem estabilidade da instância Railway sob pico real.
- Campos e estados do handler comercial grande permanecem legados; comprovar
  idempotência de efeitos comerciais no teste de integração antes de ativar.

## Ponto conhecido de rollback
Produção validada antes deste PR: `2581f713be8f4a1260a43b9c1de3b10d0fbe6a38`.
Rollback altera somente código. Não apagar `pedidos`, `session:*`,
`whatsapp:inbox:*`, `whatsapp:outbox:*` ou quarentena.

## Fontes de arquitetura
- https://docs.evolutionfoundation.com.br/evolution-api/configuration/webhooks
- https://redis.io/docs/latest/commands/set/
- https://redis.io/docs/latest/develop/programmability/eval-intro/
- https://upstash.com/docs/qstash/features/flowcontrol
- https://upstash.com/docs/qstash/features/retry
