# Recuperação de desastre — WhatsApp do ChefeBot

Cenários de falha, causa provável, e procedimento de recuperação. Para o
significado de cada estado ver `docs/WHATSAPP_RUNBOOK.md`. Para a arquitetura
completa ver `docs/WHATSAPP_INFRASTRUCTURE.md`.

## Metas de recuperação (RTO)

| Tipo de falha | Meta de recuperação |
|---|---|
| Container da Evolution API trava/reinicia | Automática — `restart: unless-stopped` + healthcheck, sem intervenção |
| Processo interno da Evolution falha (sem derrubar o container) | Automática — healthcheck do Docker reinicia o container |
| Falha detectada por monitoramento externo | Até 5 minutos (Uptime Kuma verifica a cada minuto; cron do ChefeBot a cada 5 min/conforme plano) |
| VPS inteiro reinicia | Automática — `docker compose` com `restart: unless-stopped` sobe tudo de novo ao boot, desde que o Docker esteja configurado para iniciar no boot do sistema |
| Perda completa do servidor | Manual — restaurar em VPS novo a partir do backup mais recente (ver abaixo) |

## Cenário: serviço travado / não responde

**Sintoma:** `verify` retorna `provider_down`, mas o domínio resolve e o
container aparece rodando.

1. Acessar o VPS via SSH.
2. `cd infra/evolution && ./scripts/healthcheck.sh` para identificar qual
   serviço está falhando.
3. Se só a Evolution API estiver com problema: `docker compose restart
   evolution-api`.
4. Verificar logs: `docker compose logs -f evolution-api`.
5. Confirmar recuperação com `GET /api/whatsapp/verify` no ChefeBot.
6. **Não usar `rebuild`** neste cenário — reiniciar o container preserva a
   sessão (volume persistente); reconstruir a apagaria desnecessariamente.

## Cenário: VPS reiniciado (queda de energia, manutenção do provedor)

1. Confirmar que o Docker está configurado para iniciar no boot
   (`systemctl is-enabled docker`).
2. Confirmar que todos os containers subiram: `docker compose ps`.
3. Rodar `./scripts/healthcheck.sh`.
4. Se a Evolution não reconectar sozinha ao WhatsApp (raro, pois a sessão é
   persistida no volume), usar a ação segura `connect` no `/admin` — não
   `rebuild`.

## Cenário: domínio indisponível (DNS ou certificado)

**Sintoma:** `verify` retorna `provider_down` mas o VPS/containers estão
saudáveis localmente (`healthcheck.sh` passa via IP direto).

1. Verificar propagação DNS: `dig +short evolution.<domínio>` deve apontar
   para o IP do VPS.
2. Verificar certificado: `curl -vI https://evolution.<domínio>` — checar
   validade e cadeia do certificado emitido pelo Caddy/Let's Encrypt.
3. Se o DNS estiver correto mas o certificado falhar, checar logs do Caddy:
   `docker compose logs proxy`. Rate limits do Let's Encrypt são a causa mais
   comum (aguardar ou usar um certificado alternativo).
4. **Nunca reconstruir a instância por causa de um problema de DNS/domínio**
   — a instância e a sessão do WhatsApp não têm relação com o problema.

## Cenário: chave de API inválida

**Sintoma:** `verify`/`connect` retornam `provider_unauthorized` (401/403).

1. Conferir `EVOLUTION_API_KEY` nas variáveis de ambiente da Vercel
   (`chefebot-pjif`) contra o valor de `AUTHENTICATION_API_KEY` no `.env` do
   servidor Evolution.
2. Se divergiram (ex.: rotação de chave no servidor sem atualizar a Vercel),
   corrigir o valor na Vercel e fazer redeploy.
3. **Nunca reconstruir a instância por causa de chave inválida** — corrigir a
   chave já resolve; `rebuild` não tem efeito sobre isso e ainda descartaria
   a sessão à toa.

## Cenário: instância desconectada (sessão expirou/foi encerrada pelo WhatsApp)

1. Usar a ação segura `connect` no `/admin` (ou `POST
   /api/whatsapp/connect`).
2. Escanear o novo QR Code exibido manualmente.
3. Só usar `rebuild` se `connect` falhar repetidamente e os logs indicarem
   corrupção da sessão local (ver próximo cenário).

## Cenário: sessão corrompida (Baileys não reconecta mesmo após `connect` repetido)

1. Confirmar que o problema é mesmo local (não é `provider_down`/DNS/chave —
   descartar esses cenários primeiro).
2. Fazer backup antes de qualquer ação destrutiva: `./scripts/backup.sh`.
3. Executar a reconstrução de emergência pelo `/admin`, com a frase de
   confirmação exata `RECRIAR CHEFEBOT` (ver `docs/WHATSAPP_RUNBOOK.md`).
4. Escanear o novo QR Code manualmente.
5. Confirmar em `verify` que o estado voltou a `connected`.

## Cenário: perda completa do servidor (VPS destruído, provedor indisponível)

Meta: restaurar em um VPS novo mantendo o mesmo domínio e sem depender do
servidor antigo.

1. Provisionar um novo VPS.
2. Instalar Docker + Docker Compose.
3. Clonar `infra/evolution/` (ou copiar os arquivos) para o novo servidor.
4. Copiar (fora do Git, por canal seguro) o `.env` com os mesmos segredos —
   ou gerar novos e atualizá-los na Vercel também.
5. Restaurar o backup mais recente: `./scripts/restore.sh
   <arquivo-ou-s3://...>` — exige digitar a confirmação `RESTAURAR CHEFEBOT`.
6. Atualizar o registro DNS do domínio (`evolution.<domínio>`) para o IP do
   novo VPS (ver seção de troca de servidor abaixo).
7. Rodar `./scripts/healthcheck.sh` até tudo ficar saudável.
8. Confirmar `verify` no ChefeBot retorna `connected` (a sessão restaurada
   deve reconectar sozinha, sem novo QR, já que o volume de instâncias foi
   restaurado).
9. Testar o envio/recebimento de uma mensagem real.

## Troca de servidor mantendo o domínio

1. Reduzir o TTL do registro DNS (ex.: para 300s) **antes** de iniciar a
   migração, com antecedência suficiente para a mudança propagar.
2. Provisionar e validar o novo servidor com o domínio antigo apontando
   ainda para o servidor atual (testar via IP direto ou `/etc/hosts` local).
3. Restaurar o backup mais recente no novo servidor.
4. Atualizar o registro DNS para o novo IP.
5. Validar propagação: `dig +short evolution.<domínio>` a partir de mais de
   uma rede/localização.
6. Validar certificado HTTPS emitido no novo servidor.
7. Só desligar o servidor antigo depois de confirmar `verify` = `connected`
   no domínio novo por um período de observação (ex.: 30 minutos).
8. Restaurar o TTL do DNS ao valor normal depois da migração concluída.

## Troca de IP mantendo o domínio (sem trocar de servidor)

1. Reduzir o TTL do DNS antes da mudança.
2. Atualizar o registro A/AAAA para o novo IP.
3. Validar propagação e certificado como acima.
4. Restaurar o TTL do DNS ao valor normal.

## Rollback de versão da Evolution API

1. Nunca atualizar direto em produção sem antes rodar `./scripts/update.sh
   <nova-tag>` (que já faz backup automático e grava a tag anterior em
   `.env.tag-anterior`).
2. Se a nova versão apresentar problema: `./scripts/rollback.sh` — reverte
   para a tag anterior registrada e roda o healthcheck.
3. Confirmar `verify` = `connected` após o rollback.

## QR Code necessário

- Sempre que o estado for `qr_required`, acessar `/admin` e escanear
  manualmente com o WhatsApp oficial do ChefeBot.
- O QR nunca é escaneado automaticamente por nenhum processo do sistema.
- QR expirado: chamar `connect` novamente para gerar um novo — não é
  necessário `rebuild`.

## Quando NUNCA usar `rebuild`

- Provider fora do ar (`provider_down`) — reconstruir não conserta um
  servidor que não está respondendo.
- Chave de API inválida (`provider_unauthorized`) — corrigir a chave resolve;
  reconstruir não.
- Domínio/DNS com problema — reconstruir não afeta DNS.
- Provider não configurado (`provider_not_configured`) — não há nada para
  reconstruir; configurar as variáveis de ambiente primeiro.
- Qualquer situação em que `connect` (ação segura, sem apagar nada) ainda não
  foi tentada.

## Teste mensal de restauração

Recomendado (não automatizado): uma vez por mês, em um ambiente separado
(outro VPS ou máquina de teste, nunca em produção):

1. Baixar o backup mais recente do storage S3-compatível.
2. Rodar `./scripts/restore.sh <arquivo>` nesse ambiente separado.
3. Confirmar que o Postgres e o volume de instâncias foram restaurados
   corretamente e que `./scripts/healthcheck.sh` passa.
4. Documentar a data e o resultado do teste (sucesso/falha e o que foi
   corrigido) em um registro interno da equipe.
5. Descartar o ambiente de teste depois — nunca apontar esse ambiente para o
   domínio de produção.
