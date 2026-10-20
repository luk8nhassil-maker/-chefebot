# Ranking do Chefe 3 — operação e aprovação

Base de implementação: `main` em `1e13252a76c4cebdfe1097f80defd774cd930372`.
Contrato: especificação integral fornecida pelo proprietário em 20/10/2026.
Este documento não autoriza migração, envio geral, merge ou produção.

## Ativação protegida

O código vem **desligado**: `RANKING3_ENABLED` precisa ser exatamente `true`.
Também exige a configuração servidor `ranking3:default:config`, versão 3,
com `ancora` (data civil ISO) e `auditoriaHistoricaRef` verificável. Não há
endpoint público/GET de ativação ou migração, nem seed de produção.

Antes de configurar: obter, por leitura direta, lista/configuração/resultados
e direitos da primeira temporada. Não chamar GET que execute
`garantirResultadoTemporada`. Preservar IDs, snapshots, campeões, códigos e
resgates legados. A âncora inicial e qualquer aproveitamento histórico só
podem ser definidos depois dessa auditoria e aprovação. Não apontar a
âncora para um período antigo para “recalcular” ou conceder prêmio novamente.

## Calendário, ligas e score

- Cortes civis a cada 30 dias, às 03h `America/Sao_Paulo`, via Intl/IANA.
  Janelas semiabertas: um evento no corte pertence apenas ao novo ciclo.
- Liga 1 e Liga Top 10 têm classificações separadas. Os dez promovidos
  entram somente no ciclo seguinte. Meta: sexta pontuação decrescente.
  Na Liga 2, todos os elegíveis que alcançam a meta avançam ao Nível 3;
  os demais retornam ao Nível 1. Cada liga premia apenas seu campeão.
- Menos de dez elegíveis: encerra e concede prêmio ao campeão válido,
  preserva mérito em `pendentes`, sem inventar vagas ou limiar. A política
  de promoção reduzida depende de decisão comercial. Sem elegíveis, sem
  campeão. Nível 3 registra conquista; não inicia competição ou benefícios.
- Usa ledger de Estrelas + bônus válidos; gasto de carteira (`resgatado`)
  não reduz mérito V3. Estornos reais reduzem. Mantém o desempate do
  projetor da main: primeiro crédito positivo, depois ID estável.
  A projeção/carteira e os snapshots legados não são recalculados.
- Participação/elegibilidade são consultadas no corte pelo histórico já
  existente. Revogação posterior não muda resultado antigo; retirada de
  identidade pública não equivale a retirar um direito já adquirido.

## Persistência, concorrência e recuperação

Namespace novo `ranking3:<tenant>`, sem SCAN. Resultado, direitos, carteiras,
índice de prêmios/avisos e checkpoint são gravados na mesma Lua. O snapshot
guarda referência da auditoria, versão da fonte e SHA-256 do resultado.
Direitos e resultados não têm TTL.

Ledger/bônus registram participante e versão na própria escrita atômica
fenced existente. A apuração tem lease com token e CAS de fonte: worker com
lease perdido não pode publicar resultado nem apagar o dono novo. Tráfego
do ciclo seguinte não invalida a apuração anterior; eventos anteriores ao
corte continuam invalidando-a. Erro/queda retorna pendência explícita.

Execução automática preparada:

| Gatilho | Função |
| --- | --- |
| Novo cron diário `0 6 * * *` UTC | `/api/cron/ranking-temporadas`: fecha ciclos vencidos, até três por execução; recupera vínculos e confirmações de avisos. |
| Cron existente `0 21 * * *` UTC | `/api/cron/ranking-podio`: com V3 ativo, recupera mais um ciclo e processa avisos elegíveis às 18h local. |
| Outbox/QStash existentes | Executam mensagens aceitas e recuperam leases de transporte, com limites globais existentes. |

Não depende de visita ao site, novos pedidos ou WhatsApp geral ligado.
Os quatro cron legados e seus horários permanecem intactos. 06h UTC é
03h BRT nas regras vigentes; o calendário considera DST histórico. Se a
legislação de fuso mudar, revisar o horário UTC do scheduler: o corte civil
permanece fixo, sem estender a competição durante atraso de processamento.

## Prêmio e checkout

Uma pizza F, um ou dois sabores, cada sabor disponível e com preço F atual
no catálogo oficial até 4700/5000 centavos (Ligas 1/2). Não duplica tabela
comercial. Sem borda/adicional grátis. Nada é confiado ao navegador.

`/cliente/premios` exige sessão de cliente e abre o checkout existente.
Pedido só da pizza é válido, sem compra mínima ou cobrança Pix de zero.
Retirada é grátis; delivery cobra a taxa normal de bairro atendido; extras
são opcionais e precificados normalmente. Não acumula desconto de pontos
ou outro programa neste resgate. Sem edição de pedido premiado que possa
remover/duplicar a pizza; cancelamento legítimo restaura o mesmo direito.

Reserva atômica por direito vincula um único pedido/`clientRequestId`.
Retry reutiliza o attempt e seu snapshot financeiro/itens. Uma falha depois
da reserva não apaga a referência do carrinho nem libera o prêmio às cegas.
Vínculo sem pedido confirmado fica visível para reconciliação, sem presumir
que Pix ou persistência falharam. Preparo não é entrega. Cancelamento antes
da entrega restaura uma vez e reinicia 15 dias. Prova de entrega é persistida
no pedido, inclusive pelos caminhos do entregador e WhatsApp; correção
posterior para cancelado não devolve pizza entregue. Encerrar conversa não
marca pedido premiado como entregue.

A retenção antiga só remove pedido premiado terminal depois de reconciliar
o direito. Mantém pendência segura sem conservar PII indefinidamente por
padrão. O ledger permanente guarda apenas referências mínimas do prêmio.

## WhatsApp: rollout ainda restrito

Sem público geral. Para canário, são necessárias cumulativamente:

- ambiente Production e ID oficial da Vercel;
- V3 ativo, outbox pronta, `RANKING3_WHATSAPP_CANARY_ENABLED=true` e
  `RANKING3_PROACTIVE_POLICY_APPROVED=true`;
- destinatário igual a `WHATSAPP_CANARY_PHONE` pela normalização existente;
- consentimento proativo com evidência, em
  `ranking3:default:consentimento-proativo:<clienteId>`;
- participação, ausência de opt-out, bot não pausado e expediente configurado,
  a partir das 18h e antes do fechamento. Não há fechamento inventado.

Essas condições são revalidadas no worker, inclusive em tarefas já aceitas.
Copy inicial aprovada, nome sanitizado e deep link oficial autenticado, sem
segredos na URL. Sem ativação dessas condições nesta implementação.

Avisos têm dedupe durável, limite de um contato por pessoa/janela de 15 dias,
expiração técnica antes de transporte e índices separados para agenda,
reconciliação e revisão. Aceitar na outbox não significa enviar. Job
desaparecido, timeout, rede ou 5xx nunca causam reenvio automático. A
confirmação é reconciliada mesmo após checkout/cancelamento. Supressão
comprovada antes do transporte pode voltar ao próximo expediente; falha
definitiva/resultado incerto exige revisão. Nenhum registro sai do controle
antes de sua classificação ser persistida.

## Auditoria, custo e rollback

`/dev/ranking3` e sua API são somente leitura, exclusivos para DEV: ciclo,
checkpoint, decisões pendentes, prêmios por estado, vínculos e avisos para
reconciliação/revisão. Não expõem titulares, tokens ou textos de mensagens.

Não cria serviço, provedor, banco ou schedule QStash novo. Prepara **uma
invocação Vercel adicional/dia**, aproximadamente 30/mês, além de reutilizar
o cron de 18h. Com V3 desligado, só a verificação de gate do novo cron.
Com V3 ativo, o ledger adiciona indexação/versionamento dentro da mesma Lua;
apuração mensal é proporcional aos clientes indexados, em lotes de 20;
a tela reaproveita a projeção já existente, sem reler todos os ledgers, e
o carrinho consulta a carteira uma vez por montagem, não a cada polling do
catálogo. Avisos
consultam índice devidos, até 50 por execução com cursor rotativo. O índice
de prêmios cresce em até dois campeões por ciclo, sem prêmio do Nível 3.
Não se atribui preço monetário sem consumo/plano consultáveis. Nenhum
agendamento, contratação, deploy ou alteração financeira foi efetuado.

Rollback antes da ativação: o deployment anterior pode ser restaurado, pois
não há dados V3. Depois de criar direitos/pedidos V3, desligar a criação de
novos ciclos/envios mediante aprovação e **manter os consumidores compatíveis
de entrega/cancelamento/retenção desta versão**. Não voltar cegamente a um
binário antigo que desconhece esses pedidos; preparar hotfix compatível ou
roll-forward. Não apagar namespace, zerar contador ou recriar temporada.
Reativação usa a mesma âncora/checkpoint e reconcilia vínculos antes de envios.

## Validação e gates externos

Testes permanentes: calendário/DST, duas temporadas, 0/5/6/9/10 participantes,
empate, score/carteira, catálogo/estoque, adulteração, checkout/retirada/taxa/
extras, resgate concorrente, lease, Redis com falha/commit ambíguo, restauração,
prova de entrega, notificações/opt-out/pausa, Preview e recuperação do carrinho.
CI usa Redis/SRH descartáveis sem credenciais de produção.

Preview local de navegador: ligas 1–3, carteira, seleção F e checkout simulado
com falha após reserva, recuperação com mesmo ID, zero requisições externas.
`/dev/ranking3-preview` existe apenas em Preview e mantém a autenticação DEV.
Não libera botões de efeitos reais. Fontes foram substituídas somente no
harness offline, fora do código versionado. Build padrão permanece inalterado.

Não confundir Redis local/simulação com capacidade do Upstash/Evolution/Meta
ou confirmação de cron Vercel real. A auditoria operacional da primeira
temporada, Preview Vercel, CI remota, revisão/merge e deployment/health check
reais continuam gates obrigatórios. Falta acesso autenticado operacional
neste ambiente; não houve tentativa de contornar 403, proteções de Preview
ou permissões. Nenhuma migração ou premiação histórica foi executada.
