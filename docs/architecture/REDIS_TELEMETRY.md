# Telemetria do Redis — Etapa C do Programa de Saúde de Dados

Status: **implementado**. Esta etapa criou visibilidade real sobre o consumo
de comandos Redis, sem migrar nenhum dado para PostgreSQL e sem alterar
nenhum comportamento de leitura/escrita já validado (pedidos, WhatsApp, Pix).

## 1. Por que esta arquitetura

O incidente que originou este programa (`ERR max requests limit exceeded`)
aconteceu sem nenhum alarme prévio — a cota estourou silenciosamente. O
objetivo desta etapa não é reduzir consumo (isso é otimização, fora de
escopo aqui — "não otimize ainda, primeiro apresente evidência"), é garantir
que a próxima vez que a cota se aproximar do limite, alguém saiba **antes**
de virar incidente.

A restrição mais importante do desenho: **a telemetria não pode ser, ela
mesma, uma fonte relevante de consumo de cota.** Um contador Redis por
comando observado dobraria (ou pior) o problema que está tentando medir.

## 2. Componentes

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/redisTelemetry.ts` | Wrapper transparente do client Redis (Proxy), agregação em memória, flush amostrado, leitura agregada do uso estimado. |
| `src/lib/redis.ts` | Único ponto de wiring — envolve o client real com `wrapRedisClient(...)` antes de exportar `redis`. Nenhum outro arquivo do projeto precisou mudar. |
| `src/lib/healthChecks.ts` | Três checagens independentes (Redis, WhatsApp, Pedidos) + agregação, sem chamar Evolution API/Mercado Pago pela rede. |
| `src/lib/redisUsageAlerts.ts` | Limiares de alerta (50/70/85/95/100%) configuráveis por env var, função pura de avaliação. |
| `src/app/api/dev/redis-status/route.ts` | Endpoint somente leitura (role `dev`/`admin`) que agrega telemetria + saúde + alerta. |
| `src/app/api/dev/health/route.ts` | Health check agregado isolado (mesma proteção). |
| `src/app/dev/redis-status/page.tsx` | Painel visual, sem polling automático — atualização manual por botão. |

## 3. Como a instrumentação funciona (sem tocar nenhum call site)

`src/lib/redis.ts` envolve o client real do `@upstash/redis` com um
[`Proxy`](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
antes de exportar `redis`. Todo o resto do código (`src/app/api/orders/route.ts`,
`src/app/api/whatsapp/route.ts`, `src/lib/fidelidade.ts`, `src/lib/pixSentinela.ts`
etc.) continua chamando `redis.get(...)`, `redis.set(...)` exatamente como
antes — **nenhum desses arquivos foi alterado nesta etapa.** O Proxy:

1. Intercepta só os métodos de comando conhecidos (`get`, `set`, `del`,
   `incr`, `zadd`, `hincrby`, `rpush`, `eval` etc. — ver `OPERACOES_INSTRUMENTADAS`
   em `redisTelemetry.ts`). Métodos de composição do próprio SDK como
   `pipeline`/`multi` **não** são interceptados — passam direto, comportamento
   idêntico ao original.
2. Mede a latência do comando real.
3. Classifica a chave por **grupo** (`classifyKey`), usando os mesmos
   prefixos documentados em `REDIS_KEY_INVENTORY.md` — nunca por rota HTTP
   (ver seção 6, "o que ficou de fora").
4. Repassa o valor de retorno OU relança o erro original, sem transformar
   nada — quem chamou nunca percebe diferença.
5. Registra a observação em memória (contador do processo).

Nenhuma chave é escrita a cada comando. A escrita real (persistência do
snapshot agregado) é amostrada — ver seção 4.

## 4. Amostragem e flush — o design que evita agravar o problema

- Contadores (`totalCommands`, `byGroup`, `byOperation`, erros, latência)
  vivem **em memória**, por processo. Isso é intencional: incrementar um
  objeto em memória custa zero comandos Redis.
- A cada comando observado, há `FLUSH_SAMPLE_PROBABILITY` (padrão 5%,
  configurável via `REDIS_TELEMETRY_SAMPLE_PROBABILITY`) de chance de
  disparar um flush do que estiver acumulado. Não é um contador fixo — é
  probabilístico, o que evita um contador global compartilhado entre
  invocações concorrentes de uma função serverless "quente" e distribui os
  flushes de forma mais uniforme.
- O flush é **fire-and-forget**: nunca é `await`ado pelo comando real que o
  disparou, então nunca atrasa a resposta ao usuário.
- Cada flush grava em **uma única chave** (`telemetry:redis:dia:{YYYYMMDD}`,
  um Hash), incrementando só os campos realmente usados (`total`, `errors`
  se > 0, e um campo `group:{grupo}` por grupo tocado desde o último flush)
  — nunca todos os campos possíveis.
- Toda chave de telemetria tem TTL de 40 dias (cobre um ciclo mensal com
  folga, nunca cresce para sempre).

### Uso estimado do MÊS: agregado sob demanda, não pré-calculado

Em vez de manter uma chave mensal pré-agregada (que exigiria escrever nela a
cada flush também, dobrando o custo de escrita), o total do mês é calculado
**no momento da leitura** (`lerUsoEstimado`): soma os buckets diários desde o
dia 1 até hoje (no máximo 31 leituras `HGETALL`). Essa leitura só acontece
quando um humano abre `/dev/redis-status` (sem polling automático) ou quando
`/api/dev/redis-status` é chamado — nunca em background, nunca por cron
desta etapa. A troca é deliberada: caminho de escrita (automático, em toda
requisição) fica mais barato; caminho de leitura (manual, raro) pode pagar
até ~31 comandos extra sem impacto relevante na cota mensal de 500.000.

## 5. Overhead estimado (número honesto, não arredondado para parecer bonito)

Com os parâmetros padrão (probabilidade 5%, ~2-4 grupos tocados por flush):

- Cada flush bem-sucedido grava em média **~4-6 comandos** (`HINCRBY` × campos
  tocados + 1 `EXPIRE`).
- Para uma invocação típica com ~10-15 comandos Redis reais (perfil
  documentado em `DATA_ARCHITECTURE.md`, seção de orçamento), o valor
  esperado de flushes é `10 a 15 × 5% ≈ 0.5 a 0.75` — ou seja, **a maioria
  das invocações não gera nenhuma escrita de telemetria**, e quando gera, é
  uma vez só.
- Overhead esperado de comandos adicionais: **≈ 5% × (4 a 6 comandos por
  flush) ≈ 0,2 a 0,3 comando extra por comando real observado**, isto é,
  **~2-3% de overhead sobre o volume real de comandos**, não os 60-90% que
  um desenho ingênuo (flush determinístico a cada N comandos, com bucket de
  hora+dia+mês) teria produzido — esse foi o desenho inicial descartado
  durante esta etapa justamente por não bater com "overhead mínimo".
- Leitura do painel (`GET /api/dev/redis-status`): até ~31 comandos
  (agregação mensal) + 2 comandos de health check (`healthcheck:probe` +
  `pedidos`) + eventual 1 `SET` de dedup de alerta — só quando um humano
  abre o painel, nunca automático.

## 6. O que ficou de fora, deliberadamente (e por quê)

- **Atribuição por rota HTTP** (ex.: "quantos comandos o `PATCH /api/orders`
  gera"), não por grupo de chave. Fazer isso exigiria envolver cada handler
  de rota (`orders/route.ts`, `whatsapp/route.ts` — este com 1673 linhas e
  código adjacente ao Pix) com contexto de rastreamento (`AsyncLocalStorage`),
  o que tocaria arquivos de alto risco fora do escopo desta etapa ("não
  trocar a forma de leitura e gravação dos pedidos", "não alterar o
  comportamento funcional do WhatsApp"). A atribuição por **grupo de chave**
  (`orders`, `whatsapp`, `loyalty`, `pix_coordination`, `mcp`, `config`,
  `push`, `orders_lock`, `other`) dá um proxy forte e honesto — cada grupo
  corresponde quase 1:1 a uma feature, exatamente como documentado em
  `REDIS_KEY_INVENTORY.md` — sem tocar em nenhum arquivo de negócio.
- **Números "por evento de negócio"** (pedido criado vs. status mudou,
  mensagem recebida vs. enviada): ambos os pares batem na mesma chave
  (`pedidos`, `session:*`/`conversa_full:*`), então sem atribuição por rota
  não dá para separar automaticamente. A seção 5 de `DATA_ARCHITECTURE.md`
  já documenta a estimativa estática por evento (baseada em leitura de
  código); esta etapa mede o volume real agregado por grupo, para comparar
  contra aquela estimativa — não substitui, complementa.
- **Notificação real de alerta** (push/e-mail/WhatsApp quando um limiar é
  cruzado): não existe canal de notificação operacional integrado ao
  projeto hoje. Esta etapa detecta e expõe o limiar cruzado (painel + log
  estruturado via `console.error`, visível nos runtime logs da Vercel) e
  faz dedup por ciclo mensal (nunca loga o mesmo limiar duas vezes no mesmo
  mês), mas **não envia notificação externa**. Ver `redisUsageAlerts.ts`
  para a nota completa.
- **Leitura do uso OFICIAL da Upstash via API**: não existe, a partir do
  runtime desta aplicação, uma forma confiável de consultar o número real
  cobrado pela Upstash (isso exigiria a Management API deles, com
  credenciais próprias, fora do escopo). Todo número aqui é
  **estimativa interna**, e cada resposta do painel/API traz explicitamente
  `fonte: "estimativa_interna"` para nunca ser confundido com o número
  oficial. Ver `docs/operations/REDIS_RUNBOOK.md` para o procedimento de
  conferência manual no console da Upstash.

## 7. Modo degradado

Quando o próprio Redis está indisponível (a causa mais provável de o painel
precisar existir):

- `checkRedisHealth()` (em `healthChecks.ts`) detecta e classifica a falha
  (cota / timeout / rede / outro) em até 1.500ms, sem lançar.
- `checkOrdersHealth()` reaproveita o mesmo tipo de leitura protegida para
  a chave `pedidos` — reporta `down` explicitamente, nunca finge sucesso.
- O painel (`/dev/redis-status`) mostra "Indisponível" no card do
  componente afetado, com a mensagem de erro sanitizada (nunca telefone,
  nunca token) — nunca um silêncio que pareça saudável.
- A própria telemetria (`flushToRedis`) falha aberta: se o pipeline de
  persistência falhar (porque o Redis já está fora), o erro é capturado e
  logado (`console.error`), e o comando Redis real que disparou aquele
  flush **continua respondendo normalmente com seu próprio resultado/erro**
  — a falha da telemetria nunca se propaga para a rota que a originou (ver
  testes "telemetria falhando não pode derrubar a rota" em
  `redisTelemetry.test.ts`).

## 8. Segurança e PII

- `sanitizeErrorMessage` (mesma lógica de `mcpLogger.sanitizarMensagemErro`)
  mascara sequências de 8+ dígitos (telefone), valores em R$, e tokens
  `Bearer` antes de qualquer mensagem de erro ser guardada em memória ou
  logada.
- Nenhuma chave de telemetria guarda payload de mensagem, nome de cliente,
  telefone completo ou token — só nome de grupo (`orders`, `whatsapp` etc.),
  contadores numéricos e latências.
- O painel e as duas rotas de API exigem role `dev` ou `admin` (mesmo padrão
  de autenticação de `/api/dev/mcp`).

## 9. Configuração (env vars, tudo com padrão seguro se ausente)

| Variável | Padrão | Efeito |
|---|---|---|
| `REDIS_TELEMETRY_SAMPLE_PROBABILITY` | `0.05` | Probabilidade (0–1) de cada comando observado disparar um flush. |
| `REDIS_MONTHLY_COMMAND_LIMIT` | `500000` | Limite mensal usado para calcular o percentual de uso (ajustar após upgrade de plano). |
| `REDIS_USAGE_ALERT_50` / `_70` / `_85` / `_95` / `_100` | habilitado | Definir como `"false"` desliga o limiar individual. |

## 10. Testes

`src/lib/redisTelemetry.test.ts`, `src/lib/healthChecks.test.ts`,
`src/lib/redisUsageAlerts.test.ts` — cobrem os 10 cenários obrigatórios desta
etapa (comando bem-sucedido, erro de cota, timeout, Redis indisponível,
telemetria falhando sem quebrar a rota, agregação por grupo, TTL das
métricas, ausência de PII, health check saudável, health check degradado).
