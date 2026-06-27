# Regras de Deploy e Produção

## Projeto oficial na Vercel

| Campo | Valor |
|---|---|
| Projeto | `chefebot-pjif` |
| URL de produção | `chefebot-pjif.vercel.app` |
| Branch | `main` |

Um deploy é válido quando aparecer no painel Vercel com:
- **Projeto:** `chefebot-pjif`
- **Environment:** `Production`
- **Status:** `Ready`
- **Branch:** `main`

## Projetos duplicados (não oficiais)

Os projetos `chefebot` e `chefebot-3ke5` existem na mesma conta Vercel mas **não são o projeto de produção**. Não configurar variáveis de ambiente ou domínios neles. Ignorar até segunda ordem.

## Se o deploy não disparar automaticamente

Pode acontecer quando um PR é mesclado via Claude/MCP e o hook da Vercel não é acionado.

Solução em ordem de preferência:
1. Conferir o status manualmente no painel Vercel (`chefebot-pjif` → Deployments).
2. Se necessário, o owner dispara um novo deploy pela interface da Vercel.
3. Último recurso: criar um commit mínimo na `main` (ex.: ajuste de comentário) para forçar o gatilho.

Só considerar uma tarefa em produção quando o deploy estiver `Ready` no projeto `chefebot-pjif`.

---

## Checklist manual final antes da PWA

Executar manualmente em produção (`chefebot-pjif.vercel.app`) antes de iniciar a implementação da PWA:

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
