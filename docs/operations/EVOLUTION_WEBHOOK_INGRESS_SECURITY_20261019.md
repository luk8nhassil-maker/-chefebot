# Proteção de ingresso Evolution — liberação controlada

## Estado e objetivos
O código pode ser publicado **sem mudar o atendimento atual**: quando `EVOLUTION_WEBHOOK_SHARED_SECRET` não existe, mantém-se o caminho legado. A inbox nova só fica elegível quando o segredo do webhook estiver configurado (mínimo 32 caracteres), o rollout estiver explicitamente ativo e o QStash estiver configurado.

Isso **não é** prova de segurança completa, nem autorização para habilitar `all`. A situação anterior de webhook público sem assinatura não deve ser considerada validada.

## Integração obrigatória (proprietário/operador autenticado, sem copiar segredos para chat ou Git)
1. Conferir no serviço Evolution ativo se o webhook efetivo é o da instância (não apenas um webhook GLOBAL). Confirmar HTTPS, destino de produção, eventos e suporte, **na versão em execução**, a cabeçalhos estáticos. Não alterar a URL nem os eventos sem rollback planejado.
2. Gerar segredo de alta entropia (mínimo 32 caracteres, recomendado 32 bytes aleatórios ou mais). Configurar PRIMEIRO na instância Evolution o cabeçalho exato `x-chefebot-evolution-secret` com esse valor; o ChefeBot antigo ignora o novo header, portanto a mudança é compatível.
3. Confirmar entrega de um evento sem efeitos comerciais e que a Evolution incluiu o header no webhook (não imprimir ou registrar o valor). Então configurar `EVOLUTION_WEBHOOK_SHARED_SECRET` no ambiente **production** da Vercel, redeploy oficial e saúde do atendimento.
4. Com segredo configurado, requisições públicas ao `POST /api/whatsapp` sem header válido devem retornar 401. Segredo curto configurado retorna 503; esse caso exige correção imediata. Webhook interno do worker QStash fica fora deste verificador por usar escopo local validado pelo callback assinado.
5. Validar rotina de rotação da chave histórica Evolution. Uma chave removida de arquivo não foi automaticamente revogada no provedor. Não testar credencial antiga nem revelar sua forma.
6. No Upstash QStash da **mesma** instalação/região, conferir quota, DLQ, worker assinado e agenda `chefebot-whatsapp-inbox-recovery-v1`. O código cria agenda ao receber primeiro job legítimo, mas isso NÃO substitui comprovar a recuperação periódica após sua criação. Uma única agenda de outbox não é prova de inbox.
7. Após leitura em DEV de `/api/dev/whatsapp/inbox-status`, confirmar `ingressGuardConfigured: true`, `configuration.ready`, filas sem inconsistências e operacionalidade sob teste isolado. A simples presença de `ingressGuardConfigured` não prova que a Evolution realmente enviou o header.
8. Liberar **somente** `WHATSAPP_INBOX_ROLLOUT=allowlist` para número técnico explicitamente autorizado via `WHATSAPP_INBOX_ALLOWED_PHONES`; confirmar evento ingressado/enfileirado/processado sem Pix/pedidos falsos, schedule criado, recuperação e ausência de duplicidade; observar em janelas reais antes de seleção de clientes.
9. Aprovação humana antes de incluir clientes reais ou modo `all`. Documentar sinais objetivos e estratégia de rollback; preservar jobs ambiguos, nunca reexecutar às cegas.

## Rollback seguro
- Se a Evolution parar de enviar o header e isso gerar 401, restaurar a configuração de autenticação coordenadamente (ou desligar a proteção somente mediante risco assumido) sem mexer em filas. Preferir reverter **somente o segmento de configuração** que quebrou a comunicação.
- Desativar primeiro a inbox (rollout off), preservar Redis/leases/quarentenas e investigar; não apagar mensagens ou fazer `FLUSHDB`.
- Não mudar o plano QStash ou gerar custos por suposição.

## Tests
- Testes puros do verificador de segredo e falha fechada.
- Integração HTTP local com Redis descartável cobre header válido, rejeição 401 sem header e worker fora do webhook público.
- A suíte existente da inbox cobre carga 50/100/200 sem atingir Evolution, Pix nem Redis de produção.
