# Etapa D — Plano executivo (PostgreSQL/Neon) + redução de consumo Redis

Status: **plano, nenhuma execução**. Nenhum banco foi criado, nenhuma env var
alterada, nenhum runtime modificado, nenhum deploy disparado nesta entrega —
conforme regra explícita desta fase do Programa de Blindagem Econômica.
Complementa `ADR-POSTGRES-SOURCE-OF-TRUTH.md`, `DATABASE_MIGRATION_PLAN.md`,
`DATA_ARCHITECTURE.md`, `REDIS_KEY_INVENTORY.md`, `FAILURE_MODES.md`,
`REDIS_TELEMETRY.md` e `docs/operations/REDIS_RUNBOOK.md` (Etapas A-C, já
implementadas). Este documento não repete o conteúdo desses arquivos — só
adiciona o que faltava: confirmação do estado pós-upgrade, proposta de
redução de consumo, e a avaliação do provedor PostgreSQL para a Etapa D.

## 1. Confirmação do estado atual (pós-upgrade do Redis)

Esta sessão não tem acesso ao console da Upstash nem aos runtime logs da
Vercel em produção — a confirmação abaixo é o que pode ser auditado a partir
do código-fonte e da documentação já registrada; os itens marcados
**[verificar manualmente]** exigem checar `/dev/redis-status`,
`/api/dev/health` e o console da Upstash em produção antes de avançar.

| Item | Estado auditável no código | Verificação manual pendente |
|---|---|---|
| Redis Pay-as-you-go ativo | `docs/architecture/DATABASE_MIGRATION_PLAN.md` (Etapa B) descreve o plano como já entregue; `src/lib/redis.ts` continua usando `KV_REST_API_URL`/`KV_REST_API_TOKEN` sem mudança de driver | Confirmar no console Upstash que o banco em uso é o plano Pay-as-you-go, não mais o Free 500k/mês |
| Pedidos funcionando | `src/app/api/orders/route.ts`, `src/lib/healthChecks.ts:checkOrdersHealth()` (checagem passiva, sem side effect) | Abrir `/api/dev/health` em produção e confirmar `pedidos: healthy` |
| WhatsApp funcionando | `src/lib/healthChecks.ts:checkWhatsappHealth()` só confirma config, não conectividade real | Teste manual controlado (mensagem de teste, nunca para cliente real), conforme runbook |
| Pix funcionando | Nenhuma mudança de código no fluxo Pix em nenhuma das Etapas A-C (confirmado por leitura de `git log` desta auditoria — nenhum commit recente toca `pix*.ts`, `mercadopago*`) | Conferir painel de Pix pendente e conciliação em produção |
| Nenhum `UpstashError` recente | Nenhuma ocorrência de tratamento novo de `UpstashError` foi adicionada nas Etapas A-C além do já existente em `healthChecks.ts` | Buscar `UpstashError` nos runtime logs da Vercel (Observability → últimas 72h) |

**Recomendação:** antes de iniciar qualquer trabalho de código da Etapa D,
alguém com acesso a produção deve rodar a checagem acima e colar o resultado
de `/api/dev/redis-status` nesta seção (ou em um comentário de PR) — este
plano assume que a Etapa B foi bem-sucedida, mas essa auditoria não pode
confirmar isso a partir do repositório sozinho.

## 2. Redução de consumo — auditoria e propostas

Baseado no orçamento estático já levantado em `DATA_ARCHITECTURE.md` §3 e no
inventário de polling em §3.8. Nenhuma destas mudanças foi aplicada nesta
entrega — são candidatas, classificadas por risco/impacto/reversibilidade.

| # | Item auditado | Situação atual | Proposta | Risco | Impacto estimado | Rollback |
|---|---|---|---|---|---|---|
| 1 | Polling `/pedidos` (lista) | `setInterval(carregarPedidos, 3000)` — 20 req/min | Subir para 8000-10000ms (ainda "quase tempo real" para operação de balcão; pedido novo aparece em ≤10s) | Baixo | ~55-60% de redução nesse polling específico (20→6-7,5 req/min) | Reverter constante do intervalo, sem tocar lógica |
| 2 | Polling `/pedidos` (histórico de conversa selecionada) | `setInterval(carregarHistoricoConversa, 3000)` — 20 req/min | Subir para 5000-6000ms | Baixo | ~40-50% de redução | Reverter constante |
| 3 | Polling `/pedidos` (sessões) | `setInterval(carregarSessoes, 3000)` — 20 req/min | Subir para 8000-10000ms | Baixo | ~55-60% de redução | Reverter constante |
| 4 | Polling `/conversas` (recentes + lista) | 8000ms e 15000ms | Já relativamente conservador; unificar as duas chamadas num único fetch por ciclo (evita 2 idas separadas quando os dados se sobrepõem) | Médio (requer confirmar que os dois endpoints não têm propósito distinto antes de unificar) | A confirmar — depende de quanto os dois payloads se sobrepõem | Reverter para dois `setInterval` separados |
| 5 | Abas duplicadas (mesmo atendente, 2+ abas de `/pedidos` abertas) | Cada aba faz seu próprio polling independente — 2 abas = 2x o consumo, sem nenhum dado novo | Pausar polling quando `document.hidden === true` (Page Visibility API) — aba em segundo plano para de consultar | Baixo (mudança isolada, aditiva, não muda o que é exibido na aba ativa) | Alto em ambientes com múltiplas abas/monitores (padrão comum de atendente com painel sempre aberto em 2 telas) | Remover o listener de visibilidade |
| 6 | Leituras repetidas (`getPedidos()` chamado mais de uma vez na mesma requisição) | Não confirmado nesta auditoria sem abrir `orders/route.ts` linha a linha; citado como candidato no plano original | Levantamento dedicado antes de propor mudança | — | — | — |
| 7 | Regravação integral de `pedidos` a cada mutação | Confirmado em `REDIS_KEY_INVENTORY.md` — é o achado #2 da auditoria anterior | Fora do escopo de "baixo risco": a correção real é a migração da Etapa E-G (Postgres), não uma otimização pontual no Redis. Não propor aqui. | — | — | — |
| 8 | Regravação integral de `conversa_full:{phone}` a cada mensagem | Confirmado (achado #1 da auditoria anterior) — O(n) por mensagem | Mesma observação do item 7: correção estrutural é a Etapa I (Postgres `messages`), não uma otimização pontual | — | — | — |
| 9 | Crons (`vercel.json`) | 4 crons diários (`/api/cron` 3h, `/api/cron/sessoes` 4h, `/api/cron/pix-pendente` 5h, `/api/cron/mcp-observer` 6h) — baixa frequência, já fora do padrão de polling agressivo | Nenhuma mudança proposta — volume já é baixo (4 execuções/dia), não é candidato prioritário | — | — | — |
| 10 | MCP (`mcp:log:*`, `mcp:fila:eventos`) | 3 comandos por log/evento (`RPUSH`+`LTRIM`+`EXPIRE`), volume proporcional ao uso do MCP, não medido | Sem dado suficiente para propor redução sem instrumentação adicional — usar `/dev/redis-status` (grupo `mcp`) para decidir se vale a pena antes de mexer | — | — | — |
| 11 | Telemetria (Etapa C) | Overhead já medido e documentado: ~2-3% do volume real (`REDIS_TELEMETRY.md` §5) | Nenhuma mudança — overhead já é o mínimo viável pelo desenho atual (amostragem 5%, flush fire-and-forget) | — | — | — |

### Priorização (regra: só baixo risco, impacto mensurável, rollback simples)

Ordem recomendada para uma futura PR de otimização (fora desta entrega,
que é só o plano):

1. **Item 5 — pausar polling em aba oculta.** Maior impacto potencial
   (multiplicador de N abas), menor risco (não muda o que é mostrado, só
   quando é buscado), rollback trivial (remover 1 listener).
2. **Itens 1-3 — aumentar intervalos de polling em `/pedidos`.** Risco baixo,
   impacto mensurável e imediato no console da Upstash, rollback trivial
   (reverter uma constante).
3. **Item 4 — unificar polling de `/conversas`.** Risco médio (exige
   confirmar sobreposição de dados antes), ficaria para depois dos itens 1-3
   provarem impacto.
4. Itens 6, 10 — precisam de levantamento adicional antes de virar proposta
   concreta (não são "baixo risco" porque ainda não são bem entendidos).
5. Itens 7 e 8 (as maiores fontes de consumo) **não** entram nesta lista de
   otimização pontual — são resolvidos pela migração estrutural (Etapas E-I),
   não por ajuste de polling. Tentar otimizar o rewrite O(n) no Redis hoje
   seria trabalho descartável assim que a migração acontecer.

Nenhum destes itens foi implementado nesta entrega — ficam como proposta para
autorização e PR dedicados, um de cada vez, começando pelo item 5.

## 3. Provedor PostgreSQL — avaliação do Neon integrado à Vercel

| Critério | Neon (Vercel Marketplace) | Observação |
|---|---|---|
| Plano inicial gratuito | Sim — Neon Free tier via Vercel Marketplace: 1 projeto, ramificação (branching) de banco incluída, armazenamento e cômputo com limite mensal generoso para a escala atual do ChefeBot (poucas tabelas, baixo volume inicial) | Confirmar o limite exato vigente no momento do provisionamento real (Etapa D de execução, não desta entrega) — planos de provedores mudam; não travar número aqui |
| Driver serverless | Sim — `@neondatabase/serverless`, desenhado para ambiente serverless/edge (conexão via HTTP/WebSocket, sem manter socket TCP longo-vivo entre invocações da função) | Compatível com o padrão de runtime já usado pelo projeto (Vercel serverless functions, mesmo padrão do client Redis via HTTP/REST) |
| Pooling compatível com Vercel | Sim — Neon oferece pooling nativo (PgBouncer gerenciado, modo `transaction`) via uma connection string separada (`-pooler`); a integração Vercel Marketplace já provisiona as duas strings automaticamente (`DATABASE_URL` direta e `DATABASE_URL_POOLED`/equivalente) | Usar a string com pooler para o caminho de requisição HTTP normal; string direta reservada para migrations (algumas ferramentas de migration não funcionam bem atrás de pooler em modo transaction) |
| Migrations | Suporta qualquer ferramenta padrão de SQL/Postgres (Drizzle, Prisma, node-pg-migrate, SQL puro) — não é proprietário nesse ponto | A escolha da ferramenta é uma decisão separada (ver §4); Neon não impõe uma |
| Backups e recuperação | Point-in-time recovery incluído mesmo no tier gratuito (janela de retenção menor no Free, maior nos planos pagos) + branching de banco (permite criar uma branch a partir de um ponto no tempo para investigar/restaurar sem afetar produção) | O branching é um diferencial real para o padrão de trabalho já usado neste projeto (branch por tarefa, PR, Preview) — replica a mesma disciplina no nível do banco |
| Integração Preview/Production | Nativa via Vercel Marketplace: cada Preview Deployment pode receber automaticamente uma branch de banco Neon isolada, sincronizada com o deploy; Production aponta para a branch principal do Neon | É o único candidato dos três (Neon/Supabase/Vercel Postgres nativo) com esse nível de integração automática de branch-por-preview hoje |

### Alternativas consideradas (mantidas como registro, não escolhidas nesta entrega)

- **Supabase:** também tem tier gratuito e driver Postgres padrão, mas o
  diferencial de branching automático por Preview via Vercel Marketplace não
  é equivalente ao do Neon; adiciona superfície (Auth/Storage/Realtime do
  Supabase) que o ChefeBot não usaria, sem necessidade comprovada.
- **Vercel Postgres nativo:** hoje é, na prática, Neon por trás com uma
  camada de produto da própria Vercel — optar por integrar o Neon diretamente
  dá acesso ao branching e ao painel completo do Neon sem depender de uma
  camada adicional de abstração da Vercel por cima.

### Recomendação

**Neon Postgres via Vercel Marketplace**, pelos motivos acima — plano
gratuito inicial compatível com a escala atual, driver serverless alinhado
ao runtime já usado, pooling nativo resolvendo o problema clássico de
serverless + Postgres (esgotamento de conexões), e branching que replica a
mesma disciplina de branch/PR/Preview que já rege o resto do projeto
(`docs/STATUS_ATUAL_CHEFEBOT.md` §1). **Nenhum provisionamento foi feito
nesta entrega** — esta é só a avaliação solicitada.

## 4. ORM / query builder — decisão a justificar na execução da Etapa D

Não decidido nesta entrega (fora do escopo — "não provisione nada"). Registro
das opções para a PR que efetivamente executar a Etapa D:

- **SQL puro + `pg`/driver Neon direto:** menor abstração, mais controle,
  mas reimplementa manualmente o que um query builder tipado já resolve
  (mapeamento de tipo `numeric`→`string`/`number`, por exemplo, já é uma
  pegadinha conhecida de `pg` sem camada adicional).
  **Drizzle** (`drizzle-orm` + `drizzle-kit`): TypeScript-first, migrations
  como código versionado (compatível com o padrão de commit/PR já usado no
  projeto), sem runtime pesado, suporta o driver serverless do Neon
  nativamente (`drizzle-orm/neon-http` ou `drizzle-orm/neon-serverless`).
  **Recomendação preliminar (a confirmar na PR de execução):** Drizzle —
  self-contained, sem código gerado por CLI externo rodando em build step
  adicional (diferente do Prisma, que exige `prisma generate`), e o modelo
  de 15 tabelas já desenhado em `DATABASE_MIGRATION_PLAN.md` §1 é
  relacional simples, sem necessidade dos recursos mais pesados de um ORM
  completo.

## 5. Health check, backup, secrets, rollback — específicos da Etapa D

Complementam (não substituem) `FAILURE_MODES.md` §1 e §10:

- **Health check independente:** `checkPostgresHealth()` (novo, mesmo padrão
  de `checkRedisHealth()`) — `SELECT 1` com timeout curto (ex. 1500ms),
  incluído em `/api/dev/health` como quarto componente, nunca bloqueando os
  outros três.
- **Backup:** point-in-time recovery nativo do Neon (§3) é o backup primário;
  documentar no runbook (`docs/operations/REDIS_RUNBOOK.md` ganha um
  equivalente `POSTGRES_RUNBOOK.md` na Etapa D) o procedimento de restauração
  via branch a partir de um timestamp — nunca testado em produção sem antes
  validar em uma branch de teste.
- **Secrets:** `DATABASE_URL`/`DATABASE_URL_POOLED` seguem o mesmo padrão já
  usado por `KV_REST_API_URL`/`KV_REST_API_TOKEN` (env var da Vercel, nunca
  commitada, nunca logada — `sanitizeErrorMessage` de `redisTelemetry.ts`
  ganha as mesmas regras de mascaramento para erros de conexão Postgres).
- **Rollback:** enquanto não houver nenhuma leitura/escrita real do app no
  Postgres (esta entrega e a execução inicial da Etapa D), o rollback é
  trivial — remover a env var e o client, zero impacto em produção. A partir
  da Etapa E (dual-write), o rollback passa a ser a feature flag documentada
  em `DATABASE_MIGRATION_PLAN.md` (`DUAL_WRITE_ORDERS_PG=false`).

## 6. Lista exata de arquivos da primeira PR funcional (Etapa D — só banco, sem dual-write)

Nenhum destes arquivos foi criado ou alterado nesta entrega. Lista para a
**próxima** PR, que deve se limitar a isto (dual-write de pedidos é a Etapa
E, PR separada):

- `src/lib/db.ts` — novo client Postgres (Drizzle + driver serverless Neon),
  seguindo o mesmo padrão de wiring único que `src/lib/redis.ts` já usa.
- `drizzle.config.ts` — configuração do Drizzle Kit.
- `drizzle/schema.ts` (ou `src/lib/db/schema.ts`) — as 15 tabelas de
  `DATABASE_MIGRATION_PLAN.md` §1, traduzidas para `drizzle-orm/pg-core`.
- `drizzle/migrations/0001_init.sql` (gerado pela ferramenta) — migration
  inicial.
- `src/lib/healthChecks.ts` — adicionar `checkPostgresHealth()` (função
  nova, aditiva; não altera as 3 checagens existentes).
- `src/app/api/dev/health/route.ts` — incluir o novo componente na resposta
  agregada (aditivo).
- `docs/operations/POSTGRES_RUNBOOK.md` — novo, espelhando
  `REDIS_RUNBOOK.md` para o procedimento de backup/restauração do Neon.
- `docs/architecture/DATABASE_MIGRATION_PLAN.md` — atualizar o status da
  Etapa D de "não iniciada" para "em execução"/"concluída" ao final da PR.
- `.env.example` (se existir no projeto) — documentar `DATABASE_URL`/
  `DATABASE_URL_POOLED` como variáveis esperadas, **sem valor real**.
- `package.json` — adicionar `drizzle-orm`, `drizzle-kit`,
  `@neondatabase/serverless`.

**Explicitamente fora desta lista** (fica para Etapas E+, PRs separadas):
qualquer alteração em `src/app/api/orders/route.ts`,
`src/app/api/whatsapp/route.ts`, `src/lib/fidelidade.ts`,
`src/lib/pixSentinela.ts`, `src/lib/conversasHistorico.ts`, ou qualquer
arquivo do fluxo Pix.

## 7. Testes necessários (Etapa D, só o banco)

- Migration roda limpa em ambiente local/CI (banco Neon de teste ou Postgres
  local via Docker, a decidir na execução).
- Smoke test de conexão (`checkPostgresHealth()` retorna `healthy` contra um
  banco de teste; retorna `down` sem lançar quando a `DATABASE_URL` é
  inválida).
- Teste de que `/api/dev/health` continua respondendo corretamente mesmo se
  o Postgres estiver fora (falha isolada, não derruba os outros 3
  componentes — mesmo padrão já testado para Redis em `healthChecks.test.ts`).
- Nenhum teste de `/api/orders`, `/api/whatsapp` ou Pix deve mudar de
  resultado nesta etapa (nenhum desses arquivos é tocado).

## 8. Riscos da implementação (Etapa D, execução futura)

- Driver serverless do Neon é relativamente novo — validar comportamento sob
  cold start e concorrência antes de depender dele em caminho crítico
  (mitigado por esta etapa não ter nenhum caminho crítico ainda: zero leitura
  ou escrita real do app).
- Erro de configuração de pooling (usar a string errada — direta vs. pooler
  — no caminho errado) pode esgotar conexões sob carga; mitigado por só
  existir tráfego de teste/health check nesta etapa, não tráfego real.
- Custo além do tier gratuito se o projeto crescer antes do esperado —
  mitigado por monitorar o painel Neon desde o início (mesmo hábito já
  criado para Redis via `/dev/redis-status`).

## 9. Critério para avançar (desta entrega para a execução real da Etapa D)

1. Confirmação manual da seção 1 deste documento (estado do Redis
   pós-upgrade, sem `UpstashError` recente).
2. Aprovação explícita do provedor (Neon) e da ferramenta de migration
   (Drizzle, recomendação preliminar) por quem decide arquitetura.
3. Aprovação da lista de arquivos da seção 6 como escopo fechado da próxima
   PR — sem expandir para dual-write na mesma PR.
