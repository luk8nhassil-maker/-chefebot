# Infraestrutura oficial da Evolution API — ChefeBot

Substitui a dependência de URL temporária/PaaS efêmero (Railway) por um VPS
dedicado, com Docker Compose, persistência real (PostgreSQL + Redis + volume
de instâncias), proxy HTTPS com domínio próprio, monitoramento e backup.

Ver também: `docs/WHATSAPP_INFRASTRUCTURE.md` (domínio/DNS/HTTPS),
`docs/WHATSAPP_DISASTER_RECOVERY.md` (cenários de desastre) e
`docs/WHATSAPP_RUNBOOK.md` (operação do dia a dia).

## Componentes

| Serviço | Papel | Exposto publicamente? |
|---|---|---|
| `evolution-api` | Evolution API, versão fixada (nunca `latest`) | Não — só via proxy |
| `postgres` | Persistência de instâncias/mensagens/contatos | Não |
| `redis` | Cache/sessão da Evolution API | Não |
| `proxy` (Caddy) | HTTPS automático (ACME), único ponto exposto | Sim (80/443) |
| `uptime-kuma` | Monitoramento do healthcheck, a cada minuto | Opcional, via `UPTIME_KUMA_DOMAIN` |
| `backup` | Backup criptografado para storage S3-compatível | Não (roda sob demanda via cron) |

## Pré-requisitos

- VPS com Docker + Docker Compose plugin instalados.
- Domínio próprio, com registro DNS `A`/`AAAA` de `EVOLUTION_DOMAIN` apontando
  pro IP do VPS (ver `docs/WHATSAPP_INFRASTRUCTURE.md`).
- Bucket S3-compatível para backup (ex.: Backblaze B2, Cloudflare R2).

## Primeiro provisionamento

```sh
cd infra/evolution
cp .env.example .env
# preencha .env com valores reais — NUNCA commite esse arquivo
./scripts/deploy.sh
```

O `deploy.sh` valida as variáveis obrigatórias, sobe Postgres/Redis primeiro,
espera ficarem saudáveis, só então sobe a Evolution API e o proxy, e roda o
healthcheck.

## Depois do primeiro deploy

No painel do Vercel do projeto `chefebot-pjif`, configure:

```
EVOLUTION_API_URL=https://<EVOLUTION_DOMAIN>
EVOLUTION_API_KEY=<mesmo valor de infra/evolution/.env>
```

e redeploy o projeto. A partir daí o ChefeBot para de usar o fallback
hardcoded do Railway (removido do código — ver `src/lib/evolutionApi.ts` e
`docs/WHATSAPP_INFRASTRUCTURE.md`).

## Operação do dia a dia

| Ação | Comando |
|---|---|
| Ver status dos serviços | `docker compose ps` |
| Ver logs | `docker compose logs -f evolution-api` |
| Checar saúde manualmente | `./scripts/healthcheck.sh` |
| Atualizar versão da Evolution API | `./scripts/update.sh v2.3.0` |
| Reverter última atualização | `./scripts/rollback.sh` |
| Rodar backup manualmente | `docker compose --profile backup run --rm backup` |
| Restaurar de um backup | `./scripts/restore.sh <arquivo-ou-s3://...>` |

## Backup automático (cron do host)

Sugestão de crontab no VPS (fora do compose — cron do sistema operacional):

```cron
0 3 * * * cd /caminho/para/infra/evolution && docker compose --profile backup run --rm backup >> /var/log/chefebot-evolution-backup.log 2>&1
```

Retenção aplicada pelo próprio `backup.sh`: 7 diários, 4 semanais (domingo),
6 mensais (dia 1). Teste de restauração mensal documentado em
`docs/WHATSAPP_DISASTER_RECOVERY.md`.

## Monitoramento externo

Além do Uptime Kuma (interno, monitorando os healthchecks dos containers),
configure um monitor **externo** (fora deste VPS — ex. um serviço de uptime
de terceiros, ou outro servidor) apontando para `https://<EVOLUTION_DOMAIN>/`
a cada 1 minuto, para detectar queda do VPS inteiro (o Uptime Kuma local não
percebe se o próprio servidor cair).

## Segurança

- `postgres` e `redis` nunca têm porta publicada — só acessíveis pela rede
  interna (`internal: true`, sem saída pra internet).
- Único serviço exposto: o proxy Caddy (80/443).
- Segredos só existem no `.env` local (fora do Git — `.gitignore` da raiz já
  cobre `.env*`, mantendo `.env.example`).
- Backup é sempre criptografado (AES-256) antes de sair do VPS.
- `DEL_INSTANCE=false` — a Evolution API nunca apaga a instância sozinha por
  inatividade; só a ação explícita de reconstrução do ChefeBot decide isso.
