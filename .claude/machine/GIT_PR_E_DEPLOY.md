# Git, PR e Deploy

## Branch e worktree

- Nunca trabalhar diretamente na `main`.
- Toda tarefa começa a partir da `origin/main` atual, em branch ou
  worktree isolado, com nome descritivo do que está sendo feito.
- Preferir o patch mínimo necessário — evitar mudanças não relacionadas
  ao escopo da tarefa no mesmo commit/PR.

## Commits

- Commit exige autorização explícita do usuário para essa etapa
  especificamente — não basta autorização para a tarefa em geral.
- Commits devem ser reais, com mensagem clara sobre o que mudou e por quê.
- Não usar `--no-verify` para pular hooks de commit.
- Não fazer amend de commits já publicados sem necessidade explícita.

## Push

- Push exige autorização explícita do usuário para essa etapa
  especificamente. Autorização para commit **não** autoriza push.

## Pull Requests

- Abrir ou alterar PR exige autorização explícita do usuário para essa
  etapa especificamente. Autorização para commit ou push **não** autoriza
  abrir ou alterar PR.
- Preparar o PR com descrição objetiva: o que mudou, por que, como foi
  testado, resultado comparado ao baseline.
- Verificar se existe template de PR no repositório e segui-lo quando
  existir.
- Não abrir PR substituindo o escopo combinado sem sinalizar a mudança.

## Merge e Deploy

- Merge exige aprovação explícita do usuário, própria e específica para o
  merge — não decorre de autorização de commit, push ou PR.
- Deploy exige aprovação explícita do usuário, própria e específica para
  o deploy — não decorre de aprovação de merge.
- Não fazer force push.
- Não desativar branch protection.
- Não ignorar checks vermelhos reais — se um check falhar, isso deve ser
  investigado e classificado (nova falha, preexistente ou infraestrutura)
  antes de qualquer tentativa de contornar.
- Deploy em produção só ocorre depois de: testes reais, Preview validado,
  aprovação explícita do usuário e merge autorizado.
- Após deploy, executar health check e reportar o resultado real.

## Regra de autorizações independentes

Nenhuma autorização de uma etapa vale automaticamente para outra.
Commit, push, PR, merge e deploy são cinco autorizações distintas — cada
uma deve ser concedida explicitamente pelo usuário, para aquela etapa,
naquele momento.

## Branches

- Não apagar branches sem autorização explícita do usuário.

## PRs conhecidos (ver `CHEFEBOT_CONTEXTO.md` para detalhes e manter
`MEMORIA_OPERACIONAL.md` atualizado conforme o estado evolui)

- PR #256 deve ser fechado sem merge (já autorizado).
- PR #281: a auditoria recomendou substituir o PR #281 por PRs menores.
  Essa recomendação ainda depende de aprovação explícita do usuário.
