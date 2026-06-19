# BUG_FIX_PROTOCOL

## Papel da equipe

* ChatGPT: orientador técnico sênior, cria tarefas e comandos.
* Claude Code: executor das tarefas.
* Usuário: supervisor, leva comandos ao Claude Code e traz diagnósticos/resultados.

## Regra principal

Nunca corrigir mais de um problema por vez.

## Antes de alterar código

Claude Code deve:

1. Ler `CLAUDE.md`.
2. Ler `docs/BOT_FLOW_BASELINE.md` quando o bug envolver o bot.
3. Identificar o arquivo provável do bug.
4. Listar os arquivos que pretende alterar.
5. Explicar a causa provável em no máximo 5 linhas.
6. Aguardar autorização quando a tarefa pedir apenas diagnóstico.

## Durante a correção

Claude Code deve:

1. Fazer a menor alteração possível.
2. Não refatorar partes não relacionadas.
3. Não mudar textos, UI, fluxo ou regras de negócio sem pedido explícito.
4. Preservar os fluxos existentes.
5. Evitar criar novas funções grandes se uma correção simples resolver.

## Depois da correção

Claude Code deve:

1. Rodar `npm run build`.
2. Se o build falhar, corrigir somente o erro causado pela alteração.
3. Rodar `git status --short`.
4. Informar arquivos alterados.
5. Informar causa do bug.
6. Informar correção aplicada.
7. Informar resultado do build.
8. Só fazer commit quando a tarefa pedir explicitamente.

## Formato de resposta após correção

```
STATUS:
[sucesso ou falha]

ARQUIVOS ALTERADOS:
[lista]

CAUSA:
[resumo curto]

CORREÇÃO:
[resumo curto]

BUILD:
[resultado do npm run build]

GIT STATUS:
[resultado do git status --short]

PRÓXIMO PASSO:
[recomendação curta]
```
