# Proteções operacionais e modos de falha — ChefeBot

As seções 1-3 abaixo foram **implementadas na Etapa C** (ver
`REDIS_TELEMETRY.md` para o desenho completo e
`docs/operations/REDIS_RUNBOOK.md` para os procedimentos operacionais) — o
texto foi atualizado para refletir o que existe de fato, não mais só
projeto. As seções 4 em diante permanecem como projeto, para as Etapas D e I
(dependem de PostgreSQL, ainda não iniciado).

## 1. Health check independente — implementado

Diferente do desenho original (endpoints `/api/health/*` públicos), a
implementação real ficou sob `/api/dev/*` com a mesma proteção de role
`dev`/`admin` já usada por `/api/dev/mcp` — decisão de segurança tomada
durante a implementação (health check pode expor detalhe técnico interno,
mesmo sanitizado, e não há necessidade comprovada de monitor externo
público nesta etapa):

- `GET /api/dev/health` (`src/app/api/dev/health/route.ts`) — agrega 3
  checagens isoladas (`src/lib/healthChecks.ts`): `checkRedisHealth()`
  (leitura trivial `GET healthcheck:probe`, timeout 1500ms, classifica
  cota/timeout/rede), `checkWhatsappHealth()` (só confirma
  `obterConfigEvolution() !== null`, sem chamada de rede), `checkOrdersHealth()`
  (confirma que a chave `pedidos` é legível e tem formato de array). Nenhuma
  chamada à Evolution API ou ao Mercado Pago pela rede.
- `GET /api/dev/redis-status` (`src/app/api/dev/redis-status/route.ts`) —
  mesmas 3 checagens + telemetria agregada + avaliação de alerta, tudo numa
  resposta. A falha de um componente nunca mascara nem impede a checagem
  dos outros (`Promise.all` + checagem síncrona isolada).
- **Não existe** health check de PostgreSQL — não há PostgreSQL nesta etapa
  (Etapa D ainda não iniciada).

## 2. Monitor de uso de comandos Redis — implementado

- `src/lib/redisTelemetry.ts`: wrapper `Proxy` transparente em volta do
  client `@upstash/redis` (aplicado uma única vez em `src/lib/redis.ts`,
  nenhum outro arquivo mudou). Classifica cada comando por **grupo de chave**
  (`orders`, `whatsapp`, `loyalty`, `pix_coordination`, `mcp`, `config`,
  `push`, `orders_lock`, `other`) — não por rota HTTP (decisão de segurança
  de escopo, ver `REDIS_TELEMETRY.md` seção 6 para a justificativa completa
  de por que isso evita tocar em `orders/route.ts`/`whatsapp/route.ts`).
- Contadores vivem em memória por processo; persistência é amostrada por
  probabilidade (padrão 5%, `REDIS_TELEMETRY_SAMPLE_PROBABILITY`) — nunca 1
  gravação por comando observado. Overhead estimado: ~2-3% de comandos
  adicionais sobre o volume real (cálculo em `REDIS_TELEMETRY.md` seção 5).
- Painel: `/dev/redis-status` (mesmo padrão de proteção de `/dev/mcp`) —
  mostra uso estimado do mês, saúde dos 3 componentes, e grupos com maior
  consumo na invocação atual. Sem polling automático (atualização manual).
- **Limitação documentada:** não existe leitura do uso OFICIAL da Upstash a
  partir do runtime (exigiria a Management API deles) — todo número do
  painel é `fonte: "estimativa_interna"`. O número oficial continua sendo
  conferido manualmente no console da Upstash (procedimento no runbook).

## 3. Alertas em 50%, 70%, 85%, 95%, 100% da cota — parcialmente implementado

- `src/lib/redisUsageAlerts.ts`: limiares configuráveis por env var
  (`REDIS_USAGE_ALERT_50`/`_70`/`_85`/`_95`/`_100`, todos habilitados por
  padrão), avaliados contra `REDIS_MONTHLY_COMMAND_LIMIT` (padrão 500.000).
- Ao cruzar um limiar pela primeira vez no ciclo mensal, `/api/dev/redis-status`
  registra via `console.error` (visível nos runtime logs da Vercel) e marca
  dedup em Redis (`telemetry:redis:alerta-marcado:{limiar}:{ciclo}`, TTL até
  o fim do ciclo) — nunca loga o mesmo limiar duas vezes no mesmo mês.
- **Não implementado nesta etapa: notificação externa real** (push/e-mail/
  WhatsApp). Não existe canal de notificação operacional integrado ao
  projeto hoje — isso fica como pendência explícita, documentada, não
  implementada por engano. Até existir, o alerta só é visível para quem
  olha o painel ou os runtime logs ativamente (ver runbook, seção 3).

## 4. Alerta de falha de persistência

- Toda escrita crítica (pedido, mensagem, transação de fidelidade) que falhar — Redis ou Postgres — deve registrar em `audit_log`/log estruturado com `action` explícito de falha, nunca engolir silenciosamente. Isso já é parcialmente verdade hoje (vários `catch` com `console.error`), mas não há agregação/alerta sobre esses logs.
- Job periódico (ou integração com o mesmo alerta de cota) varre logs de erro recentes (`mcp:log:erros` hoje, ou a tabela `audit_log` no futuro) por padrão de falha de persistência e dispara alerta se a taxa de erro cruzar um limiar (ex. >5 falhas de escrita em 10 minutos).

## 5. Fila de mensagens pendentes + Dead-letter queue

Implementadas via `whatsapp_outbox` (ver `DATABASE_MIGRATION_PLAN.md` seção 1.8):

- **Fila de pendentes:** `select * from whatsapp_outbox where status in ('pending','failed') and next_attempt_at <= now() order by next_attempt_at limit N` — consumida por um worker (cron/QStash) que tenta enviar via Evolution API.
- **Dead-letter:** quando `attempts >= max_attempts`, o registro vira `status = 'dead_letter'` em vez de continuar tentando para sempre. Uma tela/endpoint `/dev/outbox` (mesmo padrão dos outros painéis de debug) lista os `dead_letter` para intervenção manual — nunca são apagados automaticamente.

## 6. Retry com backoff e jitter

- Mesmo padrão matemático já usado no Sentinela Pix (`pixSentinela.ts:backoffMs`, multiplicador exponencial com teto) — reaproveitar a função, não reinventar. Adição de **jitter** (aleatoriedade de ±20% no delay calculado) para evitar que múltiplas mensagens falhadas ao mesmo tempo (ex. Evolution API caiu por 1 minuto) tentem novamente todas no mesmo instante exato.
- `next_attempt_at = now() + jitter(backoff(attempts))`, coluna já prevista em `whatsapp_outbox`.

## 7. Idempotência de webhook

Já parcialmente implementada hoje via `idempotencyKey` no Redis (`whatsapp/route.ts:959-961`, TTL 24h) — mas com uma lacuna: se o Redis estiver indisponível no momento exato do `GET`/`SET` dessa chave, não há fallback, e o comportamento sob falha não foi confirmado nesta auditoria (fora do escopo verificar o `try/catch` exato deste trecho sem alterar código).

Proposta de reforço, sem alterar o comportamento atual enquanto não implementado: `whatsapp_inbound_events.message_id unique` no Postgres vira a segunda camada de dedup — mesmo que o Redis esteja indisponível e deixe passar, o `insert ... on conflict (message_id) do nothing` no Postgres barra o reprocessamento antes de qualquer efeito colateral (resposta duplicada, crédito duplicado). Isso só entra em vigor na Etapa I.

## 8. Métricas de latência e erro

- Cada chamada ao Redis e ao Postgres, via os wrappers (`redisMetrics.ts` e o client de banco da Etapa D), registra `{operation, latencyMs, success}`.
- Agregação simples (p50/p95/p99 por rota) exposta no mesmo painel operacional da seção 9 — não é objetivo deste programa introduzir uma stack de observability completa (Datadog/Grafana), e sim o mínimo funcional dentro do próprio app, reaproveitando o padrão que o MCP (`mcp:log:*`) já usa.

## 9. Painel operacional simples

`/dev/status` (novo, ou extensão de `/dev/mcp` existente) mostrando, sem exigir infraestrutura nova:

- Status dos 2 health checks (seção 1);
- Uso de cota Redis do mês (seção 2/3);
- Tamanho da fila `whatsapp_outbox` por status (pending/failed/dead_letter);
- Últimos 20 erros de persistência (seção 4);
- Latência p95 das últimas N chamadas a Redis/Postgres (seção 8).

Protegido pelo mesmo mecanismo de auth já usado pelos endpoints `/api/dev/*` existentes — nunca público.

## 10. Modo degradado — o que acontece quando cada componente cai

| Componente indisponível | Pedidos (painel `/pedidos`) | WhatsApp (bot) | Pix Mercado Pago |
|---|---|---|---|
| **Redis cai** | Se pedidos já migrou para Postgres (Etapa G+): painel continua funcionando para leitura/escrita de pedido; só `session:*`/locks ficam indisponíveis, então edição concorrente de pedido pelo cliente perde a proteção de mutex temporariamente — degradação aceitável, não perda de dado. Antes da Etapa G: painel fica completamente fora (é o incidente atual). | Sessão de conversa (`session:*`) se perde — bot trata cada mensagem como conversa nova (pior experiência, não é perda de pedido já feito, pois pedido já migrado vive no Postgres). Idempotência de webhook cai para a segunda camada (Postgres, ver seção 7) se já implementada; senão, risco de duplicar processamento. | **Nenhuma mudança de comportamento — fluxo Pix não foi alterado por este programa.** O que hoje depende de Redis no Pix (Sentinela, cooldowns) continua exatamente como está, com os mesmos riscos/comportamento de hoje sob falha de Redis — este documento não estende nem reduz essa superfície. |
| **PostgreSQL cai** (só relevante após Etapas E+) | Modo degradado explícito: sistema detecta falha de escrita no Postgres e **nunca finge sucesso** — response HTTP reflete erro real (mesma regra já seguida para o incidente Redis: "erro de infraestrutura não pode deixar a interface fingir que atualizou"). Dual-write (Etapa E-F) permite fallback de leitura pro Redis enquanto ele ainda espelha; pós-Etapa K (sem espelho), painel fica indisponível para escrita até o banco voltar — comunicado claramente ao atendente, nunca silencioso. | Mensagens continuam sendo processadas pelo bot usando `session:*` do Redis (não depende de Postgres para a conversa em si); só o registro permanente (`whatsapp_inbound_events`/`messages`) fica pendente — acumula na Outbox/fila de entrada até o banco voltar, nunca se perde (fila em memória do Redis como buffer temporário, se necessário, ou apenas retry do próprio evento de webhook, já que provedores de WhatsApp reentregam webhooks não confirmados). | Sem mudança — Pix não depende de Postgres neste programa. |
| **WhatsApp API (Evolution) cai** | Sem efeito direto no painel de pedidos em si; notificações de status ao cliente (`notificarCliente`) falham silenciosamente hoje (`try/catch` com `console.error`, sem fila) — na visão alvo, essas notificações passam a entrar na `whatsapp_outbox` e são reentregues automaticamente quando a API voltar, em vez de se perderem. | Bot não consegue enviar nem receber; mensagens inbound que chegarem via webhook continuam sendo registradas em `whatsapp_inbound_events` (Etapa I) mesmo sem conseguir responder — nada se perde, só atrasa. Outbox acumula pendências e drena com retry/backoff quando a API normalizar. | Notificação de confirmação de Pix ao cliente (mensagem de "pagamento recebido") teria o mesmo destino de fila/retry, MAS a confirmação do pagamento em si (webhook/polling do Mercado Pago) é **independente** do WhatsApp e não foi alterada — o pedido é confirmado corretamente mesmo que o aviso ao cliente atrase. |
| **Mercado Pago indisponível** | Sem efeito em pedidos não-Pix. Pedidos Pix ficam com status pendente até o Mercado Pago voltar — comportamento **inalterado** por este programa, que não toca no fluxo Pix. | Sem efeito direto. | **Fora do escopo de mudança deste programa.** O comportamento sob indisponibilidade do Mercado Pago é o que já existe hoje (Sentinela com backoff, cooldown, etc.) — nenhuma proposta aqui adiciona, remove ou altera esse comportamento. |

### Princípio geral do modo degradado

Em toda combinação de falha, a regra é a mesma já aplicada no incidente atual:
**nunca reportar sucesso quando a escrita não aconteceu de verdade.** Onde uma
fila/outbox absorve a falha (WhatsApp saindo, notificação), o usuário final
(atendente ou cliente) deve ver um estado "pendente" explícito, nunca um
silêncio que pareça sucesso.
