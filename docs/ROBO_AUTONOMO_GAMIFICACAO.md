# Robô autônomo de gamificação e vendas

## Objetivo

O robô lê o histórico real, identifica a situação da loja e escolhe a próxima
ação sem exigir preenchimento diário. Ele também pode decidir **não agir**:
quando faltar dado, margem, limite ou segurança, a resposta correta é esperar.

## Como a decisão é organizada

1. **Dados confiáveis** — confirma cobertura mínima do histórico e compara o
   período atual com uma referência anterior.
2. **Leitura da demanda** — verifica volume, ticket e recorrência antes de
   chamar uma semana de baixa.
3. **Proteção do dinheiro** — só libera ação com margem, orçamento e custo
   conhecidos. Sem isso, nenhuma promoção paga é ativada.
4. **Proteção da operação** — a capacidade da cozinha/entrega precisa ser
   conhecida; perto do limite, o robô não aumenta a demanda.
5. **Ação correta** — escolhe uma única missão coerente com os sinais. Não
   liga todas as missões ao mesmo tempo.
6. **Controle e rastreio** — lock, decisão, motivo, limite e gasto ficam
   registrados para impedir repetição e permitir auditoria.

O progresso é calculado no servidor em `rankingAutopilotControle.ts`. A tela
deve apenas apresentar as fases; ela não pode criar uma regra diferente.

Quando todas as fases passam, `rankingAutopilotControle.ts` cria um comando
diário. `rankingAutopilotExecucao.server.ts` aplica somente a missão escolhida,
com os valores seguros do robô, usando uma marca idempotente no Redis. Se o
cenário deixar de justificar a ação, ele reverte apenas os campos que ele
mesmo alterou; uma configuração manual nunca é sobrescrita.

## Regras de segurança

- Sem dados suficientes: observar.
- Sem margem, orçamento ou custo: não gastar.
- Com operação próxima da capacidade: não estimular pedidos.
- Com pausa de emergência: nenhuma ação.
- Uma execução por vez e uma ação por ciclo.
- Toda ação precisa de motivo e valor máximo antes de ser executada.
- O estado salvo é curto e tem TTL; não existe gravação de um evento por
  pedido para não aumentar o custo do banco.

## O que é automático e o que não é

O operador não precisa escolher missão, preencher Top 10 ou alterar bônus todo
dia. O robô calcula a fase e a ação. O sistema ainda preserva uma pausa de
emergência e a proteção financeira: isso não é uma tarefa diária, é um freio
para evitar prejuízo.

O Top 10 automático só pode ser liberado quando a temporada anterior tiver um
snapshot completo. Enquanto houver buraco ou dado incompleto, o carryover fica
bloqueado.

## Barra horizontal de progresso

A tela do Ranking mostra as fases automaticamente, na horizontal: Participar,
1º pedido, Top 10 e Pódio. Cada fase só fica concluída quando o servidor tem o
dado que prova o passo. O cliente não preenche nada e a barra não cria bônus;
ela apenas explica o estado real da temporada.

## Regra permanente de publicação em lote

Antes de publicar qualquer melhoria, revisar todas as mudanças pendentes e
juntar o que estiver pronto em um único lançamento coerente. Não fazer deploy
de produto, tela ou ajuste isolado quando houver outras partes relacionadas
aguardando; isso reduz gasto de build/preview e evita versões pela metade.

## Estado atual desta arquitetura

O motor de decisão, a trilha de progresso e o executor já estão separados do
painel e são testáveis sem usar produção. A rotina diária só executa quando os
portões de economia e capacidade estiverem completos; caso contrário, grava a
decisão em observação. Nenhum deploy é feito por esta alteração.
