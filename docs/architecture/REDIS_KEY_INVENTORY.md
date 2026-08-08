# Inventário de chaves Redis — ChefeBot

> Levantamento feito por auditoria direta do código-fonte (`grep`/leitura de
> cada arquivo que chama `redis.*`), não por inspeção do banco em produção
> (sem acesso a `SCAN`/`KEYS` de produção nesta etapa). Cobre 100% dos
> arquivos em `src/` que importam `@/lib/redis`. Onde a contagem exata de
> comandos por operação não pôde ser cravada sem instrumentação, isso está
> marcado como **estimativa**.
>
> Legenda de criticidade: 🔴 crítico (perda = incidente para o negócio) ·
> 🟡 importante (perda = degradação, não incidente) · ⚪ descartável.

## 1. Pedidos (core do negócio)

| Chave | Lê (arquivo:função) | Grava (arquivo:função) | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `pedidos` (array único, todos os pedidos) | `src/app/api/orders/route.ts:getPedidos`, `src/lib/pixSentinela.ts:solicitarVerificacaoOficialPix`, `src/app/api/pedido-status/route.ts`, `src/app/api/entregador-pedidos/route.ts`, `src/app/api/pedido-combinado/route.ts` (leitura ampla, múltiplos consumidores) | `src/app/api/orders/route.ts:PATCH/POST/DELETE`, `src/app/api/whatsapp/route.ts` (múltiplos pontos: confirmação de pedido, comprovante Pix, avaliação, edição), `src/lib/pedidoEdicao.ts` (via GET com limpeza preguiçosa) | String (JSON array inteiro) | não | 🔴 | Permanente | **PostgreSQL** (`orders` + `order_items`) |
| `pedido:edit:mutex:{id}` | `src/lib/pedidoEdicao.ts:lockEdicaoAtivo` (indireto) | `src/lib/pedidoEdicao.ts:adquirirMutexEdicao/liberarMutexEdicao` | String (SET NX) | 8s | 🟡 | Efêmero | **Redis** (lock) |
| `contador_pedidos:{data}` | — | `src/lib/numeracao.ts:proximoNumeroPedido` | String (INCR) | 36h | 🟡 | Efêmero (reset diário) | **Redis** (contador rápido) — mas fonte oficial do número final deve ser sequência do Postgres |
| `entregador:pedidos:{entregadorId}` | `src/app/api/entregador-pedidos/route.ts` | `src/app/api/orders/route.ts:PATCH` (ao sair para entrega) | String (JSON array) | 24h | 🟡 | Semi-permanente | **PostgreSQL** (`orders.status_history` + view de fila do entregador) |
| `entregador_aguardando:{phone}`, `entregador_escolhendo:{phone}` | `src/app/api/whatsapp/route.ts` | idem | String | 3h | ⚪ | Efêmero | **Redis** |
| `avaliacao_enviada:{pedidoId}`, `avaliacao:{phone}` | `src/app/api/whatsapp/route.ts` | `src/app/api/orders/route.ts:PATCH`, `whatsapp/route.ts` | String (flag idempotência) | 1h–24h | ⚪ | Efêmero | **Redis** (dedup) |
| `avaliacoes` (array de avaliações recebidas) | não localizado consumidor direto além do próprio handler | `src/app/api/whatsapp/route.ts` | String (JSON array) | não | 🟡 | Permanente | **PostgreSQL** (tabela própria, fora do escopo desta ADR — anotar como pendência) |

## 2. Fidelidade — modelo antigo ("pizzas")

| Chave | Lê | Grava | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `config:fidelidade` | `src/lib/fidelidade.ts:obterConfigFidelidade` | `salvarConfigFidelidade` | String (JSON) | não | 🟡 | Permanente | **PostgreSQL** (`app_config`) |
| `fidelidade:extrato:{clienteId}` | `registrarMovimento` (leitura antes de append) | `registrarMovimento` | String (JSON array, reescrito inteiro a cada movimento) | não | 🔴 | Permanente | **PostgreSQL** (`loyalty_transactions`) |
| `fidelidade:saldo:{clienteId}` | `obterProgressoFidelidade`, `creditarFidelidadePedido` | `creditarFidelidadePedido` | String (JSON) | não | 🔴 | Permanente | **PostgreSQL** (`loyalty_accounts.balance`, derivado) |
| `fidelidade:recompensas:{clienteId}` | `obterProgressoFidelidade` | `criarRecompensa` | String (JSON array) | não | 🟡 | Permanente | **PostgreSQL** (`loyalty_transactions` tipo `recompensa`) |
| `fidelidade:creditado:{pedidoId}` | implícito (SET NX) | `creditarFidelidadePedido` | String (flag idempotência) | não (permanente, nunca expira — risco de acúmulo infinito) | 🟡 | Efêmero por natureza, mas TTL nunca foi definido | **PostgreSQL** (chave de idempotência via `UNIQUE` constraint, elimina a chave Redis) |

## 3. Fidelidade — modelo novo (pontos, R$1 = 1 ponto)

| Chave | Lê | Grava | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `config:fidelidade:pontos` | `obterConfigFidelidadePontos` | `salvarConfigFidelidadePontos` | String (JSON) | não | 🟡 | Permanente | **PostgreSQL** (`app_config`) |
| `fidelidade:pontos:estado:{clienteId}` (extrato + recompensas + reservas, tudo em 1 chave, escrita atômica) | `obterEstadoPontos` | `persistirEstadoPontosSeDono` (via Lua condicionado ao lock) | String (JSON) | não | 🔴 | Permanente | **PostgreSQL** (`loyalty_transactions` + `loyalty_accounts` + tabela de reservas) |
| `fidelidade:pontos:extrato:{clienteId}` (legado, PR #172) | `obterEstadoPontos` (merge de compatibilidade) | não é mais escrita por código atual | String (JSON array) | não | 🟡 | Permanente (legado) | **Eliminar** após migração (unir ao Postgres, confirmar zero leitura residual) |
| `fidelidade:pontos:lock:{clienteId}` | `comBloqueioCliente` | idem (SET NX + Lua) | String | 5s | 🟡 | Efêmero | **Redis** (lock) — em Postgres, substituível por `SELECT ... FOR UPDATE` transacional |

## 4. Conversas / histórico WhatsApp (painel de atendimento)

| Chave | Lê | Grava | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `conversas:index` | `src/app/api/conversas/recentes/route.ts` | `src/lib/conversasHistorico.ts:atualizarHistorico` (ZADD a cada mensagem) | **Sorted Set** | não | 🔴 | Permanente | **PostgreSQL** (`conversations`, ordenado por `updated_at` com índice) |
| `conversa_meta:{phone}` | `atualizarHistorico` (leitura antes de reescrever) | `atualizarHistorico` | String (JSON) | não | 🟡 | Permanente | **PostgreSQL** (`conversations`) |
| `conversa_full:{phone}` (até 1000 mensagens, reescrita **inteira** a cada mensagem nova) | `atualizarHistorico`, `src/app/api/conversas/reviver/route.ts`, `src/app/api/conversas/backfill/route.ts` | `atualizarHistorico` | String (JSON array, **rewrite completo do array a cada msg**) | não | 🔴 | Permanente | **PostgreSQL** (`messages`, 1 linha por mensagem — elimina o rewrite O(n) atual) |
| `cliente:{phone}` (histórico simplificado usado no fluxo do bot) | `src/lib/bot.ts` (múltiplos pontos) | `src/app/api/whatsapp/route.ts:217` | String (JSON) | 30 dias | 🟡 | Semi-permanente | **PostgreSQL** (`messages`/`conversations`, unificar com `conversa_full`) |
| `session:{phone}` | `src/lib/bot.ts` (todo o motor de conversa), `whatsapp/route.ts` (dezenas de pontos) | idem | String (JSON, estado da máquina de conversa) | 1800s (30 min) | 🔴 (perda = cliente perde o carrinho em andamento) | Efêmero por design | **Redis** (session, permanece) |
| `session_ts:{phone}` | não localizado consumidor além do próprio módulo | `src/lib/bot.ts`/afins | String | efêmero | ⚪ | Efêmero | **Redis** |
| `manual:{phone}`, `manual:{phoneFormatado}` | `src/lib/bot.ts` (silenciar o bot durante atendimento humano) | `whatsapp/route.ts` | String (flag) | 7200s | 🔴 (perda = bot responde durante atendimento humano) | Efêmero | **Redis** |
| `nova_msg_manual:{phone}` | painel `/conversas` (indicador de mensagem nova) | `whatsapp/route.ts:1181` | String (flag) | 3600s | 🟡 | Efêmero | **Redis** |
| `resolvendo:{phone}` | `whatsapp/route.ts` | idem | String (flag) | curto | 🟡 | Efêmero | **Redis** |
| `conversationAlert:{phone}` | painel | `whatsapp/route.ts:1538/1541/1546` | String (flag) | 3600s | 🟡 | Efêmero | **Redis** |
| `postOrderPriority:{phone}` | `src/lib/bot.ts` | `whatsapp/route.ts` (3 pontos) | String (flag) | 3600s | 🟡 | Efêmero | **Redis** |
| `revive_cooldown:{phoneFormatado}` | `whatsapp/route.ts` | idem | String (flag) | efêmero | ⚪ | Efêmero | **Redis** |
| `aguardando_resposta:{phone}` | `whatsapp/route.ts` | idem | String (flag) | 600s | ⚪ | Efêmero | **Redis** |
| `retomada:{phone}` | `whatsapp/route.ts` | idem | String (flag) | efêmero | ⚪ | Efêmero | **Redis** |
| `ultima_msg:{phone}` | não localizado consumidor além do próprio módulo (observabilidade) | `whatsapp/route.ts:1083` | String | 1800s | ⚪ | Efêmero | **Redis** |
| spam key (`spamKey`, padrão `spam:{phone}` — nome exato não fixado no grep, ver `whatsapp/route.ts:1203`) | `whatsapp/route.ts` | idem | String (contador, INCR-like) | 1s | ⚪ | Efêmero (rate limit) | **Redis** |

**Idempotência de webhook:** `idempotencyKey` (`whatsapp/route.ts:959-961`) — String, TTL 86400s (24h), 🔴 crítico (perda = mensagem processada 2x). Fica em **Redis**, mas hoje **não tem fallback**: se o Redis estiver indisponível no momento do check, a leitura falha e o comportamento atual (a confirmar em código) provavelmente deixa passar sem dedup — ver `FAILURE_MODES.md`.

## 5. Pix / Guardião — dados de coordenação (NÃO tocar na lógica; só mapear onde os dados vivem hoje)

| Chave | Lê | Grava | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `pix:sentinela:estado:{pedidoId}` | `src/lib/pixSentinela.ts:carregarEstadoSentinela` | `salvarEstadoSentinela` | String (JSON) | `PIX_SENTINELA_ESTADO_TTL_SEGUNDOS` (config, não lido nesta auditoria) | 🔴 (é coordenação operacional do Pix, mas não é a fonte de verdade financeira) | Semi-permanente (tem TTL) | **Redis permanece** nesta fase — é estado de coordenação de curto/médio prazo, não histórico financeiro. Reavaliar em etapa própria, fora deste programa, sem tocar na lógica Pix. |
| `pix:sentinela:lock:{chaveConsulta}` | `solicitarVerificacaoOficialPix` | idem | String (SET NX) | `PIX_SENTINELA_LOCK_TTL_SEGUNDOS` | 🟡 | Efêmero | **Redis** |
| `cooldown:mercadopago:reconciliacao` | `pixSentinela.ts` | (gravador não localizado neste arquivo — provavelmente no endpoint de reconciliação, fora do escopo) | String (flag) | curto | 🟡 | Efêmero | **Redis** |
| `${COOLDOWN_PEDIDO_PREFIXO}*`, `${COOLDOWN_RECUPERACAO_PREFIXO}*`, `${FALHAS_CONSECUTIVAS_PREFIXO}*`, `${QSTASH_CHAIN_LOCK_PREFIXO}*`, `${ULTIMA_TENTATIVA_PREFIXO}*`, `${ULTIMO_SUCESSO_PREFIXO}*` | módulos de reconciliação/Guardião (fora do escopo desta leitura — não abertos, por regra de não mexer no fluxo Pix) | idem | String | curtos (configuráveis) | 🟡 | Efêmeros | **Redis** — não investigados em profundidade nesta auditoria por serem parte do fluxo Pix protegido; qualquer decisão de destino dessas chaves deve vir de uma auditoria separada, explicitamente autorizada, que não faz parte deste programa. |
| Comprovante Pix — dedup (`chaveHash` em `whatsapp/route.ts:576/765`, padrão exato não fixado) | `whatsapp/route.ts` | idem | String (flag idempotência) | `PIX_COMPROVANTE_*_TTL_SEGUNDOS` | 🔴 | Efêmero | **Redis** (dedup) — decisão final requer olhar `pix.ts`/config, fora do escopo desta leitura. |

## 6. Configuração, cardápio, financeiro, funcionários

| Chave | Lê | Grava | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `cardapio` | `src/lib/menu.ts:getMENUDinamico` (chamado a cada render que monta o menu — potencial hot path) | endpoint de admin de cardápio (não aberto nesta leitura) | String (JSON) | não | 🔴 | Permanente | **PostgreSQL** (`menu_items`) |
| `cardapio:imagens` | painel de cardápio | idem | String (JSON) | não | 🟡 | Permanente | **PostgreSQL** ou armazenamento de arquivo (se forem URLs/blobs, ver decisão na ADR) |
| `funcionarios` | endpoint `/api/orders`? (import presente, uso específico não detalhado nesta leitura) | painel de funcionários | String (JSON array) | não | 🔴 | Permanente | **PostgreSQL** (`employees`) |
| `custos:{mes}`, `mes_status:{mes}` | painel financeiro (não aberto nesta leitura) | idem | String (JSON) | não | 🔴 | Permanente | **PostgreSQL** (tabela financeira própria, fora da lista mínima desta ADR — anotar como pendência) |
| `padroes_aprendidos` | módulo de aprendizado do bot (`learningMemory.ts`, não aberto em detalhe) | idem | String (JSON) | não | 🟡 | Permanente | **PostgreSQL** (tabela própria — ou manter em Redis se for cache de re-cálculo barato; decidir na Etapa J) |
| `esgotados`, `esgotadosMetadata` | `@/lib/estoque:obterEsgotadosLegado/obterEsgotadosMetadataLegado` — lido hoje por todo consumidor de disponibilidade (bot do WhatsApp, montagem manual/comandas, promoções, Jornada do Chef, pedido-app) via `obterEsgotadosEfetivos`/`obterEsgotadosMetadataEfetiva` (Fase 8) | `PATCH /api/cardapio` (via `@/lib/estoque:definirDisponibilidade`) | String (JSON: `string[]` / `Record<nome, {desde, ultimaRevisao}>`) | não | 🔴 | Permanente | **Redis** (compatibilidade — ver `estoque:itens` abaixo; não removível enquanto algum consumidor não migrar para leitura por ID) |
| `estoque:itens` (Fase 8) | `@/lib/estoque:obterEstoqueItens`, consultado dentro de `obterEsgotadosEfetivos` | `@/lib/estoque:definirDisponibilidade` (escrita direta) e `migrarEsgotadosParaEstoque` (backfill a partir de `esgotados`) | String (JSON: `Record<id do catálogo, {id, nome, esgotado, desde, ultimaRevisao}>`) | não | 🔴 | Permanente | **Redis** hoje; candidato a **PostgreSQL** (`stock_items`, FK pelo id estável do catálogo) quando o cardápio migrar (Etapa J) |
| `estoque:migracao:backup:{timestamp}` (Fase 11) | `@/lib/estoque:reverterMigracaoEstoque` | `migrarEsgotadosParaEstoque`, só na execução real (nunca no dry-run) | String (JSON: snapshot de `esgotados`+`esgotadosMetadata`+`estoque:itens` antes da migração) | 30 dias | ⚪ | Efêmero (backup) | **Redis** |

## 7. Push notifications e localização

| Chave | Lê | Grava | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `push:*` (`push:${subscription.endpoint.slice(-20)}`) | `src/app/api/push/route.ts` | idem | String | não explícito no grep (a confirmar) | 🟡 | Semi-permanente | **PostgreSQL** (`push_subscriptions`, fora da lista mínima — anotar) |
| localização do entregador (`src/app/api/localizacao/route.ts`, chave exata não capturada nesta leitura) | idem | idem | String | curto (provável) | 🟡 | Efêmero | **Redis** |

## 8. MCP / observabilidade interna

| Chave | Lê | Grava | Tipo | TTL | Criticidade | Natureza | Destino |
|---|---|---|---|---|---|---|---|
| `mcp:log:obs` | `src/mcp/lib/readOnlyRedis.ts` / painel `/dev/mcp` | `src/mcp/logger/mcpLogger.ts:logObservacaoMcp`/`logObservacoesEmLoteMcp` (RPUSH + LTRIM + EXPIRE — **3 comandos por log OU por lote inteiro**) | **List** (cap 500) | 30 dias | ⚪ | Efêmero | **Redis** |
| `mcp:log:erros` | idem | `logErroMcp` (idem, 3 comandos) | **List** (cap 200) | 30 dias | ⚪ | Efêmero | **Redis** |
| `mcp:fila:eventos` | cron `mcp-observer` | `src/mcp/eventTap.ts:enfileirarEventoMcp` (1 EVAL Lua atômico: RPUSH + LLEN + LTRIM condicional + EXPIRE) | **List** (cap 10.000) | 72h | ⚪ | Efêmero | **Redis** |
| `mcp:meta:fila:descartados` | painel `/dev/mcp` | `eventTap` (Lua, só quando a fila estoura o limite) | Number | 7 dias | ⚪ | Efêmero | **Redis** |
| `mcp:meta:fila:pico` | painel `/dev/mcp` | cron `mcp-observer` (só quando supera o pico anterior) | Number | 30 dias | ⚪ | Efêmero | **Redis** |
| `mcp:meta:cron:historico` | painel `/dev/mcp` (agregados 24h) | cron `mcp-observer`, 1 entrada por execução | **List** (cap 300) | 3 dias | ⚪ | Efêmero | **Redis** |
| `mcp:meta:fds:historico` | painel `/dev/mcp` (elegibilidade) | cron `mcp-observer`, 1 id por fim de semana movimentado | Array (JSON) | 200 dias | ⚪ | Efêmero | **Redis** |
| `mcp:meta:processados:total` | painel `/dev/mcp` (elegibilidade) | cron `mcp-observer`, INCRBY | Number | 400 dias (renovado) | ⚪ | Efêmero | **Redis** |
| `system:logs` | painel `/dev/mcp` | fonte não localizada nesta leitura (possivelmente logger central) | tipo não confirmado | não confirmado | ⚪ | A confirmar | **Redis** (mantém, é log operacional) |

Ver `docs/architecture/MCP_OBSERVADOR_CAPACIDADE.md` para o racional completo
da evolução de capacidade (Fase 1 — noites movimentadas).

---

## Achados que não são apenas "mapa" — riscos encontrados durante a auditoria

1. **`conversa_full:{phone}` é reescrito por inteiro a cada mensagem** (`GET` do array completo + `push` em memória + `SET` do array completo). Para uma conversa com 900 mensagens, a mensagem 901 ainda lê e regrava as 900 anteriores. Isso é O(n) por mensagem — um dos maiores consumidores de comandos e de banda, e o comentário no próprio código (`conversasHistorico.ts:9-10`) já reconhece isso como problema conhecido ("migrar para LIST Redis é o próximo passo recomendado").
2. **`pedidos` é uma única chave String com o array de TODOS os pedidos**, lido e regravado por inteiro em praticamente toda mutação de pedido (criar, mudar status, editar, sair para entrega, marcar avaliação enviada). Qualquer painel aberto faz `GET pedidos` a cada 3s (ver `DATA_ARCHITECTURE.md`, seção de orçamento). Este é o maior risco estrutural do modelo atual e o principal argumento para mover pedidos ao Postgres primeiro.
3. **`fidelidade:creditado:{pedidoId}` nunca expira** — chave de idempotência permanente sem TTL, cresce para sempre. Baixo risco individual (chaves pequenas), mas é sintoma do padrão "Redis como banco permanente" que este programa corrige.
4. Várias chaves de dedup/cooldown do fluxo Pix (`COOLDOWN_PEDIDO_PREFIXO` etc.) não foram abertas em detalhe nesta auditoria **por decisão deliberada** — são parte do fluxo Pix protegido pelas regras inegociáveis, e eu não vou aprofundar leitura ali sem autorização explícita separada, mesmo sendo leitura não-destrutiva.
