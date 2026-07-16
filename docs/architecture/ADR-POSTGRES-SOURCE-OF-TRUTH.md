# ADR: PostgreSQL como fonte da verdade para dados permanentes do ChefeBot

- **Status:** Aprovado (decisão arquitetural recebida do dono do sistema); esta etapa é diagnóstico e planejamento, não implementação.
- **Data:** 2026-07-16
- **Decisores:** dono do sistema (ChefeBot).

## Contexto

O incidente P0 registrado nesta mesma sequência de trabalho (painel de
pedidos parando de atualizar, bot do WhatsApp parando de responder) teve
como causa raiz comprovada o esgotamento da cota de comandos do Redis
(`upstash-kv-rose-flower`, plano Free, 500.000 comandos/mês), usado como
**único banco de dados** do sistema — tanto para dado permanente (pedidos,
histórico de conversa, fidelidade) quanto para dado efêmero (sessão, locks,
cooldowns).

A auditoria de código (`REDIS_KEY_INVENTORY.md`, `DATA_ARCHITECTURE.md`)
confirma que esse desenho tem dois problemas estruturais independentes do
plano de billing:

1. **Padrão de acesso incompatível com Redis como armazenamento primário
   de dado permanente:** chaves como `pedidos` e `conversa_full:{phone}`
   são blobs JSON únicos, lidos e reescritos por inteiro a cada mutação —
   custo O(n) por escrita, sem índice, sem transação, sem histórico de
   auditoria (mudar o status de um pedido apaga o status anterior sem
   deixar rastro).
2. **Polling agressivo de frontend** (painéis `/pedidos` e `/conversas`
   reconsultando a cada 3-8 segundos) multiplicado por esse custo O(n) —
   ver seção 3 de `DATA_ARCHITECTURE.md` para a evidência numérica.

Mesmo resolvendo a cota imediata (upgrade de plano, chamado já aberto com a
Upstash — Etapas A/B do plano de migração), esse desenho continuaria gerando
o mesmo tipo de incidente em uma escala maior, mais tarde, com uma conta
maior. A causa raiz de fundo não é "Redis é ruim" — é "Redis está sendo
usado como banco de dados relacional permanente, papel para o qual ele não
foi desenhado".

## Decisão

PostgreSQL passa a ser a fonte da verdade para todo dado permanente do
ChefeBot (lista completa em `DATABASE_MIGRATION_PLAN.md`, seção 1). Redis
passa, ao final do programa (Etapa K), a ser usado exclusivamente para dado
efêmero: sessão, locks/mutex, deduplicação, cooldown, rate limit, cache,
filas rápidas, indicadores temporários e estado do MCP.

A migração é gradual (Etapas A-K), com dual-write e comparação antes de
qualquer corte de fonte, e **não modifica o fluxo Pix Mercado Pago** em
nenhuma etapa — geração de copia-e-cola, webhook, polling, conciliação e
pagamento misto continuam exatamente como estão hoje, indefinidamente, até
uma decisão separada e explicitamente autorizada fora deste programa.

## Alternativas consideradas

### 1. Manter tudo no Redis, só resolver a cota (upgrade de plano)
Resolve o sintoma imediato, não a causa estrutural. O padrão de rewrite O(n)
por chave e o polling de 3s continuariam consumindo cota proporcionalmente
ao crescimento do negócio — mais pedidos e mais conversas por dia = mais
comandos por dia, sem limite superior natural. **Rejeitada como solução
única**, mas suas etapas (B: banco pay-as-you-go) continuam necessárias como
estabilização de curto prazo, em paralelo à migração de longo prazo.

### 2. Redis com estruturas melhores (Hash/List/Sorted Set em vez de blob JSON), permanecendo como banco principal
Reduziria o custo O(n) por escrita (ex. `HSET` de campo único em vez de
reescrever o pedido inteiro), mas não resolve a ausência de: transações
ACID entre tabelas relacionadas (ex. mudar status de pedido + creditar
fidelidade atomicamente), histórico de auditoria nativo, consultas
relacionais (relatórios financeiros, join entre pedido e cliente), backup
gerenciado com point-in-time recovery, e schema validado no nível do banco
(hoje qualquer TypeScript incorreto pode gravar um JSON malformado sem o
banco reclamar). **Rejeitada** — resolveria parte do problema de custo, não
o de modelo de dado.

### 3. PostgreSQL para tudo, incluindo sessão/locks/cache
Tecnicamente possível (Postgres suporta `SELECT ... FOR UPDATE`,
`LISTEN/NOTIFY`, TTL via job de limpeza), mas adiciona latência e contenção
de conexão para operações que precisam ser baratas e de altíssima
frequência (sessão de conversa lida/gravada a cada mensagem, lock de mutex
de curtíssima duração). Redis é estruturalmente melhor para esse padrão
(latência sub-milissegundo, TTL nativo, sem overhead de conexão SQL por
operação). **Rejeitada** — o objetivo de longo prazo do dono do sistema já
define isso explicitamente: Redis continua responsável por dado efêmero.

### 4. Outro banco de documentos (MongoDB, DynamoDB) em vez de PostgreSQL relacional
Manteria o padrão de blob JSON (menor esforço de modelagem inicial), mas
perpetuaria a ausência de transação relacional entre entidades que hoje
já precisam ser consistentes juntas (pedido + item + histórico de status +
fidelidade + referência de pagamento). O negócio do ChefeBot é
fundamentalmente relacional (cliente tem pedidos, pedido tem itens, pedido
tem histórico, cliente tem conta de fidelidade com transações) — é
exatamente o caso de uso para o qual um banco relacional com chaves
estrangeiras e constraints existe. **Rejeitada.**

## Justificativa da escolha (por que PostgreSQL relacional, não por conveniência)

- **Transação ACID nativa** para as operações que hoje dependem de lock Lua
  manual em Redis para simular atomicidade (`fidelidade.ts:persistirEstadoPontosSeDono`)
  — em Postgres, isso é uma transação `BEGIN`/`COMMIT` padrão, sem
  reimplementar compare-and-swap na aplicação.
- **Chave estrangeira e constraint `UNIQUE`** substituem, com garantia do
  próprio banco, os padrões de idempotência hoje implementados à mão
  (`chaveIdempotencia`, `eventoId`, `SET NX`) — menos código de
  coordenação customizado para manter e testar.
- **Auditoria nativa** (histórico de status, `audit_log`) resolve uma
  lacuna que hoje simplesmente não existe — o Redis atual não guarda o
  status anterior de um pedido depois que ele muda.
- **Ecossistema de backup gerenciado com point-in-time recovery** é padrão
  em qualquer oferta de Postgres gerenciado (Vercel Marketplace/Neon/
  Supabase) — resolve de raiz o problema levantado durante o incidente
  ("como fazer backup de um Redis que nem aceita comando de leitura quando
  a cota estoura").
- **Consulta relacional** (relatórios financeiros, join cliente↔pedido↔fidelidade)
  passa a ser SQL direto, em vez de carregar arrays inteiros na aplicação
  para filtrar/agregar em memória — que é literalmente o padrão atual
  (`getPedidos()` sempre carrega TODOS os pedidos para filtrar em
  JavaScript).

## Consequências

- **Positivas:** menor risco de incidente por cota; auditoria e histórico
  nativos; transação real entre entidades relacionadas; consultas
  analíticas viáveis sem carregar tudo em memória; Redis volta a operar
  dentro do padrão de uso para o qual foi desenhado (e portanto dentro de
  uma cota sustentável).
- **Negativas/custos:** complexidade operacional adicional (dois bancos em
  vez de um); necessidade de dual-write temporário (mais escrita durante a
  transição); curva de aprendizado de schema relacional para quem hoje só
  lida com blobs JSON; nova dependência de infraestrutura (conexão de
  banco, pool de conexões em ambiente serverless — Etapa D precisa decidir
  isso explicitamente, ex. `@vercel/postgres`/`pg` com pooling via
  PgBouncer/Neon serverless driver).
- **Risco aceito conscientemente:** durante as Etapas E-J (dual-write),
  existe uma janela em que o sistema depende dos dois bancos concordarem —
  mitigado pela Etapa F (comparação sustentada) antes de qualquer corte de
  leitura, e por rollback via flag em cada etapa individual.

## Escopo explicitamente fora desta decisão

O fluxo Pix Mercado Pago (geração de copia-e-cola, webhook, polling,
conciliação, pagamento misto) permanece fora desta ADR. `payment_references`
(seção 1.14 do plano de migração) é documentada como destino de longo prazo,
mas nenhuma etapa deste programa implementa escrita ou leitura ali sem
autorização explícita e separada, adicional às aprovações já dadas para as
Etapas A-K.
