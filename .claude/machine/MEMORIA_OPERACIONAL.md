# Memória Operacional

Este arquivo é o registro vivo do estado operacional do ChefeBot sob a
Máquina Executora. Deve ser atualizado conforme decisões são tomadas,
tarefas avançam e o baseline muda. `CHEFEBOT_CONTEXTO.md` guarda o estado
conhecido no momento da criação da Fase 1; este arquivo guarda o que
acontece depois.

## Regra de integridade das decisões

Decisões aprovadas registradas neste arquivo nunca podem ser apagadas ou
ter seu sentido reescrito. Uma decisão antiga só pode ser marcada como
**substituída** ou **revogada** — nunca removida ou alterada em seu
texto original — e deve vir acompanhada de: data, motivo da substituição
e a nova decisão vinculada.

## Decisões aprovadas

_(nenhuma decisão registrada ainda além da criação da Fase 1 da Máquina
Executora)_

## Tarefas em andamento

_(nenhuma tarefa em andamento registrada)_

## Baseline atual

- Ver baseline inicial em `CHEFEBOT_CONTEXTO.md` (SHA
  `168d6f519b1831e9fa79b0904267a2056569833c`).
- Nenhuma atualização de baseline registrada ainda.

## Riscos aceitos

- Foi identificado segredo exposto em configuração local. O usuário
  decidiu seguir sem rotação neste momento. Não copiar, exibir, mover ou
  reutilizar esse valor.

Além disso, ver riscos pendentes de auditoria em `CHEFEBOT_CONTEXTO.md`:
2 vulnerabilidades "high" reportadas pelo `npm audit`, ainda não
auditadas.

## Falhas preexistentes

- `saudacaoPadraoBotPausado.test.ts` (suíte de testes)
- 184 erros de typecheck preexistentes
- 192 erros e 66 warnings de lint (primeira medição, sem histórico
  anterior para comparação)

## PRs ativos

- PR #256 — aguardando fechamento sem merge (já autorizado).
- PR #281 — a auditoria recomendou substituir o PR #281 por PRs menores.
  Essa recomendação ainda depende de aprovação explícita do usuário.

## Mudanças validadas

_(nenhuma mudança validada registrada ainda)_

## Erros e aprendizados

_(nenhum erro ou aprendizado registrado ainda)_

## Próximo passo autorizado

- Fase 1 da Máquina Executora criada em branch isolada
  `claude/maquina-executora-v1`, ainda sem commit.
- Próximo passo depende de aprovação explícita do usuário (revisão do
  patch, commit, e eventual PR).
