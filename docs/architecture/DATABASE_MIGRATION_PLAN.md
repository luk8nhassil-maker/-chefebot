# Plano de migração — Redis → PostgreSQL como fonte da verdade

Nenhuma etapa deste documento foi executada. Cada etapa exige branch isolada,
PR, testes e validação em Preview antes de qualquer promoção a produção,
conforme regra inegociável do programa.

## 1. Modelo PostgreSQL proposto

Decisões de projeto aplicadas a todas as tabelas, para não repetir em cada uma:

- **PK:** `UUID` (`gen_random_uuid()`, extensão `pgcrypto`/`uuid-ossp`) em vez de serial incremental — evita vazar volume de negócio (contagem de pedidos) por enumeração de ID, e permite gerar o ID no código antes do insert quando necessário (idempotência de escrita).
- **Timestamps:** `created_at timestamptz not null default now()` e `updated_at timestamptz not null default now()` (com trigger de update) em toda tabela mutável — sem exceção, porque hoje o Redis não tem isso de graça e várias chaves (`pedidos`) dependem de campos de horário formatados manualmente (`toLocaleTimeString`), frágeis para auditoria.
- **JSON somente quando o dado é genuinamente semiestruturado e não é consultado por campo individual** (ex.: payload bruto de webhook do WhatsApp, snapshot de configuração). Nunca uso `jsonb` para o que vira coluna relacional de verdade (endereço, telefone, status) — o Redis atual força isso (tudo é um blob JSON) e é exatamente o padrão que causa a keys `pedidos`/`conversa_full` serem regravadas por inteiro a cada mudança.
- **Idempotência:** toda tabela de evento/transação tem uma coluna `idempotency_key text unique` (ou `unique(order_id, event_type)` quando o par já é natural) — isso substitui as chaves `*:creditado:*` / `eventoId` do Redis por uma constraint de banco, sem precisar de lock aplicacional para o caso comum.
- **Retenção:** nenhuma tabela tem DELETE automático nesta proposta inicial — dado de pedido/conversa/financeiro é auditável por natureza. Onde fizer sentido arquivar (mensagens muito antigas, eventos de webhook processados), a política é mover para tabela `_archive` ou partição, nunca apagar, até haver decisão de negócio explícita sobre retenção legal/fiscal.

### 1.1 `customers`
```sql
create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,               -- identidade canônica (mesmo papel de derivarClienteIdPorTelefone)
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_customers_phone on customers (phone);
```
Relacionamentos: referenciado por `orders`, `conversations`, `loyalty_accounts`.
Justificativa: telefone como identidade canônica já é a regra de negócio vigente (`fidelidade.ts:derivarClienteIdPorTelefone`) — só formaliza em `UNIQUE` de banco o que hoje é convenção de nome de chave Redis.

### 1.2 `orders`
```sql
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number integer not null,             -- número sequencial diário (substitui contador_pedidos:*)
  order_date date not null default (now() at time zone 'America/Sao_Paulo')::date,
  customer_id uuid references customers(id),
  customer_name text not null,               -- desnormalizado de propósito: nome no momento do pedido não deve mudar retroativamente se o cliente editar o cadastro
  customer_phone text not null,
  status text not null check (status in ('novo','em_preparo','saiu_entrega','entregue','cancelado')),
  total numeric(10,2) not null,
  delivery_type text,
  delivery_fee numeric(10,2),
  address text,
  neighborhood text,
  reference text,
  payment_method text,
  change_for numeric(10,2),
  notes text,
  loyalty_discount numeric(10,2),
  redemption_id uuid,
  is_archived boolean not null default false,
  archived_at timestamptz,
  archived_by text,
  archived_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_date, order_number)
);
create index idx_orders_status on orders (status) where not is_archived;
create index idx_orders_customer on orders (customer_id);
create index idx_orders_created on orders (created_at desc);
```
Restrições: `status` com `check` fechado na mesma lista de 5 valores do `type Status` atual (`src/app/api/orders/route.ts:29`). `unique(order_date, order_number)` substitui o `INCR contador_pedidos:{data}` — a numeração passa a ser responsabilidade de uma sequência/transação no Postgres (`select coalesce(max(order_number),0)+1 ... for update` na mesma transação do insert, ou uma sequence por dia via função).
Campos JSON: nenhum — todo campo hoje solto no blob `Pedido` vira coluna, exceto o que for genuinamente Pix (ver `payment_references`).

### 1.3 `order_items`
```sql
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  description text not null,      -- hoje é string livre em Pedido.itens (string[])
  kind text,                      -- 'pizza' | outros — usado por contarPizzas()
  quantity integer not null default 1,
  unit_price numeric(10,2),
  created_at timestamptz not null default now()
);
create index idx_order_items_order on order_items (order_id);
```
Justificativa: `Pedido.itens` hoje é `string[]` sem estrutura — quebrar em linhas permite consultas de fidelidade (`contarPizzas`) e financeiro sem parsear string. Migração inicial pode popular `description` com a string atual e deixar `kind`/`quantity`/`unit_price` nulos até o formulário de pedido ser adaptado (fora do escopo desta etapa de diagnóstico).

### 1.4 `order_status_history`
```sql
create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by text,                -- 'atendente:{login}' | 'sistema' | 'cliente'
  changed_at timestamptz not null default now(),
  metadata jsonb                  -- ex.: {entregador_id, entregador_nome} — só aqui, por ser variável conforme o status
);
create index idx_order_status_history_order on order_status_history (order_id, changed_at);
```
Justificativa: hoje não existe histórico de status nenhum — cada `PATCH /api/orders` sobrescreve o status no array `pedidos` e o valor anterior se perde. Esta tabela é estritamente aditiva (nunca UPDATE/DELETE), resolvendo um gap de auditoria que o Redis atual não cobre.

### 1.5 `conversations`
```sql
create table conversations (
  id uuid primary key default gen_random_uuid(),
  customer_phone text not null unique,   -- 1 conversa por telefone, igual ao modelo Redis (conversa_meta:{phone})
  customer_id uuid references customers(id),
  customer_name text,
  last_message_preview text,
  last_message_at timestamptz,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conversations_last_message on conversations (last_message_at desc);
```
Substitui `conversas:index` (Sorted Set) + `conversa_meta:*`: o índice em `last_message_at desc` faz o mesmo papel do `ZRANGE`, sem custo O(n) de reescrita.

### 1.6 `messages`
```sql
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author text not null check (author in ('cliente','bot','atendente')),
  text text not null,
  sent_at timestamptz not null default now(),
  message_id text,           -- id da Evolution API, quando existir — chave de idempotência do eco fromMe
  created_at timestamptz not null default now()
);
create index idx_messages_conversation on messages (conversation_id, sent_at);
create unique index idx_messages_dedup on messages (conversation_id, message_id) where message_id is not null;
```
Substitui `conversa_full:{phone}` — 1 linha por mensagem em vez de reescrever um array inteiro a cada mensagem (elimina o problema O(n) documentado em `DATA_ARCHITECTURE.md`). `idx_messages_dedup` cobre o mesmo caso que hoje é resolvido via `conversa:echo-painel:{id}` no Redis.

### 1.7 `whatsapp_inbound_events`
```sql
create table whatsapp_inbound_events (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,        -- substitui idempotencyKey do Redis
  from_phone text not null,
  raw_payload jsonb not null,             -- payload bruto do webhook — aqui sim JSON se justifica (schema externo, não controlado por nós)
  status text not null default 'received' check (status in ('received','processing','processed','failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
create index idx_inbound_status on whatsapp_inbound_events (status) where status in ('received','processing','failed');
```
Implementa a regra "registrar entrada antes de processar" pedida no objetivo de longo prazo: todo evento do webhook grava aqui **antes** de qualquer processamento pelo bot, com `message_id unique` garantindo idempotência de banco (substitui o `GET`+`SET idempotencyKey` do Redis, que perde a marca se o Redis cair no meio).

### 1.8 `whatsapp_outbox`
```sql
create table whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  to_phone text not null,
  text text not null,
  related_order_id uuid references orders(id),
  related_inbound_event_id uuid references whatsapp_inbound_events(id),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  idempotency_key text unique,   -- ex.: 'status:{order_id}:{status}' — nunca manda a mesma notificação duas vezes
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index idx_outbox_pending on whatsapp_outbox (next_attempt_at) where status in ('pending','failed');
```
Implementa Outbox + retry com backoff + dead-letter do objetivo de longo prazo — ver `FAILURE_MODES.md` para o worker que consome esta tabela.

### 1.9 `loyalty_accounts`
```sql
create table loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) unique,
  model text not null default 'pontos' check (model in ('pizzas_legado','pontos')),
  balance numeric(10,2) not null default 0,   -- saldo confirmado, sempre recalculável a partir de loyalty_transactions
  updated_at timestamptz not null default now()
);
```
`balance` é um campo desnormalizado/cache — a fonte de verdade real é a soma de `loyalty_transactions`, exatamente como hoje `calcularSaldoDoExtrato` recalcula a partir do extrato. Mantém a mesma filosofia de auditoria ("extrato nunca é reescrito, só sofre novos lançamentos").

### 1.10 `loyalty_transactions`
```sql
create table loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  loyalty_account_id uuid not null references loyalty_accounts(id),
  order_id uuid references orders(id),
  type text not null check (type in ('previsto','confirmado','cancelado','estornado','resgatado','ajuste','credito','recompensa')),
  amount numeric(10,2) not null,
  reason text,
  event_id text not null unique,   -- substitui eventoId (dedup idempotente)
  balance_after numeric(10,2),
  created_at timestamptz not null default now()
);
create index idx_loyalty_tx_account on loyalty_transactions (loyalty_account_id, created_at);
```
`event_id unique` é a mesma garantia que hoje vem do lock Lua + checagem manual contra o extrato (`registrarMovimentoPontosIdempotente`) — em Postgres, uma transação com `insert ... on conflict (event_id) do nothing` resolve o mesmo problema sem precisar de lock distribuído.

### 1.11 `app_config`
```sql
create table app_config (
  key text primary key,          -- 'fidelidade', 'fidelidade_pontos', etc — mesmas chaves de hoje (config:fidelidade)
  value jsonb not null,          -- JSON aqui se justifica: schema de config varia por chave, sem necessidade de query por campo interno
  updated_at timestamptz not null default now(),
  updated_by text
);
```
Justificativa do JSON: é literalmente o mesmo uso do Redis hoje (`redis.get<ConfigFidelidade>(CHAVE_CONFIG)`) — não há ganho em normalizar configuração de baixa frequência de leitura por campo.

### 1.12 `menu_items`
```sql
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,        -- 'pizza_salgada' | 'pizza_doce' | 'bebida' | 'suco' | 'lanche' | 'borda'
  name text not null,
  price numeric(10,2),
  active boolean not null default true,
  display_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_menu_items_category on menu_items (category, display_order) where active;
```
Substitui a chave `cardapio` (hoje um blob único com `saltyFlavors`, `bebidas`, `sucos` etc.) por linhas — permite editar 1 item sem reescrever o blob inteiro.

### 1.13 `employees`
```sql
create table employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('atendente','admin')),
  login text not null unique,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
Nota de segurança: nenhum plano deste documento move segredo/token em texto plano — `password_hash` mantém o mesmo padrão de hashing já usado hoje (a implementação de auth atual não foi reaberta nesta auditoria; a migração real deve reusar o mesmo mecanismo de hash já validado em produção).

### 1.14 `payment_references`
```sql
create table payment_references (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) unique,
  provider text not null check (provider in ('mercadopago','manual')),
  provider_payment_id text,
  status text not null,
  amount numeric(10,2),
  confirmed_at timestamptz,
  raw_metadata jsonb,             -- espelha PixMetadata hoje embutido no blob do pedido — JSON porque o schema é ditado pelo provider externo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
**Atenção — fora de execução nesta etapa:** esta tabela é só o **destino declarado** para onde os dados de referência de pagamento devem migrar no longo prazo (pedido pelo escopo do programa). A regra inegociável de não alterar o fluxo Pix Mercado Pago validado significa que **nenhuma etapa deste plano implementa dual-write ou leitura aqui antes de uma autorização específica e separada**, fora da sequência A-K abaixo — a lógica de geração de copia-e-cola, webhook, polling e conciliação continua 100% em cima do Redis/estrutura atual até segunda ordem.

### 1.15 `audit_log`
```sql
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,            -- 'atendente:{login}' | 'sistema' | 'cliente:{phone mascarado}'
  action text not null,           -- 'order.status_changed' | 'loyalty.adjusted' | 'config.updated' etc
  entity_type text not null,
  entity_id uuid,
  details jsonb,                  -- JSON aqui se justifica: shape varia por tipo de ação, é log, não é consultado por campo interno
  created_at timestamptz not null default now()
);
create index idx_audit_entity on audit_log (entity_type, entity_id);
create index idx_audit_created on audit_log (created_at desc);
```
Nunca grava telefone completo, token ou dado sensível em `details` — mesma regra de mascaramento já usada em `fidelidade.ts:mascararIdentidadePontos`.

---

## 2. Estratégia de migração — Etapas A a K

Cada etapa é independente, reversível e não depende de terminar a anterior 100% para começar a próxima em paralelo (exceto onde marcado "bloqueante").

### ETAPA A — Recuperação e estabilização do Redis atual
- **Escopo:** resolver o chamado aberto com a Upstash (cota/plano), sem qualquer mudança de código.
- **Risco:** baixo (nenhuma mudança de código).
- **Pré-condições:** nenhuma.
- **Arquivos prováveis:** nenhum.
- **Testes:** nenhum (é operação de infraestrutura).
- **Validação:** `GET /api/orders` e webhook do WhatsApp voltam a responder sem `UpstashError`.
- **Rollback:** não aplicável.
- **Critério para avançar:** incidente P0 encerrado, sistema estável por pelo menos 24h.
- **Bloqueante para as demais etapas?** Sim, para qualquer trabalho em produção — mas B a D podem ser preparadas (documentação, migrations, banco novo criado e testado isoladamente) mesmo antes de A fechar, desde que nada seja conectado à produção.

### ETAPA B — Backup e Redis Pay-as-you-go
- **Escopo:** conforme plano já entregue na conversa do incidente (backup, inventário, banco novo, cópia com TTL, validação, troca de variável, rollback).
- **Risco:** médio (janela de corte de escrita).
- **Pré-condições:** Etapa A concluída.
- **Arquivos prováveis:** nenhum arquivo de app — script de migração roda fora do runtime.
- **Testes:** validação de contagem/amostragem (já detalhada no plano anterior).
- **Validação:** zero divergência de contagem, zero `UpstashError` pós-corte.
- **Rollback:** reverter env var para o banco antigo (documentado, banco antigo preservado por ≥7 dias).
- **Critério para avançar:** banco novo estável por pelo menos 72h em produção.

### ETAPA C — Telemetria, alertas e orçamento de comandos
- **Escopo:** instrumentar contagem real de comandos por rota (hoje só temos estimativa estática), configurar alertas de cota (ver `FAILURE_MODES.md` seção 5).
- **Risco:** baixo (observabilidade pura, sem mudança de comportamento).
- **Pré-condições:** Etapa B concluída (banco novo com folga de cota para não repetir o incidente enquanto instrumenta).
- **Arquivos prováveis:** novo `src/lib/redisMetrics.ts` (wrapper leve em volta do client Redis existente, sem trocar a API), painel simples em `/dev/redis-usage` ou reaproveitar `/dev/mcp`.
- **Testes:** unitários do wrapper de contagem.
- **Validação:** números da instrumentação batem com o console da Upstash em uma janela de comparação.
- **Rollback:** remover o wrapper, voltar a chamar `redis` diretamente (é aditivo, não risco).
- **Critério para avançar:** alertas de 50/70/85/95% configurados e testados (disparo manual simulado).

### ETAPA D — PostgreSQL e migrations iniciais
- **Escopo:** provisionar o banco (Marketplace Vercel, Neon ou Supabase — decisão registrada na ADR), criar as migrations das 15 tabelas acima, **sem nenhuma leitura/escrita do app ainda**.
- **Risco:** baixo (banco novo, isolado, nada consome ainda).
- **Pré-condições:** nenhuma além de aprovação da tecnologia (ver ADR).
- **Arquivos prováveis:** `src/lib/db.ts` (novo client), diretório `migrations/` ou `drizzle`/`prisma` conforme ferramenta escolhida, `DATABASE_URL` documentada mas **não** setada em produção ainda.
- **Testes:** migrations rodam limpas em ambiente local/CI; smoke test de conexão.
- **Validação:** todas as tabelas criadas batem com o schema deste documento; `EXPLAIN` dos índices principais confirma uso.
- **Rollback:** dropar o banco de teste — zero impacto em produção, pois nada está conectado ainda.
- **Critério para avançar:** schema revisado e aprovado, CI verde.

### ETAPA E — Pedidos em dual-write controlado
- **Escopo:** toda escrita de pedido (`POST`/`PATCH`/`DELETE /api/orders`) passa a gravar em Postgres **além de** continuar gravando no Redis exatamente como hoje — Redis continua sendo a fonte lida pelo resto do sistema.
- **Risco:** médio-alto — é a primeira etapa que toca `src/app/api/orders/route.ts`, arquivo que também alimenta o fluxo Pix (`sanitizarPedidoPixResposta`). Qualquer alteração aqui precisa de revisão extra para garantir que a leitura/escrita do Pix dentro do pedido não seja tocada, só espelhada.
- **Pré-condições:** Etapa D concluída, feature flag para ligar/desligar o dual-write sem deploy (env var, ex. `DUAL_WRITE_ORDERS_PG=false` por padrão).
- **Arquivos prováveis:** `src/app/api/orders/route.ts` (chamada adicional, não substituição), novo `src/lib/ordersRepositoryPg.ts`.
- **Testes:** todo teste existente de `/api/orders` continua passando; novos testes cobrem que uma falha do Postgres **nunca** impede a resposta HTTP (mesmo padrão best-effort já usado em `creditarFidelidadePedido`/`creditarPontosPedidoEntregue`).
- **Validação:** em Preview, criar/mudar pedidos de teste e conferir que aparecem idênticos nas duas fontes.
- **Rollback:** flag `DUAL_WRITE_ORDERS_PG=false` — sem redeploy, efeito imediato.
- **Critério para avançar:** dual-write estável em produção por ≥7 dias, zero divergência encontrada na Etapa F.

### ETAPA F — Leitura comparativa Redis vs. PostgreSQL
- **Escopo:** job (cron ou endpoint manual) que compara o array de pedidos do Redis com a tabela `orders`+`order_items` do Postgres e reporta divergências — **sem servir nenhuma leitura de produção a partir do Postgres ainda**.
- **Risco:** baixo (só leitura, só relatório).
- **Pré-condições:** Etapa E rodando há tempo suficiente para acumular dado comparável.
- **Arquivos prováveis:** `src/app/api/dev/orders-diff/route.ts` (protegido por auth, padrão dos endpoints `/api/dev/*` existentes).
- **Testes:** unitário da função de diff.
- **Validação:** 0 divergências por ≥3 dias seguidos antes de avançar.
- **Rollback:** remover o endpoint — zero risco, não é lido por ninguém em produção.
- **Critério para avançar:** divergência zero sustentada.

### ETAPA G — PostgreSQL como fonte oficial de pedidos (bloqueante, alto risco)
- **Escopo:** `GET`/`PATCH` de pedidos passam a **ler** do Postgres; Redis (`pedidos`) vira escrita de espelho/cache reverso temporário (ou é desligado, a decidir no momento, dependendo do que ainda depende dele — ex. `pixSentinela.ts` lê `redis.get("pedidos")` diretamente, então essa leitura precisa ser migrada **junto**, sem quebrar o Sentinela).
- **Risco:** alto — é o corte real da fonte de verdade. Exige que **toda** leitura de `pedidos` no código (incluindo `pixSentinela.ts`, `pedido-status/route.ts`, `entregador-pedidos/route.ts`, `pedido-combinado/route.ts`) seja migrada na mesma etapa, ou o sistema fica com duas fontes divergentes silenciosamente.
- **Pré-condições:** Etapa F com zero divergência sustentada; plano de rollback testado em Preview (não só documentado).
- **Arquivos prováveis:** todos os listados acima que fazem `redis.get<Pedido[]>('pedidos')` / `redis.get<PedidoSentinelaBruto[]>("pedidos")`.
- **Testes:** suíte completa de pedidos + Pix (sem alterar a lógica Pix, só a fonte de leitura do array de pedidos que o Sentinela consulta).
- **Validação:** janela de operação assistida (não apenas automatizada) no primeiro dia após o corte.
- **Rollback:** flag de leitura volta a apontar para Redis; Postgres continua recebendo dual-write (não se perde nada no meio tempo).
- **Critério para avançar:** operação estável por ≥14 dias antes de sequer cogitar desligar a escrita espelho no Redis.

### ETAPA H — Clientes e fidelidade
- **Escopo:** mesmo padrão dual-write → comparação → corte, aplicado a `customers`, `loyalty_accounts`, `loyalty_transactions`, substituindo os dois modelos de fidelidade (pizzas legado + pontos).
- **Risco:** alto (dado financeiro-adjacente — saldo de cliente).
- **Pré-condições:** Etapa G estável.
- **Arquivos prováveis:** `src/lib/fidelidade.ts` (reescrita de fonte, preservando toda a semântica de idempotência/lock hoje implementada em Lua).
- **Testes:** toda a suíte de fidelidade existente, mais testes de concorrência (2 créditos simultâneos não duplicam).
- **Validação:** comparação de saldo Redis vs. Postgres por período sustentado, igual à Etapa F.
- **Rollback:** mesmo padrão de flag.
- **Critério para avançar:** zero divergência de saldo sustentada.

### ETAPA I — Conversas e Outbox WhatsApp
- **Escopo:** `conversations`/`messages` como fonte oficial; implementação do Outbox (`whatsapp_outbox`) e do registro de entrada (`whatsapp_inbound_events`) para o objetivo de "processamento confiável" do WhatsApp.
- **Risco:** alto (é o coração do atendimento; qualquer regressão aqui é visível para o cliente imediatamente).
- **Pré-condições:** Etapa D; pode rodar em paralelo com G/H (dados diferentes), mas exige atenção redobrada por ser o maior volume de escrita (uma mensagem = potencialmente várias linhas).
- **Arquivos prováveis:** `src/lib/conversasHistorico.ts` (fonte), `src/app/api/whatsapp/route.ts` (grava em `whatsapp_inbound_events` **antes** de processar — mudança de ordem de operações, não só de destino), novo worker de Outbox (`src/lib/outboxWorker.ts` + rota de cron/QStash para drenar a fila).
- **Testes:** idempotência de webhook via `unique(message_id)`; retry/backoff do worker; dead-letter após `max_attempts`.
- **Validação:** mensagem de teste chega, é registrada em `whatsapp_inbound_events` mesmo se o processamento falhar em seguida; resposta do bot passa pela Outbox e é marcada `sent` só após confirmação real da Evolution API.
- **Rollback:** flag desliga o registro em Postgres, comportamento volta a ser idêntico ao atual (Redis + envio direto).
- **Critério para avançar:** zero mensagem perdida/duplicada em teste de carga controlado.

### ETAPA J — Configurações, cardápio e financeiro
- **Escopo:** `app_config`, `menu_items`, tabela financeira (fora da lista mínima, a criar nesta etapa), `employees`.
- **Risco:** baixo-médio (baixo volume, mas cardápio é lido em quase toda tela do cliente).
- **Pré-condições:** Etapa D.
- **Arquivos prováveis:** `src/lib/menu.ts`, painel de admin de cardápio/config/financeiro (não abertos em detalhe nesta auditoria).
- **Testes:** leitura do cardápio dinâmico continua idêntica ao formato hoje consumido pelo frontend.
- **Validação:** comparação visual do cardápio renderizado antes/depois.
- **Rollback:** flag de fonte.
- **Critério para avançar:** sem regressão visual/funcional no cardápio do cliente.

### ETAPA K — Limpeza das chaves permanentes do Redis
- **Escopo:** só depois de TODAS as etapas anteriores estáveis por um período sustentado (mínimo 30 dias em produção sem rollback), remover as chaves permanentes do Redis que migraram (`pedidos`, `conversa_full:*`, `fidelidade:*` exceto locks, `cardapio`, `funcionarios`, `custos:*`) — nunca antes disso.
- **Risco:** baixo se as etapas anteriores foram bem validadas; alto se executada cedo demais (perda de dado sem fonte alternativa).
- **Pré-condições:** todas as etapas E-J concluídas e estáveis; backup final das chaves antes de apagar.
- **Arquivos prováveis:** script de limpeza pontual, não parte do runtime da aplicação.
- **Testes:** confirmação de que nenhum código ainda lê as chaves antes de apagar (grep de verificação, igual ao desta auditoria).
- **Validação:** sistema opera normalmente por ≥7 dias após a limpeza.
- **Rollback:** restaurar do backup final (mesmo procedimento de Fase 1 do plano de contingência já entregue).
- **Critério para avançar (fim do programa):** Redis passa a conter só sessão/lock/dedup/cooldown/rate-limit/cache/fila/MCP, conforme objetivo de longo prazo.

---

## 3. Primeira implementação segura recomendada

**Etapa C (telemetria)**, não a D. Justificativa: qualquer trabalho de migração real (D em diante) que não tenha visibilidade de quantos comandos Redis está economizando/gastando é decisão às cegas — e o programa inteiro nasceu de um incidente de cota estourada sem alarme prévio. Instrumentar antes de migrar garante que a próxima aproximação da cota (ainda vai existir enquanto o Redis antigo carregar dado permanente) dispara alerta em 50/70/85/95% muito antes de virar incidente de novo.
