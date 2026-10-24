## Objetivo e escopo
- Problema e resultado esperado:
- Fonte das regras:
- O que pode e não pode mudar:

## Evidência de qualidade
- Main e HEAD (SHAs):
- Diff revisado:
- Baseline x falhas novas:
- Testes executados (comando e resultado):
- Lint, typecheck e build (ou motivo de dispensa):
- Preview isolado ou dispensa explícita com evidência alternativa:
- Comprovação de que não houve efeitos reais nos testes:
- Plano de rollback:

## Antes do merge
- [ ] Gate local: node scripts/ci/release-gate.mjs premerge evidencia.json
- [ ] Todos os checks obrigatórios existentes passaram (não executado não é verde)
- [ ] HEAD atual é o HEAD validado, PR mergeável, sem bypass

## Depois do deploy
- [ ] Merge SHA é o commit publicado no chefebot-contingencia
- [ ] Deploy production READY, health check e não regressão confirmados

Guia: docs/PROCESSO_RELEASE_CHEFEBOT.md
