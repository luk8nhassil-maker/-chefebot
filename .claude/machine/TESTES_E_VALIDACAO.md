# Testes e Validação

## Regra central

**Nunca simular teste, lint, typecheck ou build.** Todo resultado
reportado deve vir de execução real no projeto, com comando, código de
saída e saída real anexados.

## Execução

- Executar os testes reais do projeto (suíte configurada, não um
  subconjunto arbitrário) para a área tocada pela tarefa.
- Executar lint e typecheck reais.
- Executar build real quando a tarefa afetar algo que participe do build.
- Se algo não puder ser executado (ambiente, dependência ausente, timeout,
  falta de credencial), isso deve ser informado claramente — nunca
  substituído por uma suposição de que "provavelmente passaria".

## Comparação com baseline

- Todo resultado de teste, lint, typecheck e build deve ser comparado ao
  baseline registrado em `CHEFEBOT_CONTEXTO.md` (e atualizado em
  `MEMORIA_OPERACIONAL.md` quando o baseline mudar).
- Classificar toda falha encontrada em uma destas três categorias:
  - **Nova** — não existia no baseline, introduzida pela mudança atual.
  - **Preexistente** — já existia no baseline antes da tarefa (ex.:
    `saudacaoPadraoBotPausado.test.ts`, os 184 erros de typecheck
    preexistentes).
  - **Infraestrutura** — falha por ambiente, rede, serviço externo
    indisponível, não relacionada ao código.
- Uma tarefa não pode ser reportada como concluída se introduziu falhas
  novas não resolvidas, mesmo que falhas preexistentes continuem
  presentes.

## Evidências obrigatórias

Ao reportar o resultado de uma tarefa, incluir:
- Comandos executados.
- Códigos de saída.
- Resumo real de testes (passou/falhou/pulado), não estimativa.
- Diffs e lista de arquivos alterados.
- Commits criados (quando aplicável).
- Qualquer falha nova, com stack trace ou mensagem de erro real.
