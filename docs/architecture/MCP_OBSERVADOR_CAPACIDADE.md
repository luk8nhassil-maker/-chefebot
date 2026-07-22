# MCP Observador Fase 1 — evolução de capacidade

Contexto: a auditoria funcional (ver histórico de PRs #248/#249) confirmou o
pipeline `eventTap → fila Redis → cron → observador → logs` funcionando
ponta-a-ponta em Production, mas dimensionado para tráfego baixo (fila
limitada a 1.000 eventos/2h, cron 1x/dia, 50 eventos/execução, 3 comandos
Redis por evento). Este documento descreve a evolução para suportar noites
de pico (sexta/sábado/domingo, 80+ pizzas, centenas ou milhares de
mensagens) sem perder a maioria dos eventos e sem explodir o consumo de
comandos Redis — **sem, em nenhum momento, arriscar o atendimento real**.

## O que mudou

| Aspecto | Antes | Depois |
|---|---|---|
| TTL da fila (`mcp:fila:eventos`) | 2h | 72h |
| Limite da fila | 1.000 | 10.000 |
| Frequência do cron | 1x/dia (Vercel) | a cada 10min em pico (GitHub Actions) + 1x/dia (Vercel, fallback) |
| Eventos processados/execução | 50 | até 500, em chunks de 100 |
| Comandos Redis por evento persistido | 3 (RPUSH+LTRIM+EXPIRE) | 3 **por lote inteiro**, não por evento |
| Enfileiramento (`eventTap`) | RPUSH+LTRIM+EXPIRE (3 round-trips) | 1 EVAL Lua atômico (1 round-trip) |
| Proteção contra Redis lento/indisponível | try/catch simples | + circuit breaker + timeout de 1.5s, isolados ao módulo MCP |
| Observabilidade | fila/obs/erros/score | + pico da fila, idade do evento mais antigo, processados/erros 24h, descartados, cobertura estimada, status, alertas |

## Arquitetura

### 1. Processamento frequente

`.github/workflows/mcp-observer-cron.yml` chama `GET /api/cron/mcp-observer`
a cada 10 minutos, mas só durante a janela de pico (sexta/sábado/domingo,
18:00–02:59 horário de Brasília — ver comentário no próprio workflow para a
conversão para UTC, já que GitHub Actions não suporta timezone nativo em
`schedule`). Usa `secrets.CRON_SECRET` (o mesmo do cron nativo da Vercel) e
nunca loga o header `Authorization` nem o valor do segredo — ele é mascarado
explicitamente com `::add-mask::` além do mascaramento automático do GitHub
Actions para `secrets.*`. `workflow_dispatch` permite disparo manual.

O cron diário nativo da Vercel (`vercel.json`, `0 6 * * *`) **continua
existindo sem alteração** — é o fallback que garante que a fila nunca fique
parada indefinidamente mesmo se o workflow do GitHub Actions for
desabilitado ou falhar.

### 2. Processamento em lotes

`src/app/api/cron/mcp-observer/route.ts` processa até 500 eventos por
execução, em chunks de 100:

1. Lê um chunk (`LRANGE 0 99`).
2. Classifica cada evento em memória (`classificarLote`, puro, sem I/O).
3. Persiste o lote inteiro com **um único `RPUSH` multi-valor** +
   `LTRIM` + `EXPIRE` (`logObservacoesEmLoteMcp`) — 3 comandos Redis para o
   lote inteiro, não 3 por evento.
4. **Só remove da fila (`LTRIM`) o chunk cuja persistência foi confirmada.**
   Se a persistência falhar, nada daquele chunk (nem do resto da fila) é
   removido — fica tudo intacto para a próxima execução.
5. Repete até esgotar os 500 eventos, esgotar a fila, ou estourar o
   orçamento de tempo interno (25s, dentro do `maxDuration=30s` da função —
   deixa folga para os writes finais de observabilidade).

Itens malformados (JSON inválido — não deveria acontecer, mas é tratado) são
contados como erro e descartados do chunk sem bloquear os eventos válidos ao
lado.

### 3. Retenção e limites

- `mcp:fila:eventos`: TTL 72h, limite rígido de 10.000 (constantes
  `TTL_FILA_S`/`MAX_FILA` exportadas de `src/mcp/eventTap.ts`).
- O enfileiramento (`enfileirarEventoMcp`) usa um único script Lua
  (`RPUSH` + `LLEN` + `LTRIM` condicional + `INCRBY` do contador de
  descarte + `EXPIRE`) — 1 round-trip Redis, e só faz `LTRIM`/incrementa o
  contador quando a fila realmente estourou o limite.
- Eventos descartados por fila cheia são contados em
  `mcp:meta:fila:descartados` (TTL 7 dias) — sanitizado, é só um número.
- Nenhuma chave nova grava conteúdo de mensagem, telefone, nome, endereço,
  item ou valor — todas seguem o mesmo contrato de `McpEventoFila`/
  `McpLogEntryObs` já auditado.

### 4. Fail-open e proteção do bot

- `src/mcp/lib/circuitBreaker.ts`: circuito em memória do processo (não
  depende do Redis para si mesmo). Abre depois de 5 falhas consecutivas do
  `eventTap`, fica aberto por 1 minuto, e nesse período **nem tenta** chamar
  o Redis — corta o custo de retries repetidos contra um Redis com
  problema. É local a cada instância quente da função; reinicia a cada cold
  start, o que é aceitável porque o objetivo é só parar de insistir dentro
  da mesma instância, nunca ser fonte de verdade.
- `src/mcp/lib/withTimeout.ts`: timeout de 1.5s isolado ao `eventTap` — uma
  chamada Redis lenta nunca segura a função além do necessário.
- O `eventTap` só é chamado depois de `enviarRespostas()`, via `after()`
  (fire-and-forget) — mesmo que o Redis do MCP esteja completamente fora do
  ar, a resposta ao cliente no WhatsApp já foi enviada antes.
- Nenhum arquivo do MCP escreve fora de chaves `mcp:*` (mesma garantia já
  auditada antes desta evolução). Pedidos, Pix, Mercado Pago, Guardião,
  atendimento humano, cardápio, Evolution API e sessão principal não foram
  tocados por este trabalho.

### 5. Observabilidade — `/dev/mcp`, aba "Capacidade"

Nova aba com:

- Fila atual, maior fila já registrada (`mcp:meta:fila:pico`), idade do
  evento mais antigo (peek do primeiro item da fila, sem ler o resto).
- Processados na última execução, processados/erros nas últimas 24h
  (agregados de `mcp:meta:cron:historico`, uma lista compacta de
  `{ts, processed, errors}` por execução, capada em 300 entradas).
- Eventos descartados (`mcp:meta:fila:descartados`).
- Cobertura estimada = processados24h ÷ (processados24h + descartados) —
  rotulada explicitamente como estimativa, já que não conta falhas de
  enfileiramento por indisponibilidade do Redis (essas aparecem em "Erros
  MCP").
- Status (`saudavel` / `atrasado` / `saturado` / `indisponivel`) e alertas
  (`atencao`, `critico`, `saturado`, `ausencia_execucao`) — thresholds em
  `calcularStatusEAlertas` (`src/mcp/lib/mcpReader.ts`):
  - atenção: fila > 500 ou evento mais antigo esperando > 20min
  - crítico: fila > 2.000 ou evento mais antigo esperando > 60min
  - saturado: fila ≥ 90% do limite (9.000 de 10.000)
  - ausência de execução: nenhuma execução do cron nos últimos 20min
    **durante o período operacional de pico** (fora do pico, silêncio é
    normal e não gera alerta)

### 6. Critério para avançar de fase

Nova seção "Critérios para avançar de fase" na mesma aba. Nunca avança
sozinho para IA autônoma — só mostra o texto **"Elegível para Modo de
Sugestões"** quando todos os critérios abaixo forem verdadeiros
simultaneamente (senão mostra "Permanecer no Modo Observador" com o
checklist):

1. Pelo menos 3 fins de semana movimentados (proxy de "noite com 80+
   pizzas": o cron marca um fim de semana como movimentado em
   `mcp:meta:fds:historico` quando a soma de eventos processados
   sexta–domingo daquele fim de semana passa de 80).
2. Pelo menos 500 eventos reais processados (contador vitalício
   `mcp:meta:processados:total`, não afetado pelo cap de 500 do
   `mcp:log:obs`).
3. Cobertura estimada ≥ 95%.
4. Fila normalizada depois dos picos (fila atual < 500).
5. Nenhum vazamento de PII (reaproveita o `piiCheck` já auditado).
6. Nenhum impacto nos fluxos operacionais — garantido estruturalmente pela
   arquitetura fail-open (nunca escreve fora de `mcp:*`, nunca propaga erro
   ao webhook), não por uma métrica calculada.
7. Erros abaixo de 1% (erros24h ÷ (processados24h + erros24h)).

"Modo de Sugestões" (próxima fase, fora do escopo deste trabalho) poderá
recomendar melhorias para aprovação humana — nunca altera respostas ou
regras sozinho.

## Novas chaves Redis

Todas dentro do namespace `mcp:*`, sanitizadas (só números/strings curtas,
nunca telefone/mensagem/endereço/item/valor):

| Chave | Tipo | TTL | Escrito por |
|---|---|---|---|
| `mcp:meta:fila:descartados` | Number | 7 dias | `eventTap` (Lua), só quando a fila estoura o limite |
| `mcp:meta:fila:pico` | Number | 30 dias | cron, quando a fila atual supera o pico anterior |
| `mcp:meta:cron:historico` | List (cap 300) | 3 dias | cron, uma entrada por execução |
| `mcp:meta:fds:historico` | Array (JSON) | 200 dias | cron, um id de fim de semana por vez que cruza o limiar |
| `mcp:meta:processados:total` | Number | 400 dias (renovado a cada execução ativa) | cron, `INCRBY` |

## Rollback

Cada etapa é reversível independentemente:

1. **Desativar o processamento frequente**: desabilitar (ou deletar) o
   workflow `.github/workflows/mcp-observer-cron.yml` no GitHub Actions —
   o cron diário da Vercel continua funcionando normalmente.
2. **Voltar os limites antigos**: em `src/mcp/eventTap.ts`, restaurar
   `MAX_FILA = 1_000` e `TTL_FILA_S = 2 * 60 * 60`.
3. **Voltar o tamanho de lote antigo**: em
   `src/app/api/cron/mcp-observer/route.ts`, restaurar
   `MAX_EVENTOS_POR_EXECUCAO = 50` (chunk único, sem necessidade de
   orçamento de tempo).
4. **Desligar tudo sem tocar em código**: `MCP_MODE` diferente de
   `observador` em Production já desliga o `eventTap` e o cron
   completamente (comportamento pré-existente, inalterado).

Nenhum rollback aqui afeta pedidos, Pix, sessões, atendimento humano ou
qualquer chave fora de `mcp:*`.

## Operação — como interpretar os alertas

- **saudável**: nada a fazer.
- **atrasado** (atenção ou crítico): a fila está acumulando mais rápido do
  que o cron consegue esvaziar. Em pico, isso é esperado por alguns
  minutos; se persistir por muito tempo, considerar disparar o workflow
  manualmente (`workflow_dispatch`) ou investigar se o cron está de fato
  rodando a cada 10min (ver aba "Capacidade" → processados 24h).
- **saturado**: a fila está perto do limite de 10.000 — próximos eventos
  vão começar a ser descartados (contador "Descartados" vai subir). Mesma
  ação do item anterior, com mais urgência.
- **ausência de execução**: nenhuma execução do cron nos últimos 20min
  durante o horário de pico — verificar se o `CRON_SECRET` ainda é válido
  nos GitHub Actions Secrets e na Vercel, e se o workflow está habilitado.
- **indisponível**: o próprio Redis de leitura do painel está fora do ar —
  não é um problema do MCP especificamente (outros paineis do `/dev`
  também estarão afetados).

Em nenhum desses casos o atendimento ao cliente é impactado — a
telemetria do MCP é estritamente observacional e fail-open por desenho.
