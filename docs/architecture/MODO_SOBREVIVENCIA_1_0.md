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
   criações concorrentes (raro, mas existente). Formalizado como decisão
   técnica pendente em `docs/architecture/DECISAO-CONCORRENCIA-CHAVE-PEDIDOS.md`
   (seção 2.7 abaixo) — bloqueia a ativação de `SURVIVAL_MODE_ENABLED` em
   Production até ser revisado.
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
  todo o bloco de idempotência (fast path, claim, efeitos de liberação) fica
  atrás de `if (clientRequestId)`, que só deixa de ser `null` quando
  `SURVIVAL_MODE_ENABLED === "true"` e o campo é válido. Com a flag
  ausente/`false` (padrão), o comportamento é idêntico ao anterior a este
  programa — reverter é opcional (basta manter a flag desligada) ou trivial
  via `git revert`.
- Nenhuma migração de dado, nenhuma alteração de schema Redis existente,
  nenhuma nova dependência de infraestrutura paga.
- Ativação em Production adicionalmente bloqueada até a revisão de
  `docs/architecture/DECISAO-CONCORRENCIA-CHAVE-PEDIDOS.md` (seção 2.7).

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

- `gerarClientRequestId()`: UUID v4 via `crypto.randomUUID()`, com fallback
  para `crypto.getRandomValues()` — **nunca** `Date.now()`/`Math.random()`
  (removido na 2ª revisão de segurança: um ID previsível permitiria
  adivinhar/colidir com o de outro cliente). Na ausência de qualquer fonte
  de aleatoriedade criptográfica, lança um erro controlado em vez de gerar
  um valor inseguro.
- `sanitizeClientRequestId(raw)`: aceita só `[a-zA-Z0-9_-]{16,100}`
  (mínimo elevado de 8→16 na 1ª revisão de segurança — ~95 bits de entropia
  se aleatório, contra enumeração/força bruta do cache, que pode devolver o
  pedido inteiro incluindo dados de Pix), nunca aceita telefone/PII, nunca
  lança.

### 2.4 Fingerprint da tentativa (`src/survival/requestFingerprint.ts`)

Um `clientRequestId` sozinho **não prova** que duas requisições são a mesma
tentativa — um cliente malicioso (ou um bug) poderia reaproveitar o ID de
outro payload. `calcularRequestFingerprint(...)` produz um hash SHA-256
(64 chars hex, opaco) a partir de uma serialização canônica (ordem de chaves
fixa) dos campos que definem a tentativa: cliente, telefone, itens brutos,
tipo de entrega, endereço, pagamento/troco, resgateId, recompensaJornadaId.
Nunca guarda os dados legíveis — só o hash. Um `clientRequestId` reutilizado
com um fingerprint **diferente** é tratado como conflito (409 genérico,
nunca expõe dado do pedido anterior); com o **mesmo** fingerprint, como
retry legítimo.

### 2.5 Idempotência de criação de pedido — claim atômico + resultado durável (`src/survival/pedidoIdempotencia.ts`)

Desenho com **duas chaves separadas** por `clientRequestId`, revisado duas
vezes por auditoria de segurança independente (ver histórico do PR):

- **`...{id}:claim`** — reivindicação efêmera. `CLAIM_TTL_SEGUNDOS = 30`,
  deliberadamente maior que `maxDuration=20s` da rota, **com margem de
  segurança**: se o TTL expirar, a execução original já foi encerrada à
  força pela plataforma (Vercel mata a função em 20s), então ela nunca pode
  "voltar" e duplicar o pedido depois que outra execução reivindicou a
  chave de novo. Valor gravado: `${ownerToken}::${requestFingerprint}`
  (string simples, nunca JSON) — `ownerToken` é um `randomUUID()` novo por
  requisição, usado para um **compare-and-delete atômico via Lua**
  (`LIBERAR_CLAIM_SE_DONO_SCRIPT`, mesmo padrão/script já usado em
  `src/lib/mercadoPagoReconciliacao.ts:LIBERAR_LOCK_SE_DONO_SCRIPT`) —
  garante que uma execução antiga (já expirada e cuja chave foi
  reivindicada de novo por outra execução) nunca apaga nem sobrescreve a
  reivindicação da execução nova.
- **`...{id}:result`** — registro durável (TTL 24h, mesma janela do
  `idempotencyKey` de webhook do WhatsApp já existente), escrito **uma
  única vez**, logo após a persistência real do pedido (`redis.set("pedidos", ...)`
  já ter tido sucesso) — nunca antes. Guarda só `pedidoId`/`numero`/
  `statusToken`/`requestFingerprint` — **nunca `total` nem `pix`**, que são
  sempre reconstruídos a partir do pedido real + config atual no momento do
  retry (nunca uma cobrança Pix antiga/expirada é devolvida às cegas).

Fluxo de uma requisição com `clientRequestId` válido (flag ligada):

1. **Fast path** (`consultarResultadoExistente`): já existe um `result`
   durável? Fingerprint bate → reconstrói e devolve a resposta atual
   (retry legítimo). Fingerprint não bate → 409 genérico. Falha de leitura
   → resposta recuperável 503 (nunca assume nada).
2. **Claim** (`tentarReivindicarClaim`, só se não havia `result`): `SET NX`
   no `claim`. Sucesso → segue para criar o pedido. Falha por chave já
   existir → inspeciona o fingerprint de quem possui o claim: mesmo
   fingerprint → espera (*polling* limitado no `result`, até ~1.8s) o
   resultado aparecer, senão 409 "ainda processando"; fingerprint diferente
   → 409 genérico. **Qualquer** erro do Redis durante o `SET NX` ou o `GET`
   de inspeção (inclusive um `SET NX` que lança mas pode ou não ter sido
   aplicado do lado do servidor) é tratado como **incerto** — nunca
   prossegue como se tivesse reivindicado; devolve 503 recuperável, carrinho
   preservado do lado do cliente (Etapa 2).
3. **Efeitos irreversíveis** só depois do claim confirmado (ponto 7 da
   revisão): vínculo de recompensa da Jornada do Chef, geração de número,
   criação de Pix, persistência do pedido. Todas as validações puras (sem
   escrita, sem reserva, sem Pix) já rodaram antes — um payload inválido
   nunca chega a tocar uma chave `survival:*`.
4. Após `redis.set("pedidos", ...)` ter sucesso, grava **imediatamente** o
   `result` mínimo — antes de qualquer operação que ainda possa falhar
   (confirmação de resgate, fidelidade, `getConfigPix`/Pix). Se essa
   gravação falhar, o claim **nunca é apagado** (evita reabrir a janela de
   duplicação); expira sozinho pelo TTL curto.
5. Falhas **depois** da persistência (`getConfigPix`, serialização do Pix,
   ou qualquer exceção não prevista) nunca viram um 500 cru: a resposta
   volta `ok: true` com o `pedidoId`/`numero`/`statusToken` reais e
   `degradado: true`, nunca fingindo que o pedido não existe.
6. Rollback do resgate (falha em `confirmarResgatePontos` depois de
   persistir): o pedido é removido de verdade — nesse caso (e só nesse
   caso) o `result` é apagado e o claim liberado, permitindo um retry
   legítimo criar um pedido novo, em vez de ficar preso a "processando" por
   até 24h.

`src/app/api/pedido-app/route.ts`: com a flag desligada (padrão), zero
mudança de comportamento e zero comando Redis extra — o bloco inteiro fica
atrás de `if (clientRequestId)`, que só deixa de ser `null` quando
`SURVIVAL_MODE_ENABLED=true` e o campo enviado é válido.

### 2.6 Rascunho local versionado (`src/survival/draftStorage.ts`)

- Chave `survival:pedido:rascunho:v1`, schema versionado (`v: 1`), TTL de
  24h, `localStorage` (sobrevive ao fechamento do navegador, diferente do
  `cf_draft` em `sessionStorage` que continua existindo sem alteração).
- Payload deliberadamente restrito a: carrinho (opaco, `unknown[]`),
  entrega/retirada, endereço, observação, forma de pagamento, troco, etapa
  atual, `clientRequestId`. Sem token, cookie, QR Pix, dado de cartão,
  segredo ou credencial — por construção de tipo, não por convenção.
- **Ainda não conectado à UI do checkout** (`src/app/cardapio/page.tsx`) —
  essa integração é da Etapa 2 (UI de fallback manual), que é quem
  efetivamente precisa exibir/reidratar esse rascunho. `localStorage` **nunca
  é fonte de verdade sobre a existência do pedido** — só ajuda a UI a saber
  qual `clientRequestId` reenviar; se se perder, o pior caso é o cliente
  recomeçar o checkout (novo pedido, comportamento de hoje), nunca um pedido
  fantasma ou uma duplicidade.

### 2.7 Risco estrutural conhecido, deliberadamente fora do escopo deste PR

A chave `pedidos` (array JSON único, lido/reescrito por inteiro a cada
criação) continua tendo uma corrida read-modify-write **pré-existente**
entre duas requisições com `clientRequestId` **diferentes** (dois clientes
reais pedindo ao mesmo tempo) — a idempotência deste PR só protege contra
duplicidade da MESMA tentativa, não contra a perda silenciosa de um pedido
alheio concorrente. Ver
`docs/architecture/DECISAO-CONCORRENCIA-CHAVE-PEDIDOS.md` para a análise
completa, opções de mitigação (lock curto vs. append atômico via Lua) e o
bloqueio explícito: **`SURVIVAL_MODE_ENABLED` não deve ser ativado em
Production até essa decisão separada ser revisada e aprovada.**

### 2.8 Testes

Cobre, em `src/survival/*.test.ts` + `route.test.ts` +
`route.resgate.test.ts`: flags (default off, comparação estrita, modo
forçado), modelo de estados, geração/validação de `clientRequestId` (mínimo
de 16 chars, nunca `Date.now()`/`Math.random()` como fallback), fingerprint
determinístico (cliente/itens/endereço/pagamento diferentes → hash
diferente), chaves/constantes de idempotência, e o comportamento completo
da rota:

- primeiro pedido criado normalmente; flag desligada preserva o
  comportamento de hoje (sem proteção, dois envios = dois pedidos);
- retry com o mesmo `clientRequestId` + mesmo payload devolve o pedido já
  criado, **reconstruído a partir do dado fresco** (Pix/config atual, nunca
  cacheado às cegas);
- duas requisições **simultâneas** com o mesmo `clientRequestId` (via
  `Promise.all`) nunca criam dois pedidos — prova o claim atômico;
- **claim com resultado incerto** (SET NX lança exceção; SET NX bloqueado e
  o GET de inspeção falha; leitura do resultado durável falha): nunca cria
  pedido, sempre 503 recuperável — nunca sucesso fabricado;
- **fingerprint diferente** com o mesmo `clientRequestId` (cliente, itens,
  endereço ou pagamento diferentes): sempre 409 genérico, nunca duplica,
  nunca vaza dado do pedido anterior na resposta de conflito;
- **compare-and-delete por ownerToken**: uma execução antiga nunca apaga
  nem sobrescreve a reivindicação de uma execução nova (simulado via mock
  do script Lua);
- **rollback do resgate** (`route.resgate.test.ts`): falha ao confirmar o
  resgate libera claim e resultado de verdade — um retry legítimo consegue
  criar um pedido novo, nunca fica preso a "processando" por até 24h;
- **recuperação pós-persistência**: `getConfigPix`/serialização do Pix
  falhando depois de o pedido já existir nunca vira 500 cru — resposta
  `ok: true` + `degradado: true`, e um retry recupera o mesmo pedido;
- **nunca cacheia Pix cegamente**: o registro durável nunca contém
  `total`/`pix`; se a reconstrução falhar no retry, a resposta vem sem
  `pix` (degradada) em vez de inventar dado ou gerar nova cobrança;
- **claim só depois das validações puras**: payload inválido nunca cria
  chave `survival:*`, nunca chama `DEL`, nunca cria pedido.

Suíte completa passando, typecheck sem novos erros (183 pré-existentes,
iguais ao baseline), lint limpo nos arquivos alterados, build de produção
OK — números exatos na descrição do PR (mudam a cada push).

### 2.9 Custo de Redis adicional (com a flag ligada)

- Caminho feliz (pedido novo, sem disputa): **+2 comandos** por pedido — 1
  `SET NX` (claim) + 1 `SET` do resultado durável. O claim é liberado ao
  final via `EVAL` (compare-and-delete), +1 comando best-effort.
- Fast path (resultado já existe, retry ou conflito): 1 `GET` — mais barato
  que uma criação completa, a requisição retorna antes de tocar
  `pedidos`/menu/promoções.
- Disputa concorrente (raro, mesmo `clientRequestId` em paralelo): até ~8
  comandos no lado que perde a corrida (1 `SET NX` + 1 `GET` de inspeção +
  até 6 `GET`s de polling), *bounded*, nunca ilimitado.
- Com a flag desligada (estado deste PR em Production): **0 comandos
  extras** — o bloco inteiro nem executa.
