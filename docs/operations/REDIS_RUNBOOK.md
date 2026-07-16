# Runbook — Redis (ChefeBot)

Procedimentos operacionais para quem estiver de plantão quando o painel
`/dev/redis-status` (ou os runtime logs da Vercel) indicar um problema no
Redis. Complementa `docs/architecture/REDIS_TELEMETRY.md` (desenho técnico) e
`docs/architecture/FAILURE_MODES.md` (modos de falha do sistema como um
todo).

## 1. Onde olhar primeiro

1. **Painel interno:** `https://chefebot-pjif.vercel.app/dev/redis-status`
   (login com role `dev` ou `admin`). Mostra saúde de Redis/WhatsApp/Pedidos,
   uso estimado do mês, e as rotas/grupos com maior consumo na invocação
   atual.
2. **Console oficial da Upstash:** `https://console.upstash.com` → banco
   `upstash-kv-rose-flower` (ou o banco que substituiu esse, se já migrado
   para Pay-as-you-go) → aba de uso/plano. **Este é o número que importa
   para faturamento** — o painel interno mostra só uma estimativa.
3. **Runtime logs da Vercel:** projeto `chefebot-pjif` → aba Observability
   → filtrar por `UpstashError` ou `[redisUsageAlerts]`.

## 2. "O painel interno e o console da Upstash não batem — qual eu confio?"

O console da Upstash. Sempre. O painel interno (`/dev/redis-status`) é uma
**estimativa interna** (campo `fonte: "estimativa_interna"` em toda
resposta), calculada por amostragem probabilística dentro da própria
aplicação — ver `REDIS_TELEMETRY.md` seção 6. Ele existe para dar uma
tendência e permitir alertar cedo, não para ser a fonte de faturamento. Se
os dois divergirem, é esperado (amostragem tem margem de erro) — o que
importa é a **tendência** (subindo rápido? platô?), não o número exato.

## 3. Um limiar de alerta foi cruzado (log `[redisUsageAlerts]`)

1. Confira o número oficial no console da Upstash (passo 1.2).
2. Se estiver de fato perto do limite do plano:
   - **< 85%:** sem ação imediata — monitore, considere revisar os grupos de
     maior consumo no painel (provavelmente `orders` ou `whatsapp`, dado o
     padrão de polling documentado em `DATA_ARCHITECTURE.md`).
   - **≥ 85%:** avalie se o programa de migração (Etapa D em diante,
     `DATABASE_MIGRATION_PLAN.md`) precisa ser acelerado, ou se um upgrade
     de plano (Upstash Pay-as-you-go) é a resposta mais rápida.
   - **≥ 95% ou 100%:** tratar como o mesmo tipo de incidente já documentado
     (ver histórico do incidente P0 original) — considerar upgrade de plano
     imediato antes que comandos comecem a ser rejeitados.
3. **Não existe notificação automática além do log.** Se você não está
   olhando ativamente o painel ou os logs, não vai saber. Isso é uma
   limitação conhecida desta etapa (ver `REDIS_TELEMETRY.md` seção 6) — até
   um canal de notificação real (push/e-mail/WhatsApp interno) ser
   implementado, o hábito de checar `/dev/redis-status` periodicamente (ou
   configurar um monitor externo simples apontando para
   `/api/dev/redis-status`) é a mitigação disponível.

## 4. `/dev/redis-status` mostra "Redis: Indisponível"

1. Confirme se é cota (mensagem menciona "max requests limit exceeded" /
   "Cota do Redis excedida") ou outra causa (timeout, rede).
2. Se for cota: siga o passo 3 acima.
3. Se for timeout/rede: verificar status da Upstash
   (`https://status.upstash.com`, se existir) antes de assumir problema no
   lado do ChefeBot.
4. **Nunca** tente "contornar" reiniciando/reconfigurando nada em produção
   sem confirmar a causa raiz primeiro — mesma disciplina do incidente P0
   original ("primeiro encontre e prove a causa raiz, só depois implemente
   correção").

## 5. `/dev/redis-status` mostra "WhatsApp: Indisponível"

Esta checagem **só confirma configuração** (`EVOLUTION_API_URL`/
`EVOLUTION_API_KEY` presentes e válidas) — não confirma que a instância está
conectada/QR code escaneado. Se aparecer "Indisponível":

1. Confirme as env vars no projeto Vercel `chefebot-pjif`, ambiente
   Production.
2. Se as env vars existem e mesmo assim aparece indisponível, o problema é
   de formato/validação (ver `src/lib/evolutionApi.ts:normalizarBaseUrl` —
   só aceita HTTPS).
3. Esta checagem **não** indica se o WhatsApp está de fato respondendo
   mensagens — para isso, use o teste manual já documentado no incidente
   original (mensagem de teste controlada, nunca para cliente real).

## 6. `/dev/redis-status` mostra "Pedidos: Degradado"

Significa que a chave `pedidos` existe no Redis mas não é um array (formato
inesperado). Isso é sinal de corrupção de dado ou de uma escrita malformada
em algum ponto do código — **investigar antes de qualquer ação**, não
sobrescrever a chave sem entender a causa. Não é uma condição esperada em
operação normal.

## 7. Ajustando os limiares/probabilidade sem alterar código

Todas as env vars abaixo têm padrão seguro se ausentes — só defina se
precisar mudar o comportamento padrão, sempre em Production via painel
Vercel, com redeploy:

- `REDIS_MONTHLY_COMMAND_LIMIT` — atualizar após upgrade de plano na
  Upstash (o padrão 500.000 é o limite do plano Free documentado no
  incidente original).
- `REDIS_TELEMETRY_SAMPLE_PROBABILITY` — só reduzir (menos amostragem) se
  o overhead de telemetria (ver `REDIS_TELEMETRY.md` seção 5) precisar
  ficar ainda menor; aumentar dá mais precisão à estimativa, ao custo de
  mais comandos de telemetria.
- `REDIS_USAGE_ALERT_50` / `_70` / `_85` / `_95` / `_100` — definir como
  `"false"` para silenciar um limiar específico (raramente necessário).

## 8. O que este runbook NÃO cobre

Nada relacionado ao fluxo Pix Mercado Pago (geração de copia-e-cola,
webhook, polling, conciliação, pagamento misto) — esse fluxo não foi tocado
por esta etapa e continua com seus próprios procedimentos operacionais já
existentes, fora deste documento.
