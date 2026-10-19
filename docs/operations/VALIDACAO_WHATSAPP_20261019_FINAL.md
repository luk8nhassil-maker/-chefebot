# Validação operacional WhatsApp — 19/10/2026

**Resultado: BLOQUEADO para conclusão operacional e publicação em produção.**
As correções abaixo estão implementadas e testadas localmente. Não houve
WhatsApp real, Preview, deploy, alteração de serviços ou dados de produção.

## A. Trabalho e evidências reaproveitados

- `main` remota conferida: `c986690a7022cab5078019c7e2e03b04d5a41fe5`.
  Incorpora #503 (normalização do canário), #504 (ausência de evidência versus
  falha de leitura) e #505 (exportação autenticada somente leitura).
- #502 continua separado da main. HEAD consultado:
  `90326c4f84d57668bfb90121b7df1234d5841e42`. A descrição pública que diz que
  os testes integrados não rodaram está desatualizada: o workflow de integração
  https://github.com/luk8nhassil-maker/-chefebot/actions/runs/39179680498
  apresenta Success nesse HEAD. Os logs desse run exigem login.
- Evidência anterior local: outbox/canário/monitor com Redis 6.2.14 e SRH
  0.0.10, 3/3 testes aprovados. Reutilizada porque os serviços de saída
  correspondentes foram preservados; a capacidade da Evolution não foi medida.
- Consultados AGENTS.md, DEPLOYMENT.md, documentos de capacidade, monitor,
  auditoria #504 e rotação de credenciais. Os seis documentos PROGRAMACAO,
  MAPA_DE_FONTES, ORQUESTRADOR, PROCESSO_OBRIGATORIO, AUDITORIA_DE_CODIGO e
  os CHEFEBOT_*.md solicitados não existem nas árvores consultadas.

## B. Defeitos reproduzidos e corrigidos no #502

1. **Concorrência apenas local:** duas execuções de worker chegaram a oito
   tarefas simultâneas. CLAIM agora limita atomicamente os leases Redis a
   quatro entre todas as instâncias. O teste reproduziu oito antes e quatro
   depois. O número quatro é a configuração existente da inbox, não um limite
   oficial da Evolution.
2. **Janela fixa de 250 conversas:** 250 cabeças ambíguas escondiam uma
   conversa apta. A seleção percorre o índice existente, limitado pelo enqueue
   a 1.000 jobs, sem ultrapassar a cabeça de nenhuma conversa.
3. **Lease órfão apagado sem evidência:** registro ausente ou corrompido
   perdia sua referência no ZSET de leases. A recuperação agora registra o ID
   no índice durável `whatsapp:inbox:v1:unresolved` antes de retirar o lease.
   Falha do Redis nessa gravação preserva o lease. JSON escalar também é
   tratado como inconsistência. Nenhum desses jobs é reenviado nem a cabeça
   da conversa é pulada. O endpoint DEV mostra contagem e alerta.
4. **Teste de quarentena instável:** a ordem de abertura de sockets HTTP não
   garante a ordem de aceite Redis. O teste estabelece a primeira cabeça
   antes de lançar as mensagens concorrentes. Não se alterou a regra de ordem
   da fila nem se relaxou a expectativa de quarentena.

Correção funcional: commit `6b29363`, seguido de integração LOCAL da main em
`251c5a9`. A integração preservou integralmente os serviços de #503–#505;
houve somente conflito de mocks equivalentes no teste da API do canário,
resolvido conservando a versão da main. Não houve merge na main remota.

## C. Validações e limites

- Antes das correções: quatro testes integrados falharam demonstrando os três
  defeitos (dois casos de lease). Depois: **18/18 integrados aprovados**,
  inclusive JSON escalar, erro Redis no índice e conclusão tardia de lease.
- Redis 6.2.14 + SRH 0.0.10 em rede Docker interna sem acesso externo.
  SDK Redis, Lua, sockets HTTP e handler Next reais. Publicação QStash e
  efeitos comerciais simulados. O worker usa o Receiver oficial QStash e
  JWT HMAC local; não houve despacho pelo serviço QStash real.
- Resultado final após integrar a main:

| Entradas simultâneas | Aceitas/processadas únicas | Duplicadas | p95 aceite HTTP | Drenagem | Pico de tarefas |
| --- | --- | --- | --- | --- | --- |
| 50 | 50/50 | 0 | 194 ms | 96 ms | 4 |
| 100 | 100/100 | 0 | 259 ms | 172 ms | 4 |
| 200 | 200/200 | 0 | 404 ms | 319 ms | 4 |

Em cada patamar: fila final zero, nenhuma ambiguidade e um despertar QStash
simulado por rajada. Além disso: 20 mensagens da mesma conversa serializadas;
20 reentregas do mesmo evento produziram um único efeito comercial simulado;
100 eventos foram concluídos em dois callbacks assinados; conversa em
quarentena não impediu a conversa independente.

Esses números medem handler/HTTP/Lua/Redis local. Não são capacidade da
Evolution, da Meta, da Vercel ou do Upstash contratado. O servidor HTTP de
carga envolve o handler Next; não é um deployment Next na Vercel. Os efeitos
de pedido/Pix nesse ensaio são simulados, não um checkout comercial completo.
O Redis descartável não mede persistência/replicação do plano de produção.

- Suíte completa da branch #502 + correção: **6.687 aprovados, 24 ignorados**,
  453 arquivos aprovados, três ignorados. Os ignorados incluem integrações
  opt-in; a integração de pico foi executada separadamente acima.
- Depois da integração da main: **130 aprovados, um ignorado** nos oito
  arquivos afetados (canário, seleção de saída, monitor, exportação, inbox e
  mutex). Serviços de pedidos, Pix, catálogo, estoque e fidelidade não mudaram
  na integração. Não foi repetida a suíte inteira sem necessidade.
- Verificação separada da main #505: **26/26** testes de monitor/gates/export.
- TypeScript canônico `next typegen` + `tsc --noEmit --incremental false`:
  aprovado. Lint dos quatro arquivos alterados: aprovado. Um `any` legado
  no simulador tocado foi substituído pelo tipo de job existente.
- Build local tentado: **não aprovado**, download das fontes Archivo e Geist
  Mono indisponível no ambiente isolado. A mesma dependência de Google Fonts
  já bloqueava o build registrado na auditoria #504. Layout/fontes não foram
  alterados e não se desativou o verificador para declarar build aprovado.

## D. Produção e publicação

- Branch de revisão: `fix/whatsapp-inbox-operational-audit-20261019`.
- A main local original e a branch local anterior foram preservadas em seus
  worktrees. A main remota não foi alterada.
- API GitHub autenticada (`gh api`) retornou Forbidden também na tentativa
  autorizada fora do sandbox. Páginas públicas e Git HTTPS de leitura funcionam.
- Vercel `chefe-da-pizza/chefebot-contingencia` e domínio
  `https://chefedapizza.com.br` retornaram CONNECT 403 deste ambiente, inclusive
  fora do sandbox. Não é resposta do health check da aplicação; o pedido não
  chegou ao destino. READY, alias e SHA do deployment não foram reconfirmados.
- Não houve acesso a credenciais DEV, Redis, Evolution ou QStash de produção.
  Nenhum valor histórico exposto foi usado como alternativa de autenticação.

## E. Funcionamento real e fila

O teste histórico CBTEST-ELS8 não é nova prova após #503. O código agora
correlaciona `outboundOutboxJobId`, finalização Lua e contador
`whatsapp:outbox:monitor:metrics.delivered`, mas os valores produtivos atuais
não foram lidos nesta execução. HTTP 2xx e estado outbox `delivered` significam
aceitação pela Evolution; não são recibo de entrega ao aparelho. A resposta
do número autorizado comprova o trecho de retorno, não a entrega do ACK final.

O canário diagnóstico é interceptado fora do fluxo comercial da inbox #502;
seu roundtrip, sozinho, não pode aprovar inbox, criação de pedido ou Pix.

Outbox usa o schedule estável `chefebot-whatsapp-outbox-recovery-v1` e a inbox
usa `chefebot-whatsapp-inbox-recovery-v1`, ambos `*/5 * * * *`. Publicações
imediatas despertam os workers, callbacks exigem assinatura e a URL canônica.
Somente a existência do código e os testes foram confirmados. Existência,
estado, quotas e últimos despachos das agendas reais exigem leitura oficial
autenticada. Quando ativas, são 288 ativações previstas/dia POR AGENDA, além
dos despertares imediatos, não 288 para ambas somadas.

## F. Segurança e integração Jornada

- Nenhum pedido/Pix, impressão, estoque, fidelidade, rollout ou job de cliente
  foi alterado. Nenhuma quarentena real foi reexecutada. Não se mudou bot_ativo.
- Monitor e inbox-status permanecem DEV; exportação #505 usa segredo dedicado,
  comparação constante, no-store e allowlist sem telefones/textos/job IDs.
- A Jornada já tem consumidor servidor, URL fixa, timeout, autenticação,
  armazenamento e cron diário. Não é apenas um endpoint no ChefeBot.
  São necessários `CHEFEBOT_JORNADA_MONITOR_TOKEN` no ChefeBot e
  `JORNADA_CHEFEBOT_MONITOR_TOKEN` correspondente na Jornada, além das
  configurações locais de cron/armazenamento. Não foram lidas nem alteradas.
  Código presente não comprova coleta produtiva; cron diário também não
  constitui monitor em tempo real.
- Autenticidade do callback QStash foi testada. O handler público Evolution
  consultado não contém verificação própria de assinatura/segredo de ingresso;
  proteções externas e configuração do provedor não puderam ser inspecionadas.
  Não se declara esse requisito comprovado nem se impõe configuração nova que
  possa cortar as mensagens de clientes sem acesso operacional coordenado.
- Credencial Evolution histórica continua comprometida até comprovação de
  invalidação no provedor; a remoção do arquivo não invalida a chave. Não se
  testou a chave antiga. Usar o runbook de rotação já existente.

## G. Bloqueios efetivos

Faltam acesso à produção/Vercel e credenciais técnicas autorizadas para ler
filas, agenda QStash, integração Jornada, configuração de ingresso e canário.
Não há ferramenta de navegador autenticado nesta sessão. Sem essas leituras
não é seguro iniciar teste real, afirmar saúde/entrega, atualizar evidência
operacional ou aprovar publicação. A API GitHub autenticada também está
indisponível para abrir PR, conferir proteções/checks e realizar merge normal.
O build normal ainda depende da disponibilidade das fontes externas.

**Etapa 1 não aprovada operacionalmente. Etapas 2–4 permanecem bloqueadas**
pelos critérios existentes; nenhum gate foi forçado. Não se ampliou rollout.

## H. Continuidade e rollback

Disponibilizar nesta tarefa o navegador autenticado da Vercel no projeto
`chefe-da-pizza/chefebot-contingencia` é a próxima ação do proprietário para
retomar as verificações produtivas sem compartilhar segredos no chat.

Depois do acesso: somente leitura do deployment/rollouts/filas e agendas;
verificar número técnico configurado, ausência de duplicação e autorização;
um único canário autorizado; correlacionar job, contador e retorno do webhook;
conferir recibo do provedor se disponível. Não ampliar o modo canary para all.
Revisar e publicar somente SHA validado com CI/proteções normais e build
aprovado; conferir alias, READY e health do domínio. Não há autorização para
apagar jobs ou ampliar rollout automaticamente.

Rollback: manter deployment anterior identificado oficialmente, preservar
todos os dados Redis/quarentenas, verificar pendências antes de mudar código.
Se remover um worker num rollback autorizado, pausar primeiro sua agenda
QStash correspondente, para não chamar uma rota ausente a cada cinco minutos.
Sem FLUSHDB em produção e sem replay de efeitos incertos.
