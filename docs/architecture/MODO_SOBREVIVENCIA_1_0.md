# Modo Sobrevivência 1.0 — auditoria (Etapa 0) e arquitetura

Este documento é o relatório obrigatório da Etapa 0 (auditoria) do programa
"Modo Sobrevivência 1.0", conforme exigido antes de qualquer implementação,
mais o registro da arquitetura conforme as etapas seguintes forem
implementadas. Objetivo do programa: manter a pizzaria capaz de receber
pedidos com segurança quando Redis, Railway, Evolution API, Vercel, Mercado
Pago ou outro serviço externo estiver lento, limitado ou indisponível — sem
contratar nenhum serviço pago, sem alterar plano, sem ativar recurso com
cobrança.

## 1. Estado atual (auditoria)

### 1.1 Fluxo de criação de pedido

- O checkout real do cliente não vive em `src/app/pedido/page.tsx` (só um
  wrapper que carrega o cardápio) — vive inteiro em
  `src/app/cardapio/page.tsx` (componente `PublicCardapio`, função `finish()`).
- `finish()` monta o payload e faz `fetch("/api/pedido-app", { method: "POST", ... })`
  **sem `AbortController`, sem timeout, sem retry automático**. Em caso de
  sucesso (`data.ok`), só então limpa o rascunho e mostra a confirmação —
  **não há sucesso otimista**, isso já é seguro.
- Em caso de **erro de rede** (`catch` do fetch), a UI mostra só "Sem
  conexão. Tente de novo." — não há diferenciação entre "o servidor nunca
  recebeu a requisição" e "o servidor processou mas a resposta não chegou".
  Reenviar manualmente nesse caso cria um **segundo pedido genuíno**, porque:
- `POST /api/pedido-app` (`src/app/api/pedido-app/route.ts`) **não tinha
  nenhuma forma de idempotência na criação** antes deste programa. O
  `pedidoId` era gerado como `Date.now().toString()`, sem checagem de
  duplicidade contra tentativas recentes. (Idempotência já existia, mas só
  no fluxo de *edição* de pedido, `[id]/editar/salvar/route.ts` — não na
  criação.)
- `pedidos` é uma única chave Redis (`String`, array JSON completo),
  lida e regravada por inteiro a cada criação (`redis.get("pedidos")` →
  `redis.set("pedidos", [...pedidos, novoPedido])`) — sem lock de escrita
  próprio (diferente de `pedido:edit:mutex:{id}`, que protege só edição).
  Falha de persistência já retorna erro real (nunca finge sucesso).
- O carrinho já tinha rascunho persistido (`sessionStorage`, chave
  `cf_draft`), mas **sem schema versionado e sem expiração explícita**, e
  **não sobrevive ao fechamento do navegador** (`sessionStorage`).

### 1.2 Infraestrutura e resiliência já existentes

- **Redis**: cliente único (`src/lib/redis.ts`, `@upstash/redis`, REST/HTTP,
  sem conexão persistente). Nenhum timeout/circuit breaker genérico —
  timeout curto (1.5s) só existe isolado em `src/lib/healthChecks.ts` e em
  `src/mcp/lib/withTimeout.ts` (exclusivo do MCP).
- **Circuit breaker**: existe **um só**, `src/mcp/lib/circuitBreaker.ts`,
  protegendo exclusivamente o enfileiramento de eventos do MCP Observador
  (`eventTap.ts`). Estado em memória do processo, 5 falhas consecutivas → 1
  min aberto → meio-aberto. Confirmado no PR #250
  (`docs/architecture/MCP_OBSERVADOR_CAPACIDADE.md`). Não protege pedidos,
  sessão, Pix nem Evolution.
- **MCP Observador**: fail-open por desenho (roda via `after()`,
  fire-and-forget, depois da resposta ao cliente já ter sido enviada) — bom
  modelo de referência de isolamento, mas não diretamente reaproveitável
  para pedidos/Pix/Evolution (que são síncronos).
- **Monitor Railway** (`src/infra/railway/*`, `docs/operations/railway-infra-monitor.md`):
  observacional (uso de volume Postgres, status simplificado de Evolution/Redis),
  roda via GitHub Actions a cada 6h, namespace Redis isolado
  (`infra:railway:*`), gated por `DEV_INFRA_MONITOR_ENABLED`. Não aciona
  nenhuma ação automática hoje.
- **Health checks**: `/api/dev/health` agrega Redis/WhatsApp(config)/Pedidos,
  nunca chama Evolution ou Mercado Pago pela rede (decisão deliberada, para
  não gastar cota de terceiros). Protegido por role `dev`/`admin`.
- **Evolution API**: sem retry, sem circuit breaker, sem fila. Falha de
  envio de notificação ao cliente é silenciosa (`console.error` apenas).
  Reconexão de QR é manual, via painel `/dev/whatsapp`.
- **Mercado Pago / Pix**: a área **mais madura** de resiliência manual do
  projeto — timeout de 5s por consulta (`AbortController`), lock distribuído
  (Redis `SET NX EX`), cooldown de rate limit, cooldown por pedido,
  concorrência limitada, Guardião Pix com recuperação automática limitada
  (sem loop infinito). Tudo local ao domínio Pix, não genérico.
- **Feature flags**: não existe um sistema central. Duas env vars lidas
  ad-hoc: `MCP_MODE` e `DEV_INFRA_MONITOR_ENABLED`, padrão
  `process.env.X === "true"` verificado em cada call site.
- **WhatsApp oficial**: número da pizzaria vem sempre de `config:pizzaria`
  (Redis, campo `whatsappPizzaria`), nunca hardcoded no fluxo de pedido —
  já existe um padrão pronto de fallback (`TelaIndisponivel` em
  `src/app/pedido/pagamento/[token]/page.tsx`) que usa esse número.
- **Base de dados**: hoje só existe **um único Redis** (Upstash Free, 500k
  comandos/mês) — é a única fonte de dado permanente e efêmero. Migração
  para PostgreSQL é um programa arquitetural separado, aprovado mas **ainda
  não iniciado** (Etapas D+ de `DATABASE_MIGRATION_PLAN.md`) — **fora do
  escopo do Modo Sobrevivência 1.0**, que não migra pedidos nem implementa
  dual-write.

### 1.3 Riscos identificados

1. Retry manual do cliente após timeout de rede pode duplicar pedido (sem
   idempotência de criação) — **maior risco para o Modo Sobrevivência**.
2. `pedidos` como chave String única sem lock de escrita — corrida em
   criações concorrentes (raro, mas existente).
3. Rascunho de carrinho não sobrevive ao fechamento do navegador e não tem
   expiração/versão explícitas.
4. Falha do Redis hoje derruba pedidos por completo (não há camada de
   fallback) — inerente a "tudo em um único Redis", só resolvido de verdade
   pela migração a Postgres (fora deste programa).
5. Notificação de status ao cliente via Evolution se perde silenciosamente
   se a API estiver fora do ar (sem fila/outbox).

### 1.4 Arquivos que precisariam ser tocados (ao longo do programa)

- `src/app/api/pedido-app/route.ts` — idempotência de criação (Etapa 1, feito
  neste PR, aditivo e gated por flag).
- `src/app/cardapio/page.tsx` — wiring da UI de fallback manual e do
  `clientRequestId`/rascunho versionado (Etapa 2 — ainda não feito neste PR).
- `src/app/pedido/pagamento/[token]/page.tsx` — modelo de referência para o
  componente de fallback (reaproveitar padrão, não duplicar).
- Novo: `src/survival/*` — módulo isolado de resiliência (feito neste PR:
  flags, modelo de estados, idempotência, storage local).
- Futuro (Etapas 3-5): páginas/painéis `/dev/*`, workflow do GitHub Actions,
  pasta estática da página emergencial.

### 1.5 Arquivos que NÃO devem ser tocados sem causa comprovada

Todos os fluxos protegidos listados no comando original: `/api/orders`,
painel `/pedidos`, tudo relacionado a Pix Mercado Pago
(`mercadoPagoReconciliacao.ts`, `pixGuardiao.ts`, `pixSentinela.ts`),
`/api/whatsapp` (webhook e ciclo de QR), `src/mcp/*` (Observador), atendimento
humano, fidelidade, login do cliente, `/dev/mcp`, autenticação admin/dev,
domínio oficial. Nenhum desses foi alterado por este PR.

### 1.6 Plano de rollback

- Todo o código novo vive isolado em `src/survival/*` (sem consumidores fora
  deste programa) — deletar a pasta remove 100% do código novo.
- A única alteração em arquivo existente é `src/app/api/pedido-app/route.ts`:
  3 blocos aditivos (import, checagem de idempotência antes da validação,
  gravação de cache antes do `return` final), todos condicionados a
  `SURVIVAL_MODE_ENABLED === "true"`. Com a flag ausente/`false` (padrão), o
  comportamento é idêntico ao anterior a este PR — reverter é opcional
  (basta manter a flag desligada) ou trivial via `git revert`.
- Nenhuma migração de dado, nenhuma alteração de schema Redis existente,
  nenhuma nova dependência de infraestrutura paga.

## 2. Arquitetura — Etapa 1 (implementada)

### 2.1 Feature flags (`src/survival/flags.ts`)

- `SURVIVAL_MODE_ENABLED` (padrão `false`) — liga o núcleo (idempotência de
  criação de pedido).
- `SURVIVAL_MANUAL_FALLBACK_ENABLED` (padrão `false`) — reservada para a
  Etapa 2 (UI de fallback manual).
- `SURVIVAL_LOAD_SHEDDING_ENABLED` (padrão `false`) — reservada para a
  Etapa 3 (redução de carga).
- `CHEFEBOT_SURVIVAL_MODE=off|degraded|manual` (padrão `off`) — ativação
  manual de emergência; valor desconhecido/ausente é sempre tratado como
  `off` (fail-safe).

Nenhuma dessas variáveis é segredo.

### 2.2 Modelo de estados (`src/survival/state.ts`)

`SurvivalState = "NORMAL" | "DEGRADADO" | "MANUAL" | "INDISPONIVEL"`,
derivado por `avaliarEstadoSobrevivencia(signals)` — função pura, sem I/O,
que só classifica sinais já coletados em outro lugar. Ainda não conectada a
health checks reais (isso é trabalho da Etapa 3/4, quando os circuit
breakers de carga estiverem implementados).

### 2.3 Identificador idempotente (`src/survival/clientRequestId.ts`)

- `gerarClientRequestId()`: UUID v4 (ou fallback sem `crypto.randomUUID`),
  gerado uma vez por tentativa de checkout no navegador.
- `sanitizeClientRequestId(raw)`: aceita só `[a-zA-Z0-9_-]{8,100}`, nunca
  aceita telefone/PII, nunca lança.

### 2.4 Idempotência de criação de pedido

- `src/survival/pedidoIdempotencia.ts`: namespace isolado
  `survival:idempotencia:pedido:{clientRequestId}`, TTL 24h — mesma janela
  do `idempotencyKey` de webhook do WhatsApp já existente.
- `src/app/api/pedido-app/route.ts`: com a flag desligada (padrão), zero
  mudança de comportamento e zero comando Redis extra. Ligada, um
  `clientRequestId` já visto devolve a mesma resposta da primeira criação
  em vez de criar um pedido duplicado; ausência ou formato inválido do
  campo segue o comportamento de hoje (cria normalmente).

### 2.5 Rascunho local versionado (`src/survival/draftStorage.ts`)

- Chave `survival:pedido:rascunho:v1`, schema versionado (`v: 1`), TTL de
  24h, `localStorage` (sobrevive ao fechamento do navegador, diferente do
  `cf_draft` em `sessionStorage` que continua existindo sem alteração).
- Payload deliberadamente restrito a: carrinho (opaco, `unknown[]`),
  entrega/retirada, endereço, observação, forma de pagamento, troco, etapa
  atual, `clientRequestId`. Sem token, cookie, QR Pix, dado de cartão,
  segredo ou credencial — por construção de tipo, não por convenção.
- **Ainda não conectado à UI do checkout** (`src/app/cardapio/page.tsx`) —
  essa integração é da Etapa 2 (UI de fallback manual), que é quem
  efetivamente precisa exibir/reidratar esse rascunho.

### 2.6 Testes

72 testes novos (`src/survival/*.test.ts` + `route.test.ts`), cobrindo:
flags (default off, comparação estrita, modo forçado), modelo de estados
(prioridade INDISPONIVEL > MANUAL > DEGRADADO > NORMAL), geração/validação
de `clientRequestId` (incluindo rejeição de PII/símbolos), storage local
(expiração, schema, corrupção, storage indisponível, ausência de
token/segredo no payload gravado), e o comportamento de idempotência na
rota de criação de pedido (flag ligada/desligada, ausência de
`clientRequestId`, formato inválido, dois IDs distintos nunca colidem).

Suíte completa: 3103 testes passando (193 arquivos), typecheck sem novos
erros (183 pré-existentes, iguais ao baseline), lint limpo nos arquivos
alterados, build de produção OK.
