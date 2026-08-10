# Contexto Conhecido do ChefeBot

Este arquivo registra o estado técnico conhecido do projeto no momento em
que a Fase 1 da Máquina Executora foi criada. Deve ser tratado como
baseline de referência — atualizações de estado (novo baseline, novas
falhas, PRs resolvidos) vão em `MEMORIA_OPERACIONAL.md`, não aqui.

## Identificação

- Repositório: `luk8nhassil-maker/-chefebot`
- Branch principal: `main`

## Baseline validado

- SHA: `168d6f519b1831e9fa79b0904267a2056569833c`
- Equivalência: 170/170
- Suíte de testes: 4005/4006
- Falha preexistente conhecida: `saudacaoPadraoBotPausado.test.ts`
- Typecheck: 184 erros preexistentes
- Build: aprovado
- Lint observado: 192 erros e 66 warnings — ainda sem baseline histórico
  anterior para comparação (primeira medição registrada)
- Vulnerabilidades reportadas pelo `npm audit`: 2 de severidade "high",
  ainda não auditadas em detalhe

## Estado da arquitetura

- A Fase 1 de catálogo e preços existe **em paralelo** ao sistema legado.
- Os fluxos operacionais em produção ainda **não usam diretamente** o
  novo motor de catálogo/preços.
- Fase 2A — estrutura em memória do catálogo oficial de pizzas:
  Tradicionais, Especiais, Doces, preços, aliases e testes completos,
  mantendo os fluxos antigos intactos e sem conectar ainda interface,
  servidor, Redis ou fluxos operacionais. A Fase 2A **ainda não está
  autorizada**. Nenhuma tarefa deve assumir ou antecipar trabalho de
  Fase 2A sem autorização explícita.

## PRs conhecidos

- PR #256: deve ser fechado sem merge (já autorizado).
- PR #281: a auditoria recomendou substituir o PR #281 por PRs menores.
  Essa recomendação ainda depende de aprovação explícita do usuário.

## Como usar este arquivo

- Antes de rodar testes/lint/typecheck/build, comparar o resultado obtido
  com os números acima (ou com o baseline mais recente registrado em
  `MEMORIA_OPERACIONAL.md`, se já tiver sido atualizado).
- Nunca tratar este arquivo como fonte de regras comerciais (preço,
  sabor, cardápio) — ele descreve apenas estado técnico.
