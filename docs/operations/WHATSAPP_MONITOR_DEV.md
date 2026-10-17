# Centro DEV de Monitoramento da Fila WhatsApp

**Escopo:** observabilidade e suporte a decisão. Não habilita a outbox nem altera rollout, env, pedidos, Pix, estoque, fidelidade ou envio.

**Base auditada:** `main` `40edec741b391f8bcd3f7d57df3b02d7cafeb31d`. O PR #493 já entrou na main, apesar de descrever gates anteriormente pendentes; isso **não prova disponibilidade operacional**. O painel não compensa pendências de QStash/Evolution nem as aprova automaticamente.

## Rotas e permissões
- UI exclusiva a desenvolvedor: `/dev/whatsapp/monitoramento`.
- API só leitura: `GET /api/dev/whatsapp/monitoramento`.
- JWT assinado, role `dev`, verificado no servidor em ambos os caminhos. Nega `admin`, `atendente` e visitantes.
- Link somente na home `/dev`, não no painel administrativo.
- Diagnóstico e canário existentes permanecem separados em `/dev/whatsapp`. O Centro **não** tem POST, não envia testes, não faz retry.

## Fonte real dos números e limites
- Backlog: ZSETs atuais `whatsapp:outbox:due:critica`, `normal`, `promocional`, `leases`, `reconciliation` e `unresolved`.
- Contadores acumulados a partir da instrumentação: hash `whatsapp:outbox:monitor:metrics`, atualizado em melhor esforço por `redis.pcall` **dentro dos scripts Lua já existentes**, sem chamada REST adicional por mensagem. Chave não armazena telefone ou texto. Falha de métrica não falha a operação.
- `queued`: novo job salvo na outbox (deduplicação não soma duas vezes).
- `delivered`: **somente confirmação HTTP da Evolution**, não confirmação de entrega ao aparelho. UI usa 'Aceitas pela Evolution'.
- `failed`: terminação definitiva. `ambiguous`: timeout/rede/5xx ou lease vencido, **sem reenvio automático**.
- `recovered`: lease vencido movido para quarentena de revisão. **Não** significa mensagem entregue nem reenvio bem-sucedido.
- Histórico: até 100 referências a incidentes, sem PII; a UI exibe até 15 registros não expirados (jobs mantidos 7 dias). Sem backfill. Logs anteriores não são marcados falsamente como zero falhas.
- Espera: estimativa para o job mais antigo entre as primeiras posições de cada prioridade, não p95 de todas as mensagens.
- Canário: `outboundOutboxJobId` adiciona vínculo de auditoria entre teste já autorizado e job da fila. O gate só considera prova de outbox quando o próprio job foi aceito (`delivered`).
- Saúde Redis: consulta de leitura, sem escrita. Saúde Evolution: consulta limitada de `connectionState`, sem envio. Saúde QStash: apenas configuração + horário de último callback validado concluído; a agenda periódica em si permanece **não verificada** sem inspeção oficial.
- Consumo real/quota/faturamento: **não disponível**; sem preços inventados. Em caso de schedule ativo a cada 5 minutos, há 288 ativações previstas por 24h, **fora** os despertares imediatos.

## Etapas e trava humana
1. **Canário:** Evolution conectada, Redis respondendo, QStash configurado, roundtrip e HTTP 2xx do canário, mais job correlacionado da outbox confirmado. Solicitar validação humana.
2. **Recuperação:** ao menos um lease vencido comprovado e convertido para quarentena, nenhuma ambiguidade/inconsistência restante, worker assinado visto recentemente. **Ainda bloqueado:** não há comprovação automática da agenda recorrente de 5 minutos nem fluxo de conciliação humana completo.
3. **Gradual:** bloqueado até existir rollout parcial controlado, janela histórica de estabilidade e aprovação. Hoje os modos existentes são `off`, `canary` e `all`; não fingir percentual gradual.
4. **Geral:** bloqueado até aprovação humana explícita, gastos e quotas oficiais revisados e gates anteriores cumpridos.

A etapa apresentada é `WHATSAPP_MONITOR_STAGE`, número inteiro 1..4; sem configuração, assume 1. A variável **não** ativa mensagens nem constitui registro de aprovação. Nenhuma função altera essa variável.

## Atualização e despesas
- Ao abrir, realiza uma leitura.
- Atualiza automaticamente a cada **120 segundos somente com a página visível**.
- Há atualização manual. Não consulta API de cobrança, não cria agenda QStash, não cria serviço novo, não chama Evolution sendText nem acessa dados pessoais do job na resposta.
- A instrumentação adiciona trabalho Redis marginal por mensagem (HINCRBY e índice de até 100 incidentes), sem novos comandos REST por job, e um HSET de melhor esforço por callback concluído. Monitorar uso real antes de liberar `all`.

## Validação exigida antes do Preview/merge
1. Em ambiente local com dependências instaladas, registrar baseline da main; rodar `npx vitest run src/lib/whatsappMonitorGates.test.ts src/lib/whatsappMonitoramento.test.ts src/app/api/dev/whatsapp/monitoramento/route.test.ts src/lib/whatsappOutbox.test.ts src/lib/whatsappOutbox.qstash.test.ts src/app/api/interno/whatsapp-outbox/processar/route.test.ts src/lib/whatsappCanary.test.ts` (ajustar apenas se arquivo de teste não existir).
2. Rodar suite completa `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`. Comparar falhas com baseline da main; nenhuma falha nova pode ser ignorada.
3. Confirmar anon 401, admin 403, dev 200 na API. Página direta admin bloqueada, link somente DEV. Conferir dados vazios/nulos (mostrar 'sem prova'), Redis indisponível, timeout Evolution, QStash ausente, contadores e histórico sem telefone/conteúdo.
4. Simular via mocks: enfileiramento/dedupe, sucesso Evolution, timeout ambíguo sem duplicidade, lease vencido para quarentena, callback QStash assinado, falha do HINCRBY de métricas sem afetar job.
5. Preview **somente se isolamento efetivo de dados e integrações estiver demonstrado**. Do contrário usar testes locais e inspeção, registrando explicitamente ausência de Preview.
6. Não mudar `WHATSAPP_OUTBOX_ROLLOUT`, não executar canário real sem aprovação sobre o número de teste, não disparar mensagens para clientes.

## Rollback
Patch reversível por revert do commit da branch, preservando todos os jobs Redis. A remoção da telemetria não remove mensagens, alterações de pedidos nem dados anteriores. **Não** apagar os jobs nem desinstalar o worker com mensagens pendentes/ambíguas; verificar o estado antes de reverter uma implantação futura. Em rollback de outbox, observar o agendamento QStash persistente descrito em `docs/architecture/CAPACIDADE_WHATSAPP_20261014.md`.

## Pendências assumidas
- Verificação da agenda recorrente via API oficial do QStash.
- Conciliação comprovada de mensagens ambíguas e recuperação operacional completa.
- Registro de aprovação humana com carimbo, commit e janela de medição (sem aprovação automática).
- Implementação da fase gradual parcial sem saltar de canário para todos.
- Correlação de recibos reais de entrega ao aparelho, se Evolution/webhook disponibilizar evidência.
- Integração read-only com os provedores para uso/quota/custos reais; sem preços pressupostos.

**Status de release:** branch para revisão; main/produção ficam intactas até autorização explícita e testes completos.
