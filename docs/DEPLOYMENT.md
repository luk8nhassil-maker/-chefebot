# Regras de Deploy e Produção

## Projeto oficial na Vercel

| Campo | Valor |
|---|---|
| Projeto | `chefebot-contingencia` |
| Time/conta Vercel | `chefe-da-pizza` |
| Branch | `main` |

Um deploy é válido quando aparecer no painel Vercel com:
- **Projeto:** `chefebot-contingencia`
- **Environment:** `Production`
- **Status:** `Ready`
- **Branch:** `main`

## Projetos duplicados (não oficiais)

Os projetos `chefebot`, `chefebot-3ke5` e `chefebot-pjif` existem em contas Vercel diferentes mas **não são o projeto de produção**. Não configurar variáveis de ambiente ou domínios neles. Ignorar até segunda ordem.

## Se o deploy não disparar automaticamente

Pode acontecer quando um PR é mesclado via Claude/MCP e o hook da Vercel não é acionado.

Solução em ordem de preferência:
1. Conferir o status manualmente no painel Vercel (`chefebot-contingencia` → Deployments).
2. Se necessário, o owner dispara um novo deploy pela interface da Vercel.
3. Último recurso: criar um commit mínimo na `main` (ex.: ajuste de comentário) para forçar o gatilho.

Só considerar uma tarefa em produção quando o deploy estiver `Ready` no projeto `chefebot-contingencia`.

---

## Canário de diagnóstico do WhatsApp (`/dev/whatsapp`)

Painel só-leitura/ação explícita em `/dev/whatsapp` (admin/dev) com um teste
real ponta-a-ponta sob demanda (`POST /api/dev/whatsapp/canary`), sem cron
nem polling. Requer a env var `WHATSAPP_CANARY_PHONE` configurada em
Production na Vercel — único telefone que pode receber o teste, nunca aceito
por parâmetro da requisição. Nunca commitar o valor real dessa variável em
código, teste, log ou documentação versionada; configurar só no painel da
Vercel. Rate limit de 1 início a cada 5 minutos; TTL do teste de 10 minutos.
Ver `src/lib/whatsappCanary.ts` para a lógica e `src/app/dev/whatsapp/page.tsx`
para o painel.

---

## Checklist manual final antes da PWA

Executar manualmente em produção (projeto `chefebot-contingencia` na Vercel) antes de iniciar a implementação da PWA:

- [ ] 1. Pedido de pizza completo (do início à confirmação)
- [ ] 2. Bebida ou suco adicionado ao pedido
- [ ] 3. Entrega com bairro e taxa correta aplicada
- [ ] 4. Retirada sem pedir endereço de entrega
- [ ] 5. Pix — bot gera chave, badge "PIX⏳" aparece no painel de Conversas
- [ ] 6. Dinheiro — bot pergunta troco, pedido finaliza corretamente
- [ ] 7. Atendimento humano assumido pelo atendente (bot silencia)
- [ ] 8. Cliente manda nova mensagem durante atendimento humano (bot não responde)
- [ ] 9. Conversa sobe/destaca no Tempo Real ao chegar mensagem nova
- [ ] 10. Bot não retoma sozinho dentro das 2h de atendimento manual
