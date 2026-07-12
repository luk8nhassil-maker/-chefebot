# Runbook operacional — WhatsApp do ChefeBot

Guia do dia a dia para operar a integração do WhatsApp. Para provisionamento
inicial ver `infra/evolution/README.md`; para cenários de desastre ver
`docs/WHATSAPP_DISASTER_RECOVERY.md`.

## Estados possíveis

O ChefeBot classifica o provider do WhatsApp em um destes estados
(`EstadoProviderWhatsapp`, `src/lib/evolutionApi.ts`):

| Estado | Significado | Ação recomendada |
|---|---|---|
| `provider_not_configured` | `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` ausentes ou inválidas | Configurar as variáveis na Vercel. Nunca tenta nenhum host. |
| `provider_down` | Host indisponível (erro de borda da plataforma, timeout, DNS) | Verificar se o VPS/Evolution está no ar. **Nunca** "Resetar" como primeira ação. |
| `provider_unauthorized` | Chave de API inválida (401/403) | Conferir `EVOLUTION_API_KEY` no ChefeBot e no `.env` do servidor. |
| `instance_missing` | Instância ainda não foi criada | Clicar em "Conectar" — cria automaticamente. |
| `instance_disconnected` | Instância existe mas está desconectada | Clicar em "Conectar" — reconecta sem apagar nada. |
| `qr_required` | Aguardando leitura do QR Code | Escanear o QR exibido no `/admin`. |
| `connecting` | Em processo de conexão | Aguardar, recarregar em alguns segundos. |
| `connected` | Tudo funcionando | Nenhuma ação. |
| `webhook_error` | Instância conectada, mas o webhook não foi configurado | Verificar `EVOLUTION_WEBHOOK_URL` e reconectar. |
| `unknown` | Resposta inesperada da Evolution API | Verificar logs, considerar `verify` novamente. |

O painel `/admin` mostra: estado atual, última verificação, última conexão
válida, última mensagem recebida, e o botão correto para o estado (nunca
"Resetar" como primeira opção para `provider_down`).

## As três ações

### 1. VERIFICAR (`GET /api/whatsapp/verify`)
- Somente leitura. Nunca cria, apaga ou reconecta nada.
- Use para diagnosticar antes de qualquer ação.
- Requer papel `admin` ou `dev`.

### 2. CONECTAR / GERAR QR (`POST /api/whatsapp/connect`)
- Ação padrão e seguro do painel.
- Se a instância não existe, cria; se existe mas está desconectada, tenta
  reconectar; se já conectada, não faz nada.
- **Nunca** executa `logout` ou `delete`.
- Configura o webhook automaticamente se `EVOLUTION_WEBHOOK_URL` estiver
  definida.
- Retry limitado (até 10 tentativas, ~1s de intervalo) esperando o QR Code
  ficar disponível.
- Requer papel `admin` ou `dev`.

### 3. RECONSTRUIR INSTÂNCIA (`POST /api/whatsapp/rebuild`) — ação de emergência
- **Destrutiva**: faz `logout` → `delete` → `create` → configura webhook →
  gera novo QR.
- Use **somente** quando a instância estiver em um estado corrompido que
  `connect` não resolve (ex.: sessão do Baileys corrompida).
- **Nunca use** para: provider fora do ar, chave inválida, ou domínio/DNS com
  problema — nesses casos a reconstrução não resolve nada e ainda descarta a
  sessão atual.
- Exige, no corpo da requisição:
  ```json
  { "mode": "rebuild", "confirmacao": "RECRIAR CHEFEBOT" }
  ```
  A frase de confirmação deve ser exatamente `RECRIAR CHEFEBOT` (maiúsculas,
  sem variação). Qualquer corpo diferente retorna `400` sem tocar na Evolution
  API.
- Limitada a 2 tentativas por janela de 15 minutos (rate limit).
- Toda tentativa (sucesso ou falha) é registrada em auditoria
  (`src/lib/whatsappAudit.ts`), com usuário, papel, horário e resultado —
  nunca com segredos ou QR Code.
- Requer papel `admin` ou `dev` (nunca `atendente`).
- Se o host estiver fora do ar ou a credencial for inválida durante o
  `logout`/`delete`, a reconstrução para imediatamente e **não chega a criar
  uma instância nova**.

### Rota de compatibilidade (`POST /api/whatsapp/reset`)
- Mantida por compatibilidade com integrações antigas.
- Desde esta versão, **não executa mais** o fluxo destrutivo — internamente
  chama o mesmo fluxo seguro do `connect` (cria se ausente, reconecta, nunca
  apaga).

## Monitoramento contínuo

- `GET /api/cron/whatsapp-health`, protegido por `Authorization: Bearer
  <CRON_SECRET>`.
- Executa a cada 5 minutos (ver limitação do plano Vercel abaixo).
- Persiste o resultado no Redis (`whatsapp:provider:estado`), incluindo
  contador de falhas consecutivas.
- A partir da 2ª falha consecutiva, envia um alerta (se
  `OPS_ALERT_WEBHOOK_URL` estiver configurada). Não repete o alerta em falhas
  subsequentes (dedup por estado).
- Ao recuperar depois de ter alertado falha, envia um alerta único de
  normalização.
- Payload do alerta contém **apenas**: `ambiente`, `estado`, `etapa`,
  `horario`, `quantidadeFalhas`. Nunca inclui chave de API, cookie, telefone,
  QR Code ou corpo de resposta bruto.

### Limitação do plano Vercel (Hobby)
No plano Hobby, cron jobs da Vercel rodam no máximo uma vez por dia,
independente do `schedule` configurado em `vercel.json`. Para obter a
cadência real de 5 minutos, é necessário:
- Migrar o projeto para o plano Pro da Vercel, **ou**
- Configurar um agendador externo (ex.: cron-job.org, GitHub Actions
  agendado, Uptime Kuma com "push monitor") batendo em
  `GET /api/cron/whatsapp-health` com o header `Authorization: Bearer
  <CRON_SECRET>` a cada 5 minutos.

O monitoramento do Uptime Kuma na própria infraestrutura (`infra/evolution/`)
complementa isso, checando a Evolution API diretamente a cada minuto,
independente do cron da Vercel.

## Quando escanear o QR Code

- O QR Code é sempre exibido no painel `/admin`.
- **Nunca é escaneado automaticamente** por nenhuma parte do sistema — é uma
  ação manual e intencional de quem está operando o WhatsApp oficial do
  ChefeBot.
- Um QR expirado é resolvido chamando `connect` novamente (não requer
  `rebuild`).

## Segurança

- Todas as rotas administrativas (`verify`, `connect`, `rebuild`, `state`)
  exigem papel `admin` ou `dev` — `atendente` recebe `403`.
- `rebuild` tem rate limit e auditoria; nenhuma outra rota destrutiva tem GET
  (nenhuma ação de leitura muda estado).
- Mensagens de erro são sanitizadas antes de chegar ao painel — nunca
  vazam o corpo bruto da resposta da Evolution API nem a chave de API.
- QR Code e chave de API nunca aparecem em logs do servidor.
