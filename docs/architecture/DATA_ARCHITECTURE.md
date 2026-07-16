# Arquitetura de dados do ChefeBot — estado atual e visão alvo

Status: **diagnóstico**, sem nenhuma implementação de banco novo, sem alteração
de variável de ambiente, sem deploy. Ver `ADR-POSTGRES-SOURCE-OF-TRUTH.md` para
a justificativa da decisão e `DATABASE_MIGRATION_PLAN.md` para o passo a passo.

## 1. Estado atual comprovado

Todo dado do ChefeBot — permanente ou temporário — vive hoje em **um único
Redis** (`upstash-kv-rose-flower`, plano Free, 500.000 comandos/mês), acessado
via `src/lib/redis.ts` com as variáveis `KV_REST_API_URL`/`KV_REST_API_TOKEN`.
Isso inclui, na mesma instância:

- o array completo de pedidos (`pedidos`), reescrito por inteiro a cada mutação;
- todo o histórico de conversas do WhatsApp (`conversa_full:*`, sem TTL, sem paginação);
- fidelidade (dois modelos coexistindo: pizzas legado + pontos novo);
- sessões efêmeras de conversa (`session:*`, TTL 30 min — este uso já é correto);
- locks e coordenação do Guardião Pix;
- logs internos do MCP.

Esse desenho misturou dado permanente e dado efêmero na mesma peça de
infraestrutura, com o mesmo orçamento de comandos — foi a causa raiz do
incidente P0 já registrado (Upstash: `ERR max requests limit exceeded`,
`Limit: 500000, Usage: 500000`, ver conversa do incidente e
`REDIS_KEY_INVENTORY.md`).

## 2. Visão alvo

```
                    ┌─────────────────────┐
                    │   PostgreSQL          │  ← fonte da verdade
                    │  (Pay-as-you-go /     │    de tudo permanente
                    │   Neon/Supabase, a     │
                    │   decidir na Etapa D)  │
                    └─────────┬─────────────┘
                              │ leitura/escrita
                              │ transacional
   ┌──────────────────────────┴───────────────────────────┐
   │                     ChefeBot (Next.js)                 │
   └──────────────────────────┬───────────────────────────┘
                              │ leitura/escrita
                              │ TTL curto
                    ┌─────────┴─────────────┐
                    │        Redis           │  ← infraestrutura
                    │  session, locks, dedup, │    efêmera
                    │  cooldown, rate-limit,  │
                    │  cache, filas rápidas   │
                    └─────────────────────────┘
```

Nenhuma chave do fluxo Pix Mercado Pago (geração de copia-e-cola, webhook,
polling, conciliação, pagamento misto) muda de lugar ou de lógica neste
programa — permanecem no Redis exatamente como estão, só documentadas.

## 3. Orçamento de comandos Redis — evidência coletada

Metodologia: grep de todas as chamadas `redis.*` no código-fonte + leitura dos
`setInterval`/polling do frontend. **Não é medição em produção** (não tenho
telemetria por comando nesta etapa) — é contagem estática do que o código
executa por operação. Onde a contagem depende de dado variável (tamanho de
array, número de sessões abertas), isso está marcado como estimativa
proporcional.

### 3.1 Pedido criado (`POST /api/orders`)
- `getPedidos()` → 1 `GET pedidos`
- `proximoNumeroPedido()` → 1 `INCR` (+ 1 `EXPIRE` só na primeira chamada do dia)
- criação do Pix (se aplicável) — sem escrita Redis direta neste ponto (metadata vai dentro do próprio objeto pedido)
- `SET pedidos` final → 1 `SET`
- **Total: ~3 comandos** (2 em dias sem reset de contador)

### 3.2 Mudança de status (`PATCH /api/orders`)
- `adquirirMutexEdicao` → 1 a N `SET NX` (normalmente 1; até 20 tentativas com espera de 50ms se houver contenção)
- `getPedidos()` → 1 `GET`
- (opcional) `SET pedidos` de limpeza de edição expirada → 0 ou 1
- `SET pedidos` com novo status → 1
- se notificação ao cliente: 0 comandos Redis (só HTTP para a Evolution API)
- se `saiu_entrega` + entregador: + `GET entregador:pedidos:*`, + `SET entregador:pedidos:*`, + `SET entregador_aguardando:*` → +3
- se `entregue`: + `GET avaliacao_enviada:*`, + `SET avaliacao_enviada:*`, + `SET avaliacao:*` → +3; + fidelidade antiga (`creditarFidelidadePedido`: até 1 `SET NX` + 2 `GET` + 2-4 `SET`, dependendo de quantos "prêmios" a pizza cruzar) → **+4 a 8**; + fidelidade pontos (`creditarPontosPedidoEntregue`: 1 `SET NX` de lock + até `LOCK_MAX_TENTATIVAS`=50 em contenção + 2 `GET` (estado + legado) + 1 `SET` do estado + 1 `DEL`/compare-delete do lock) → **+5 a 6** em condição normal
- se `cancelado` vindo de `entregue`: + leitura/escrita de estorno de pontos → +3 a 5
- **Total: 4 comandos (mudança simples, ex. novo → em_preparo) até ~20 comandos (entrega + fidelidade dupla + avaliação)**

### 3.3 Mensagem recebida do WhatsApp (`POST /api/whatsapp`, caminho comum)
- idempotência: `GET idempotencyKey` + `SET idempotencyKey` → 2
- `GET session:{phone}` (carregar estado da conversa) → 1
- `atualizarHistorico` (a cada mensagem relevante): `ZADD conversas:index` + `GET conversa_meta` + (se falta nome) `GET session:{phone}` de novo + `GET conversa_full` (array **inteiro**) + `SET conversa_full` (array **inteiro**) + `SET conversa_meta` → **6 comandos**, sendo os dois de `conversa_full` proporcionais ao tamanho do payload (até 1000 mensagens)
- `SET session:{phone}` (persistir novo estado) → 1, às vezes 2-3 vezes na mesma requisição (o grep mostra múltiplos `redis.set(sessionKey, ...)` em ramos diferentes do fluxo — cada requisição só passa por um ramo, mas alguns ramos gravam a sessão mais de uma vez, ex. linha 1307 + 1560 nunca no mesmo request, mas 1326+1336+1343 podem se acumular dentro do mesmo ramo de conversa)
- flags auxiliares conforme o ramo (spam, cooldown, postOrderPriority, manual) → +1 a 3
- **Total: ~10 a 15 comandos por mensagem recebida**, sendo o `GET`+`SET` de `conversa_full` o componente que cresce com o histórico da conversa (não é O(1)).

### 3.4 Mensagem enviada pelo bot
- Não há chamada Redis dedicada ao envio em si (`enviarMensagem`/`enviarRespostas` fazem `fetch` HTTP para a Evolution API) — o registro no histórico acontece via `atualizarHistorico`, mesmo custo do item 3.3 (6 comandos, um deles com o rewrite completo de `conversa_full`).
- **Total: ~6 comandos por mensagem enviada e registrada.**

### 3.5 Abertura do painel `/pedidos`
- Carregamento inicial: `GET /api/orders` → 1 `GET pedidos` (+ eventual `SET` de limpeza de edição expirada)
- Sem sessão de conversa aberta: nenhum outro comando nesse instante.

### 3.6 Um minuto com o painel `/pedidos` aberto (evidência direta do polling)
`src/app/pedidos/page.tsx:614` — `setInterval(carregarPedidos, 3000)`: **20 requisições/minuto**, cada uma = 1 `GET pedidos` (+ eventual `SET` de limpeza) → **~20 comandos/min só de pedidos**, por atendente com o painel aberto.

Se o mesmo atendente tiver uma conversa selecionada: `src/app/pedidos/page.tsx:688` — `setInterval(carregarHistoricoConversa, 3000)` → mais **20 requisições/minuto**, cada uma lendo `conversa_full:{phone}` (1 `GET`) → **+20 comandos/min**.

`src/app/pedidos/page.tsx:643` — `setInterval(carregarSessoes, 3000)` → mais **20 requisições/minuto** (esta lê sessões, custo por requisição não fixado nesta auditoria, mas no mínimo +20 comandos/min).

**Subtotal só do painel `/pedidos` aberto, 1 atendente, 1 conversa selecionada: ~60+ comandos/minuto.**

### 3.7 Um minuto com o painel `/conversas` aberto
- `setInterval(carregarRecentes, 8000)` → 7,5 req/min, cada uma provavelmente fazendo `ZRANGE conversas:index` + N `GET conversa_meta` (N = conversas exibidas — **candidato a N+1**, não confirmado sem abrir `conversas/recentes/route.ts` em detalhe).
- `setInterval(carregar, 15000)` → 4 req/min (lista principal, mesmo padrão N+1 possível).
- Com uma conversa aberta: `setInterval(carregarHistorico, 3000)` → 20 req/min de `GET conversa_full`.
- **Subtotal estimado: 30+ comandos/minuto, podendo ser bem mais alto se `conversas/recentes` de fato fizer 1 `GET` por conversa listada (N+1) — precisa confirmação em etapa de instrumentação, não nesta auditoria.**

### 3.8 Outros polls identificados (evidência, não estimados em comandos ainda)
| Local | Intervalo | O que faz |
|---|---|---|
| `src/app/admin/page.tsx:313` | 3000ms | `fetchWaStatus` — status do WhatsApp |
| `src/app/cardapio/page.tsx:985` | 5000ms | `fetchStatusPedido` — cliente acompanhando pedido |
| `src/app/pedido/pagamento/[token]/page.tsx:105` | 5000ms | `verificar(token)` — status de pagamento Pix (fluxo protegido, não mexer) |
| `src/app/cliente/pedidos/page.tsx:160` | 15000ms | `talvezAtualizar` |
| `src/components/PixPendenteBar.tsx:80` | 30000ms | tick da barra de Pix pendente |
| `src/app/cardapio/page.tsx:82` | 20000ms | `atualizar` (cardápio dinâmico — `GET cardapio` a cada 20s por cliente com a página aberta) |

### 3.9 Cron e MCP
- Cron das 3h (mencionado em `numeracao.ts`) limpa `contador_pedidos:*` — não localizado o arquivo do cron nesta leitura, escopo para etapa futura.
- MCP: cada log (`logObservacaoMcp`/`logErroMcp`) = 3 comandos (`RPUSH`+`LTRIM`+`EXPIRE`); cada evento de fila (`enfileirarEventoMcp`) = 3 comandos. Volume depende de quanto o MCP é acionado — não medido aqui.

### 3.10 Leitura do orçamento

O consumo NÃO é dominado por um único pico, é dominado por **polling de baixo
intervalo multiplicado por painéis abertos simultaneamente** — 3 segundos é
agressivo para dado que não muda a cada 3s na maioria das vezes (pedidos,
lista de conversas). Com 2 atendentes de painel aberto o dia todo (12h) mais
tráfego normal de WhatsApp, a conta de ~60-90 comandos/minuto só de polling
do painel já soma **~50.000-65.000 comandos/dia** somente de UI ociosa — antes
de contar qualquer pedido ou mensagem real. Isso é compatível com a
velocidade com que a cota de 500.000/mês esgotou.

Nenhuma otimização foi aplicada nesta etapa — este documento é só a
evidência, por instrução explícita ("não otimize ainda, primeiro apresente
evidência").

## 4. Dados que devem sair do Redis primeiro (prioridade)

1. `pedidos` (maior volume de comandos + maior criticidade de negócio)
2. `conversa_full:*` / `conversas:index` / `conversa_meta:*` (segundo maior volume, rewrite O(n) por mensagem)
3. Fidelidade (dois modelos) — menor volume que os dois acima, mas dado financeiro/permanente que não deveria arriscar perda por TTL/quota
4. Cardápio, funcionários, config, financeiro — baixo volume, mas permanentes

## 5. Dados que devem permanecer no Redis

`session:*`, todos os locks e mutexes (`pedido:edit:mutex:*`, `fidelidade:pontos:lock:*`, `pix:sentinela:lock:*`), toda deduplicação (`idempotencyKey`, dedup de comprovante Pix, dedup de eco do painel), todos os cooldowns e rate limits, filas/observabilidade do MCP, e **todo o estado de coordenação do Sentinela/Guardião Pix** (`pix:sentinela:estado:*`) nesta fase — por ser dado de coordenação de curto prazo e por estar dentro do fluxo Pix protegido.
