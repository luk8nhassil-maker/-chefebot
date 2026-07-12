# Infraestrutura do WhatsApp (Evolution API) — ChefeBot

Este documento descreve a arquitetura definitiva de infraestrutura do WhatsApp do
ChefeBot, substituindo o hotfix temporário do PR #175 (URL do Railway usada como
fallback hardcoded).

## Visão geral

```
Cliente WhatsApp
      │
      ▼
Evolution API (Baileys) ──── webhook ───▶ ChefeBot (Vercel, chefebot-pjif)
      │
      ├── PostgreSQL (dados da instância, mensagens, contatos)
      ├── Redis (cache, filas)
      └── Volume persistente (/evolution/instances — sessão do Baileys)

Tudo hospedado em um VPS dedicado, atrás de um proxy HTTPS (Caddy),
sob um domínio próprio estável (nunca o domínio do provedor de hospedagem).
```

Todos os arquivos de infraestrutura como código estão em `infra/evolution/`:

| Arquivo | Função |
|---|---|
| `docker-compose.yml` | Orquestra todos os serviços |
| `.env.example` | Template de variáveis de ambiente (nunca commitar `.env` real) |
| `Caddyfile` | Proxy reverso HTTPS estático |
| `README.md` | Guia operacional passo a passo |
| `scripts/deploy.sh` | Sobe a stack pela primeira vez ou após mudanças no compose |
| `scripts/update.sh` | Atualiza a versão da Evolution API com backup prévio |
| `scripts/rollback.sh` | Reverte para a versão anterior em caso de falha |
| `scripts/healthcheck.sh` | Verifica a saúde de todos os serviços |
| `scripts/backup.sh` | Backup completo (Postgres + volume de instâncias), criptografado, enviado a storage S3-compatível |
| `scripts/restore.sh` | Restauração completa a partir de um backup |

## Componentes

### Evolution API
- Imagem: `atendai/evolution-api:<tag exata>` — **nunca `latest`**. A tag em uso fica
  registrada em `infra/evolution/.env` (`EVOLUTION_IMAGE_TAG`), fora do Git.
- Não expõe porta publicamente; só é acessível pela rede interna do Docker, através
  do proxy Caddy.
- Persiste sessão do Baileys em volume nomeado (`evolution-instances`), garantindo
  que reinícios do container não exijam novo QR Code.
- Banco de dados habilitado (`DATABASE_ENABLED=true`, `DATABASE_PROVIDER=postgresql`,
  `DATABASE_SAVE_DATA_INSTANCE=true`) para persistir estado além do volume.
- Cache Redis habilitado (`CACHE_REDIS_ENABLED=true`).
- `DEL_INSTANCE=false` — a Evolution nunca apaga instâncias sozinha por timeout/erro.
- `AUTHENTICATION_API_KEY` obrigatória (sem valor default) — sem ela o container não
  inicia.
- `CORS_ORIGIN` restrito às origens do ChefeBot.

### PostgreSQL
- Roda em rede interna (`internal: true` — sem acesso à internet, sem porta
  publicada). Só a Evolution API acessa.
- Volume nomeado persistente. Healthcheck via `pg_isready`.

### Redis
- Mesma rede interna, sem porta publicada. Senha obrigatória
  (`--requirepass`). Persistência via `appendonly yes`.

### Proxy (Caddy)
- Único serviço com portas 80/443 publicadas.
- HTTPS automático via Let's Encrypt, renovação automática.
- Encaminha `https://evolution.<domínio>` → `evolution-api:8080` internamente.

### Monitoramento (Uptime Kuma)
- Painel próprio, monitora o healthcheck da Evolution API e do proxy a cada minuto.
- Serve como o "monitoramento externo" citado nos requisitos — roda no mesmo VPS,
  mas de forma independente do container da Evolution, então continua alertando
  mesmo se a Evolution cair.

### Backups
- Job dedicado (`profiles: ["backup"]`, roda sob demanda ou via cron do host) que
  executa `scripts/backup.sh`: dump do Postgres + tar do volume de instâncias,
  criptografado com `openssl enc -aes-256-cbc -pbkdf2`, enviado a um bucket
  S3-compatível. Retenção: 7 diários, 4 semanais, 6 mensais.

## Rede

| Rede Docker | Serviços | Acesso externo |
|---|---|---|
| `internal` (internal: true) | postgres, redis | Nenhum — nem os containers têm saída à internet |
| `proxy` | evolution-api, proxy, uptime-kuma | Só o `proxy` publica portas (80/443) |

Nenhum banco de dados é público. Apenas o proxy HTTPS é exposto.

## Domínio

- `EVOLUTION_API_URL` do ChefeBot aponta para `https://evolution.<domínio oficial>`.
- **Nunca** um domínio de plataforma de hospedagem (Railway, Render, etc.) — esses
  hosts podem reciclar/desligar o app e devolver uma página de erro genérica da
  própria plataforma (não da Evolution API), quebrando silenciosamente a integração.
  Foi exatamente isso que causou o incidente do PR #175.
- Ver `docs/WHATSAPP_DISASTER_RECOVERY.md` para o procedimento de troca de
  servidor mantendo o mesmo domínio.

## Variáveis de ambiente no ChefeBot (Vercel)

| Variável | Obrigatória | Validação |
|---|---|---|
| `EVOLUTION_API_URL` | Sim | Deve ser uma URL `https://` válida (`obterConfigEvolution()` em `src/lib/evolutionApi.ts`) |
| `EVOLUTION_API_KEY` | Sim | Não pode estar vazia |
| `EVOLUTION_INSTANCE_NAME` | Não (default `chefebot`) | — |
| `EVOLUTION_WEBHOOK_URL` | Não, mas recomendada | Se ausente, a configuração de webhook é pulada silenciosamente |
| `CRON_SECRET` | Sim (para o healthcheck agendado) | Bearer token comparado no cron |
| `OPS_ALERT_WEBHOOK_URL` | Opcional | Se ausente, nenhum alerta é enviado (não é erro) |

Se `EVOLUTION_API_URL` ou `EVOLUTION_API_KEY` estiverem ausentes ou inválidas, o
ChefeBot **nunca** tenta o host antigo do Railway nem qualquer valor adivinhado —
todas as rotas retornam o estado `provider_not_configured` e não chamam `fetch`.

## Rotas da API do ChefeBot

| Rota | Método | Ação | Destrutiva? |
|---|---|---|---|
| `/api/whatsapp/verify` | GET | Só verifica o estado, nunca altera nada | Não |
| `/api/whatsapp/connect` | POST | Ação padrão do painel: cria se ausente, conecta, nunca apaga | Não |
| `/api/whatsapp/rebuild` | POST | Reconstrução completa (logout+delete+create) | **Sim** — exige confirmação |
| `/api/whatsapp/reset` | POST | Compatibilidade — redireciona internamente para o fluxo seguro de `connect` | Não (desde esta versão) |
| `/api/whatsapp/state` | GET | Estado consolidado para o painel `/admin` | Não |
| `/api/cron/whatsapp-health` | GET | Healthcheck agendado, protegido por `CRON_SECRET` | Não |

Ver `docs/WHATSAPP_RUNBOOK.md` para os fluxos operacionais e
`docs/WHATSAPP_DISASTER_RECOVERY.md` para cenários de falha.
