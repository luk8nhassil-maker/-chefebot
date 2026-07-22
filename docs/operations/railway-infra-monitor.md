# Monitor preventivo de infraestrutura Railway

Painel "Saúde da Infraestrutura" em `/dev/mcp` (aba "Saúde da Infraestrutura"),
criado após o incidente de 22/06–21/07/2026 em que o `postgres-volume` do
projeto Railway `zestful-liberation` (ambiente `production`) chegou a
99–100% de uso (então com só 500 MB), o Postgres entrou em modo de
recuperação e a Evolution/Baileys ficou presa em QR congelado. O volume foi
ampliado para 5 GB e o PR #242 corrigiu o tratamento de `QRCODE_UPDATED`. Este
monitor existe para nunca mais descobrir esse tipo de problema tarde demais.

## Arquitetura

```
GitHub Actions (a cada 6h)
  └─ railway status / railway volume list  (Railway CLI, versão fixa, só leitura)
       └─ scripts/infra/collect-railway-metrics.mjs
            └─ normaliza em MetricSample | CollectorErrorEvent
            └─ assina HMAC-SHA256 (INFRA_METRICS_HMAC_SECRET)
            └─ POST https://chefedapizza.com.br/api/internal/infra/railway/metrics
                 └─ valida assinatura + schema + idempotência (src/infra/railway/ingestValidation.ts)
                 └─ persiste em Redis, namespace infra:railway:* (src/infra/railway/persistence.ts)
                 └─ calcula transições de severidade e alertas (src/infra/railway/healthEngine.ts)

GET /api/dev/infra (auth dev, mesmo padrão de /api/dev/mcp)
  └─ src/infra/railway/readModel.ts monta o snapshot (histórico + baselines + previsão)
  └─ src/components/dev/InfraHealthPanel.tsx renderiza em /dev/mcp (seção independente)
```

Nenhuma parte deste monitor toca fluxo de pedidos, webhook de mensagens,
Guardião/atendimento humano, Pix/Mercado Pago, conciliação, cardápio,
`/pedidos`, autenticação existente, sessão do WhatsApp, configuração da
Evolution, ou o Postgres/Redis/volumes operacionais da Railway. Ele só LÊ a
Railway (nunca deploy/redeploy/restart/delete/resize/variable/migration —
ver teste estático `scripts/infra/check-no-destructive-railway-commands.mjs`)
e só ESCREVE no namespace Redis isolado `infra:railway:*`.

## Frequência de coleta

A cada 6 horas (`.github/workflows/railway-infra-monitor.yml`, cron
`0 3,9,15,21 * * *` em UTC ≈ 00h/06h/12h/18h em América/São Paulo — GitHub
Actions não suporta timezone nativo em `schedule`, por isso o cron já está
em UTC). Também disponível sob demanda via `workflow_dispatch`.

## Dados coletados (por amostra)

- Uso e capacidade do `postgres-volume` (bytes), percentual, fonte da
  capacidade (`railway` quando vem da CLI, `configured` quando cai no
  fallback configurado);
- Status simplificado (`online`/`unknown`) de Postgres, Evolution API e
  Redis da Railway.

## Dados proibidos (nunca coletados, armazenados ou expostos)

`RAILWAY_TOKEN`, `DATABASE_URL`, `EVOLUTION_API_KEY`, tokens da Vercel,
credenciais de banco, telefone, nome de cliente, mensagens, QR code, payload
de autenticação, variáveis de ambiente completas, saída bruta da Railway
CLI (stdout/stderr) e IDs internos da Railway.

## Plano Hobby — sem depender de monitores Pro

Este monitor foi desenhado para funcionar inteiramente no plano Hobby da
Railway, sem os monitores/alertas nativos exclusivos do plano Pro. A
limitação conhecida: como a coleta é feita a cada 6h (não em tempo real), um
salto muito rápido entre duas coletas só é detectado na coleta seguinte —
por isso o runbook recomenda agir a partir de 70%, nunca esperar 100%.

## Secrets e onde ficam

| Nome | Onde | Tipo |
|---|---|---|
| `RAILWAY_TOKEN` | GitHub Actions Secret (só) | Project Token da Railway, limitado ao projeto `zestful-liberation` / ambiente `production` |
| `INFRA_METRICS_HMAC_SECRET` | GitHub Actions Secret + Vercel (Production e Preview) | segredo de alta entropia, gerado uma vez |
| `CHEFEBOT_INFRA_INGEST_URL` | GitHub Actions Variable (não secreta) | `https://chefedapizza.com.br/api/internal/infra/railway/metrics` |
| `RAILWAY_POSTGRES_SERVICE` | GitHub Actions Variable | `Postgres` |
| `RAILWAY_ENVIRONMENT` | GitHub Actions Variable | `production` |
| `DEV_INFRA_MONITOR_ENABLED` | Vercel env var (Production/Preview) | `true`/ausente — controla só a persistência da ingestão e a UI, nunca a exigência de HMAC |

`RAILWAY_TOKEN` nunca vai para Vercel, código-fonte, navegador, Redis, logs,
resposta de API, artefato de CI, cache ou `.env`.

## Thresholds e severidade

| Uso | Severidade |
|---|---|
| < 70% | saudável |
| 70–79% | atenção |
| 80–89% | crítico |
| 90–94% | emergência |
| ≥ 95% | risco iminente |

Coleta mais antiga que 18h → estado "coleta atrasada". Sem leitura nenhuma
ou falha persistente do coletor → "indisponível".

## Baselines verificadas

Medições manuais feitas na Railway UI (fonte `railway-ui-manual`, ver
`src/infra/railway/verifiedBaselines.ts`), usadas só na camada de leitura
(nunca geram alerta retroativo nem são regravadas no Redis):

- 337,3 MB em 22/06/2026 01:00 (GMT-3) — volume ainda em 500 MB;
- 495,4 MB em 20/07/2026 21:00 (GMT-3) — volume ainda em 500 MB;
- 765,21 MB em 21/07/2026 21:00 (GMT-3) — já com o volume em 5 GB.

## Interpretação do crescimento observado

Entre as duas primeiras medições, o crescimento foi de aproximadamente
5,5 MB/dia — consistente com uso normal. Entre a segunda e a terceira
medição houve um salto de aproximadamente 270 MB em ~24h, que coincide com o
incidente. Este monitor **não afirma** que esse salto foi WAL, arquivo
temporário ou dado real — não há evidência direta disso, e o motor de
anomalia (`src/infra/railway/healthEngine.ts:detectAnomaly`) só sinaliza que
o crescimento fugiu do padrão recente, nunca a causa.

## Como rodar manualmente

GitHub → repositório → Actions → "railway-infra-monitor" → "Run workflow"
(branch `main`). O job roda em até 5 minutos; nenhuma saída bruta da Railway
aparece no log (o script só imprime o status HTTP da ingestão).

## Como conferir falha do workflow

Actions → "railway-infra-monitor" → abrir a execução → step "Coletar e
enviar métricas": mensagens são sempre sanitizadas (ex.: `HTTP 401`, "falha
de rede ao enviar amostra"). Se o coletor não conseguir métricas válidas, ele
ainda envia um `collector_error` (heartbeat) — o painel mostra isso como
"indisponível"/coleta com erro em vez de simplesmente parar de atualizar.

## Como rotacionar o token

1. Railway → `zestful-liberation` → Project Settings → Tokens → gerar novo
   Project Token limitado a `production`;
2. GitHub → repositório → Settings → Secrets and variables → Actions →
   atualizar `RAILWAY_TOKEN`;
3. Revogar o token antigo na Railway;
4. Rodar o workflow manualmente para confirmar que a nova credencial funciona.

## Como desativar

- Rápido (só o painel): apagar/definir `DEV_INFRA_MONITOR_ENABLED=false` na
  Vercel — a UI volta a mostrar "Monitor ainda não ativado" e a ingestão
  para de persistir novas amostras (mas continua exigindo HMAC válido);
- Completo: desabilitar o workflow em Actions ("Disable workflow") — para a
  coleta na origem.

## Rollback

Reverter o PR deste monitor remove a rota de ingestão, a API `/api/dev/infra`
e a aba do painel — nenhuma outra rota, fluxo operacional ou dado de negócio
é afetado. As chaves `infra:railway:*` no Redis podem ficar órfãs (têm TTL/
retenção de 180 dias e limite de 1000 amostras — nunca crescem sem limite) e
não precisam de limpeza manual.

## Resposta recomendada por faixa

Ver `docs/operations/runbook-postgres-volume.md`.

## Proibição de esperar chegar a 100%

Este monitor existe justamente porque, no incidente de origem, o volume
chegou a 99–100% antes de qualquer ação. A regra operacional é agir a partir
de 70% (investigar) e nunca deixar o uso chegar perto de 100% de novo —
mesmo que a previsão pareça "confortável", ela é sempre uma estimativa.

## Custo operacional

Um job leve (menos de 5 minutos) a cada 6h no GitHub Actions, mais um
número pequeno e documentado de operações Redis por coleta (ver
`src/infra/railway/persistence.ts`) dentro do mesmo Redis já usado pelo
ChefeBot, em namespace isolado com retenção limitada.

## Ausência de acesso ao conteúdo do banco

Este monitor nunca executa nenhuma consulta SQL nem lê uma única linha de
tabela do Postgres da Railway — só o tamanho ocupado do volume, reportado
pela própria Railway CLI.
