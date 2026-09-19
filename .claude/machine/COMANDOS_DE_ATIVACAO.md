# Comandos de Ativação

## Divisão de responsabilidades

### ChatGPT (estrategista e auditor)
- Propõe estratégia e prioridades.
- Conduz auditoria de negócio e de escopo.
- Revisa o escopo de cada tarefa e o plano proposto antes da execução.
- Audita as evidências técnicas devolvidas pelo Claude Code.
- Recomenda o próximo passo.

### Claude Code (executor técnico)
- Checkout de branch e criação de worktree isolado.
- Implementação do patch mínimo necessário (trabalho técnico autorizado).
- Execução de testes reais.
- Execução de lint real.
- Execução de typecheck real.
- Execução de build real.
- Criação de commits, quando autorizado especificamente para essa etapa.
- Preparação de PR (descrição, evidências, comparação com baseline),
  abertura ou alteração quando autorizado especificamente para essa
  etapa.
- Correções técnicas previamente autorizadas.

### Aprovação

Somente o usuário aprova o plano final, commit, push, PR, merge e
deploy. Nem ChatGPT nem Claude Code substituem a aprovação explícita do
usuário — recomendação de ChatGPT e execução de Claude Code não
equivalem, por si só, a autorização do usuário. Claude Code não decide
escopo de negócio e não aprova merge, push, PR ou deploy sozinho.

## Como acionar a máquina

Ao receber uma tarefa técnica no ChefeBot, o Claude Code deve, nesta
ordem:

1. Ler `CLAUDE.md` → `AGENTS.md` → `.claude/machine/MASTER.md` (e todos os
   módulos importados por ele).
2. Seguir `PROCESSO_OBRIGATORIO.md` para identificar objetivo e impacto.
3. Seguir `AUDITORIA_E_PLANEJAMENTO.md` antes de propor qualquer plano.
4. Executar conforme `SEGURANCA_E_AMBIENTES.md` e `GIT_PR_E_DEPLOY.md`.
5. Validar conforme `TESTES_E_VALIDACAO.md`.
6. Consultar e atualizar `CHEFEBOT_CONTEXTO.md` e `MEMORIA_OPERACIONAL.md`
   conforme o estado evolui.
7. Devolver evidências técnicas reais: comandos executados, códigos de
   saída, resultado de testes, falhas encontradas (classificadas), commits
   criados e arquivos alterados.

## Regra de ouro

Se qualquer instrução de uma tarefa entrar em conflito com as regras de
segurança desta máquina (main protegida, sem commit sem autorização, sem
force push, sem `--no-verify`, sem exposição de segredos, sem escrita real
em Preview), a regra de segurança prevalece e o conflito deve ser
reportado ao usuário antes de prosseguir.
