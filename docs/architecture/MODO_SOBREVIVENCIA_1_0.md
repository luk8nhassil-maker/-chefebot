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
- `SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED` (padrão `false`, 5ª
  revisão de segurança) — com o núcleo ligado, endurece a validação de
  `clientRequestId`: um valor PRESENTE porém malformado passa a ser
  rejeitado (400) em vez de apenas ignorado. A ausência do campo nunca é
  rejeitada por esta flag (ver 2.5-E).
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
(64 chars hex, opaco) a partir de uma **serialização canônica recursiva**
de todos os campos capazes de mudar o significado da tentativa: cliente,
telefone, itens brutos (ordem preservada — trocar a ordem dos itens conta
como diferente), tipo de entrega, endereço completo (bairro/rua/
número/referência), observação, e-mail (normalizado: trim + lowercase),
pagamento/troco, resgateId, recompensaJornadaId e o sabor/escolha do
presente da Jornada do Chef (adicionados na 3ª revisão de segurança — antes
só cobriam um subconjunto dos campos). A normalização recursiva
(`normalizarRecursivo`) ordena alfabeticamente as CHAVES de cada objeto
(nunca depende da ordem de inserção do JSON recebido), preserva a ORDEM dos
elementos de arrays, aplica `trim()` em strings e trata `undefined`/ausente
de forma consistente (`null`) — dois clientes reenviando o mesmo conteúdo
lógico com formatação incidental diferente (espaços, maiúsculas no e-mail)
sempre produzem o mesmo fingerprint. Nunca guarda os dados legíveis — só o
hash. Um `clientRequestId` reutilizado com um fingerprint **diferente** é
tratado como conflito (409 genérico, nunca expõe dado do pedido anterior);
com o **mesmo** fingerprint, como retry legítimo.

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
2. **Busca por hash no pedido real** (`buscarPedidoPorClientRequestIdHash`,
   só se não havia `result` — ver seção 2.5 abaixo, correção da 3ª revisão):
   fecha a lacuna em que `:claim` já expirou (TTL 30s) e `:result` nunca
   chegou a ser gravado, mas o PEDIDO em si já existe de verdade. Fingerprint
   bate → reconstrói do pedido real e recria o `result` best-effort.
   Fingerprint não bate → 409 genérico. Falha de leitura → 503 recuperável.
3. **Claim** (`tentarReivindicarClaim`, só se não havia `result` nem pedido
   real encontrado por hash): `SET NX` no `claim`. Sucesso → segue para
   criar o pedido. Falha por chave já existir → inspeciona o fingerprint de
   quem possui o claim: mesmo fingerprint → espera (*polling* limitado no
   `result`, até ~1.8s) o resultado aparecer, senão 409 "ainda processando";
   fingerprint diferente → 409 genérico. **Qualquer** erro do Redis durante
   o `SET NX` ou o `GET` de inspeção (inclusive um `SET NX` que lança mas
   pode ou não ter sido aplicado do lado do servidor) é tratado como
   **incerto** — nunca prossegue como se tivesse reivindicado; devolve 503
   recuperável, carrinho preservado do lado do cliente (Etapa 2).
4. **Efeitos irreversíveis** só depois do claim confirmado (ponto 7 da
   revisão): vínculo de recompensa da Jornada do Chef, geração de número,
   criação de Pix, persistência do pedido. Todas as validações puras (sem
   escrita, sem reserva, sem Pix) já rodaram antes — um payload inválido
   nunca chega a tocar uma chave `survival:*`.
5. Após `redis.set("pedidos", ...)` ter sucesso, grava **imediatamente** o
   `result` mínimo — antes de qualquer operação que ainda possa falhar
   (confirmação de resgate, fidelidade, `getConfigPix`/Pix). Se essa
   gravação falhar, o claim **nunca é apagado** (evita reabrir a janela de
   duplicação); expira sozinho pelo TTL curto. **O pedido persistido carrega
   ele mesmo um hash do `clientRequestId` + o fingerprint** (passo 2 acima
   depende disso), então mesmo se `:claim` e `:result` desaparecerem os
   dois, o pedido real continua localizável e nunca é duplicado.
6. Falhas **depois** da persistência (`getConfigPix`, serialização do Pix,
   ou qualquer exceção não prevista) nunca viram um 500 cru: a resposta
   volta `ok: true` com o `pedidoId`/`numero`/`statusToken` reais e
   `degradado: true`, nunca fingindo que o pedido não existe.
7. Rollback do resgate (falha em `confirmarResgatePontos` depois de
   persistir): o pedido é removido de verdade — nesse caso (e só nesse
   caso) o `result` é apagado e o claim liberado, permitindo um retry
   legítimo criar um pedido novo, em vez de ficar preso a "processando" por
   até 24h.

`src/app/api/pedido-app/route.ts`: com a flag desligada (padrão), zero
mudança de comportamento e zero comando Redis extra — o bloco inteiro fica
atrás de `if (clientRequestId)`, que só deixa de ser `null` quando
`SURVIVAL_MODE_ENABLED=true` e o campo enviado é válido.

### 2.5-A Prova durável dentro do próprio pedido (3ª revisão de segurança)

**Problema fechado nesta revisão**: mesmo com o desenho de `:claim`/`:result`
acima, existia uma lacuna real — se o pedido for persistido, a gravação do
`:result` falhar (ou o processo for encerrado antes de tentar gravá-la), a
resposta se perder (timeout) e o `:claim` (TTL 30s) expirar antes do
cliente reenviar, um retry posterior não encontrava `:claim` nem `:result`
e podia criar um segundo pedido — mesmo a execução original já ter
terminado não ajuda, porque **o pedido que ela criou continua existindo**.

**Correção**: o próprio objeto do pedido, dentro de `pedidos`, passa a
carregar dois campos internos (só quando `clientRequestId` foi fornecido):

- `survivalClientRequestIdHash` — SHA-256 (`hashClientRequestId`, em
  `src/survival/clientRequestId.ts`) do `clientRequestId`, **nunca o valor
  bruto**.
- `survivalRequestFingerprint` — o mesmo fingerprint já calculado para o
  claim/result.

Antes de reivindicar um novo claim (quando `:result` não existe),
`buscarPedidoPorClientRequestIdHash` procura em `pedidos` (leitura fresca,
não a snapshot inicial da requisição) um pedido com esse hash:

- **Encontrado + fingerprint igual** → reconstrói a resposta do pedido real
  (mesma função `montarRespostaAPartirDoPedido` usada pelo fast path) e
  recria o `:result` best-effort (acelera retries futuros, não é crítico se
  falhar) — **nunca cria um segundo pedido**.
- **Encontrado + fingerprint diferente** → 409 genérico, sem vazar dado do
  pedido anterior.
- **Não encontrado** → segue normalmente para tentar reivindicar o claim.
- **Falha ao ler `pedidos`** → tratado como incerto (503), nunca prossegue
  sem essa verificação.

Esses campos **nunca aparecem em recibos, mensagens do WhatsApp, ou
qualquer API pública** — auditado explicitamente: todos os pontos de
leitura voltados ao cliente (`montarStatusPublicoPedido` em
`/api/pedido-app/status`, `/api/pedido-app/[id]/editar/status`,
`/api/pedido-app/pagamento-pix`) projetam campos explícitos nomeados, nunca
espalham (`...pedido`) o objeto inteiro numa resposta pública. As
mensagens de WhatsApp (`notificarCliente`, `getMensagemStatus`) são sempre
texto construído explicitamente, nunca um dump do objeto.

### 2.5-B Estado de consistência crítica do pedido (4ª e 5ª revisões de segurança)

**Problema fechado na 4ª revisão**: a ordem original gravava o `:result`
(`state: "completed"`) logo após persistir o pedido, **antes** de confirmar
o resgate de fidelidade (`confirmarResgatePontos`). Se a confirmação do
resgate falhasse, o código tentava reverter o pedido (remover de
`pedidos`) — mas se essa reversão TAMBÉM falhasse (o próprio `GET`/`SET` de
`pedidos` do rollback lançando), a exceção escapava para o catch externo,
que via `pedidoIdCriado` preenchido e devolvia `ok: true, degradado: true`
— **confirmando ao cliente um pedido com desconto cujo débito nunca foi
confirmado nem revertido**. Havia ainda um segundo problema: o rollback
apagava o `:result` sem verificar se ainda era o mesmo registro (`DEL`
cego), arriscando apagar o resultado de uma execução concorrente mais nova.

**Correção — estado explícito por pedido** (`SurvivalPedidoState`, campo
`survivalState`, nunca exposto ao cliente):

- `pending_critical_confirmation` — pedido persistido, mas o resgate (o
  único efeito crítico posterior à persistência hoje) ainda não foi
  confirmado.
- `completed` — sem efeito crítico pendente (pedidos sem resgate já nascem
  neste estado) ou o resgate foi confirmado com sucesso E a transição para
  `completed` foi comprovadamente persistida (ver 5ª revisão abaixo).
- `recovery_required` — a confirmação do resgate falhou E o rollback do
  pedido TAMBÉM falhou; ou o resgate foi confirmado com sucesso mas a
  própria transição para `completed` não pôde ser persistida. Tratado de
  forma idêntica a `pending_critical_confirmation` por
  `survivalStateBloqueiaSucesso` (nunca sucesso), mas logado com um código
  distinto (`falha_critica_rollback` / `falha_ao_marcar_completed`) para
  investigação operacional. A rota **tenta ativamente** persistir este
  estado (best-effort) em ambos os casos — se essa tentativa também falhar
  (mesma causa raiz que impediu a transição original), o pedido permanece
  registrado como `pending_critical_confirmation`; o efeito de bloqueio é
  idêntico em qualquer um dos dois, só a rotulagem exata no dado persistido
  pode não refletir `recovery_required` quando o próprio Redis impede
  qualquer escrita adicional.

**5ª revisão — o retorno de `marcarSurvivalStateDoPedido` nunca é
ignorado**: a rota original chamava `marcarSurvivalStateDoPedido(pedidoId,
"completed")` sem checar o boolean que a função já retornava. Se essa
transição falhasse (o `GET` ou o `SET` de `pedidos` dentro dela lançando), o
pedido continuava `pending_critical_confirmation`, mas a rota seguia adiante
e podia gravar `:result` como `completed` e devolver `ok: true` mesmo assim
— um retry posterior encontraria o pedido pendente e devolveria 503,
divergindo da primeira resposta (que já tinha confirmado sucesso). Corrigido: o
boolean é sempre verificado; se `false`, a rota tenta best-effort marcar
`recovery_required`, loga `"falha_ao_marcar_completed"` e retorna **503
`unresolved: true` diretamente — nunca `ok: true`, nunca grava `:result`**.
Importante: este caso NUNCA tenta reverter (remover) o pedido — o resgate já
foi debitado de verdade nesse ponto; desfazer o pedido duplicaria o
problema (débito real sem pedido correspondente). `:result` só é gravado
DEPOIS de `marcarSurvivalStateDoPedido` retornar `true` comprovadamente.

**Ordem segura, única e auditável** (`marcarSurvivalStateDoPedido`,
`gravarResultadoDuravel`): persistir pedido (`pending_critical_confirmation`
se houver resgate, `completed` se não houver) → confirmar resgate (se
houver) → marcar `completed` **com retorno verificado** → **só então**
gravar `:result` → liberar claim → responder sucesso.
`buscarPedidoPorClientRequestIdHash` e `reconstruirRespostaPedido` (fast
path) verificam `survivalState` antes de reconstruir qualquer sucesso — um
pedido `pending_critical_confirmation`/`recovery_required` encontrado por
qualquer um dos dois caminhos devolve sempre 503 recuperável, nunca
sucesso, **mesmo depois de o `:claim` já ter expirado** (o campo no próprio
pedido é a barreira, não uma chave efêmera). A checagem
(`survivalStateBloqueiaSucesso`) recebe o pedido inteiro, não só o campo:
bloqueia qualquer `survivalState` diferente de `"completed"` — incluindo
`undefined`/malformado — SE o pedido carrega `survivalClientRequestIdHash`
(ou seja, passou pelo Modo Sobrevivência); pedidos antigos, sem esse
campo, nunca são bloqueados por esta checagem (comportamento pré-existente
preservado).

**Falha dupla (confirmação + rollback) tratada localmente**: o `catch`
aninhado em torno do rollback nunca deixa a exceção escapar para o catch
externo — tenta best-effort marcar `recovery_required`, responde
diretamente 503 (`unresolved: true`) e loga `"falha_critica_rollback"`. Isso
elimina a necessidade da regra genérica antiga "toda exceção depois da
persistência vira sucesso degradado": ela foi **removida** do catch
externo. As únicas falhas que ainda podem gerar `ok: true, degradado: true`
são as já isoladas em seus próprios `try/catch` locais (notificação push,
pontos previstos best-effort, `getConfigPix`/serialização do Pix para
exibição) — nenhuma delas propaga exceção até o catch externo. Qualquer
exceção que ainda chegue lá depois da persistência é, por definição, um
caso não coberto por nenhuma recuperação local — vira 503 recuperável,
nunca sucesso.

**`:result` stale vs. leitura incerta, com invalidação ATÔMICA (4ª e 5ª
revisões)** (`reconstruirRespostaPedido`, `buscarPedidoPersistidoPorId`,
`invalidarResultadoStaleAtomico`): as duas situações (falha de leitura vs.
ausência real) eram indistinguíveis antes da 4ª revisão. A 4ª revisão as
distinguiu, mas a invalidação ainda era um `GET` seguido de um `DEL`
separado — não atômico: entre as duas chamadas, uma execução concorrente
podia gravar um resultado novo que o `DEL` apagaria por engano. A 5ª
revisão substitui isso por um **compare-and-delete atômico via Lua**
(`INVALIDAR_RESULTADO_SE_TOKEN_SCRIPT`): o registro `:result` agora carrega
um `resultToken` aleatório forte, espelhado numa chave-token companheira
plana (`:result:token`); o script compara e apaga AMBAS as chaves numa
única operação atômica, retornando um de quatro resultados explícitos:
`removido` | `ja_ausente` | `substituido_por_outro` | (erro → tratado como
`incerto`). Regras: falha ao ler `pedidos` durante a reconstrução → sempre
incerto (503), nunca mexe no `:result`; leitura bem-sucedida e pedido
comprovadamente ausente → `:result` é stale, invalidação tentada; `removido`
ou `ja_ausente` → segue como se `:result` nunca tivesse existido;
`substituido_por_outro` (uma execução concorrente gravou um `:result` novo
entre a nossa leitura e a invalidação) → a consulta é REINICIADA (nunca
assume nada sobre o registro novo), até um limite de 3 tentativas antes de
pedir para o cliente aguardar. `ehResultadoIdempotenciaValido` também
passou a validar rigorosamente todos os campos (formato SHA-256 do
fingerprint, números finitos, strings não vazias, `resultToken` com pelo
menos 32 caracteres) — um registro malformado nunca é tratado como válido.

### 2.5-C Identidade estável da tentativa antes de qualquer efeito externo (5ª revisão de segurança)

**Problema fechado nesta revisão**: `pedidoId = Date.now().toString()` era
recalculado a cada execução da rota — inclusive em retries. O `txid` do Pix
(`gerarTxidPixInterno(pedidoId)`) e, por consequência, a
`X-Idempotency-Key` do Mercado Pago (`gerarIdempotencyKey(txid)`, em
`src/lib/mercadoPagoPix.ts`) são funções puras e determinísticas de
`pedidoId`. Consequência: se `prepararPixProviderMercadoPago` criasse a
cobrança Pix com sucesso mas a persistência de `pedidos` falhasse logo
depois (claim liberado, resposta perdida do ponto de vista do cliente), um
retry com o MESMO `clientRequestId` gerava um `pedidoId` NOVO (outro
`Date.now()`) e, portanto, um `txid`/`X-Idempotency-Key` novos — o Mercado
Pago via isso como uma tentativa de pagamento totalmente distinta e podia
criar uma **segunda cobrança real**.

**Correção — registro "attempt"** (`src/survival/pedidoIdempotencia.ts`,
`obterOuCriarAttempt` em `route.ts`): uma quarta chave,
`survival:idempotencia:pedido:{clientRequestId}:attempt` (TTL 24h, igual ao
`:result`), criada atomicamente (`SET NX`) com `pedidoId`/`txid` ANTES de
qualquer efeito externo — antes do vínculo da Jornada do Chef, antes de
`proximoNumeroPedido`, antes da criação da cobrança Pix. Se a chave já
existir (retry de uma tentativa anterior, mesmo que ela nunca tenha
persistido o pedido), o attempt é recuperado em vez de recriado: mesmo
fingerprint → reutiliza o MESMO `pedidoId`/`txid` já reivindicados;
fingerprint diferente → 409 genérico; falha de leitura/escrita → 503
`unresolved: true` (mantém o claim — nunca prossegue às cegas, poderia
gerar um `pedidoId` divergente do já eventualmente usado numa cobrança
anterior). A partir da resolução do attempt, `pedidoId` deixa de ser
recalculado — toda a rota (Jornada, Pix, persistência, idempotência) usa
essa MESMA variável.

O registro nunca contém PII, QR, copia-e-cola ou credencial — só
`state` (`in_progress`/`completed`, informativo), `requestFingerprint`,
`pedidoId`, `txid`, `createdAt`, `updatedAt`.

Isto **não substitui** a necessidade de um `pedidoId` globalmente único
entre `clientRequestId`s diferentes (ver
`docs/architecture/DECISAO-CONCORRENCIA-CHAVE-PEDIDOS.md`, seção 6.1) — o
attempt resolve a estabilidade INTRA-tentativa (mesmo `clientRequestId`
sempre com a mesma identidade), não a colisão entre tentativas distintas.

### 2.5-D Compensação uniforme da Jornada do Chef para qualquer falha pré-persistência (5ª revisão de segurança)

**Problema fechado nesta revisão**: `confirmarReservaNoPedido` (vínculo da
recompensa ao `pedidoId`) acontece antes de `proximoNumeroPedido`,
`criarPixMetadata` e `prepararPixProviderMercadoPago` — mas a liberação do
vínculo (`liberarVinculoRecompensaPedidoNaoCriado`) só existia dentro do
`catch` da persistência (`redis.set("pedidos", ...)`). Uma exceção em
qualquer passo ANTES disso (por exemplo, `proximoNumeroPedido` falhando)
escapava sem passar por nenhuma compensação, deixando o vínculo da
recompensa preso indefinidamente (a recompensa nunca mais podia ser
reservada, mesmo com o pedido nunca criado).

**Correção**: o `try` que envolve a persistência foi estendido para cobrir
TODO o espaço entre o vínculo da Jornada e o `redis.set("pedidos", ...)` —
`proximoNumeroPedido`, criação do token público, `criarPixMetadata`,
`prepararPixProviderMercadoPago` e a montagem do objeto do pedido agora
compartilham o MESMO `catch`, que libera o vínculo da recompensa e o claim
de idempotência de forma idêntica, qualquer que seja o passo que falhou.
Como `pedidoId`/`txid` já são estáveis (2.5-C), um retry que refizer essa
preparação — inclusive recriando a cobrança Pix — reutiliza a MESMA
`X-Idempotency-Key`, então o Mercado Pago nunca gera uma segunda cobrança
real mesmo que o provider já tenha sido chamado antes da exceção original.

### 2.5-E Ativação segura do enforcement de `clientRequestId` (5ª revisão de segurança)

Com `SURVIVAL_MODE_ENABLED=true`, um `clientRequestId` presente porém em
formato inválido (fora do padrão de `sanitizeClientRequestId`) era
simplesmente ignorado, sem qualquer log/visibilidade, e o pedido seguia
sendo criado sem proteção de idempotência para aquela tentativa. Uma nova
flag separada, `SURVIVAL_CLIENT_REQUEST_ID_ENFORCEMENT_ENABLED` (padrão
`false`, `src/survival/flags.ts`), permite endurecer esse comportamento sem
quebrar clientes antigos:

- Enforcement desligado (padrão): comportamento anterior preservado (pedido
  criado sem proteção), mas agora com um log sanitizado
  (`formato_invalido_ignorado`) para dar visibilidade operacional.
- Enforcement ligado: um `clientRequestId` PRESENTE e malformado é
  rejeitado com 400. A AUSÊNCIA do campo nunca é rejeitada por esta
  checagem — só o valor presente e inválido.

Rollout esperado: PR1/PR2 mantêm as duas flags desligadas; a UI passa a
gerar e persistir um `clientRequestId` válido; só depois de confirmar que
o valor está chegando corretamente na maioria das tentativas é que o
enforcement seria considerado para ativação — decisão operacional, fora do
escopo deste PR (nenhuma das duas flags é ativada aqui).

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
  chave `survival:*`, nunca chama `DEL`, nunca cria pedido;
- **(3ª revisão) recuperação após expiração de `:claim` e `:result`**:
  gravação do `:result` falha (ou ambas as chaves são apagadas, simulando
  processo encerrado/TTL) depois do pedido já persistido → retry recupera o
  MESMO pedido via hash gravado nele, `pedidos.length` permanece 1, nenhuma
  segunda cobrança Pix; fingerprint diferente nesse cenário → 409 genérico;
  falha ao ler `pedidos` durante essa busca → 503, nunca cria pedido;
- **(3ª revisão) fingerprint completo**: observação e e-mail diferentes →
  409; mesmos dados com formatação incidental diferente (espaços,
  maiúsculas no e-mail) → retry legítimo; conflito nunca devolve
  `pedidoId`/`statusToken`/`total`/`pix` do pedido anterior;
- **(3ª revisão) reconstrução do Pix no retry**: provado explicitamente
  para Pix válido/pendente, confirmado por caminho independente (webhook),
  sem QR (cai para manual), e indisponível (pagamento não-Pix) — em todos
  os casos, `criarCobrancaPixMercadoPago` nunca é chamado uma segunda vez.

Suíte completa passando, typecheck sem novos erros (183 pré-existentes,
iguais ao baseline), lint limpo nos arquivos alterados, build de produção
OK — números exatos na descrição do PR (mudam a cada push).

### 2.9 Custo de Redis adicional (com a flag ligada)

- Caminho feliz (pedido novo, sem disputa, `:result` nunca existiu): **+5
  comandos** por pedido — 1 `GET` do `:result` (fast path, miss) + 1 `GET`
  de `pedidos` (busca por hash, miss — adicionado na 3ª revisão) + 1
  `SET NX` (claim) + 1 `SET NX` (attempt, 5ª revisão — identidade estável
  antes do Pix/Jornada) + 1 `SET` do resultado durável + 1 `SET` da
  chave-token companheira do resultado (5ª revisão — invalidação atômica).
  O claim é liberado ao final via `EVAL` (compare-and-delete), +1 comando
  best-effort. A busca por hash reaproveita a MESMA chave `pedidos` já lida
  no fluxo normal (nenhuma chave nova) — o "+1 GET" é uma segunda leitura
  fresca dessa mesma chave, não uma estrutura de dado adicional. Pedidos com
  resgate de fidelidade somam mais 1 `GET`+`SET` de `pedidos` para marcar
  `survivalState: "completed"` após a confirmação (4ª/5ª revisão).
- Fast path (resultado já existe, retry ou conflito): 1 `GET` — mais barato
  que uma criação completa, a requisição retorna antes de tocar
  `pedidos`/menu/promoções.
- Recuperação via hash (`:result` ausente mas pedido real já existe — o
  cenário que a 3ª revisão fecha): 2 `GET`s (`:result` miss + `pedidos`
  hit) + 1 `SET` best-effort para recriar o `:result` + 1 `SET` da
  chave-token — ainda mais barato que uma criação completa.
- Invalidação de `:result` stale (5ª revisão): 1 `EVAL` atômico adicional
  (compare-and-delete da chave-token + registro principal) antes de seguir
  para a busca por hash; em caso de `substituido_por_outro` (raríssimo), a
  consulta é reiniciada até 3 vezes no total.
- Disputa concorrente (raro, mesmo `clientRequestId` em paralelo): até ~10
  comandos no lado que perde a corrida (2 `GET`s do fast path/hash + 1
  `SET NX` do claim + 1 `SET NX`/`GET` do attempt + 1 `GET` de inspeção do
  claim + até 6 `GET`s de polling), *bounded*, nunca ilimitado.
- Com a flag desligada (estado deste PR em Production): **0 comandos
  extras** — o bloco inteiro nem executa.
