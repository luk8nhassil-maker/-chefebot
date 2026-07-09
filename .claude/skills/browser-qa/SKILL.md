---
name: browser-qa
description: Validação obrigatória no navegador (não só build/typecheck) para qualquer tarefa de UI/UX, responsividade, layout ou experiência do usuário neste projeto. Use depois de qualquer patch visual, antes de considerar a tarefa concluída.
---

# Browser QA — validação visual obrigatória

Para qualquer tarefa que toque UI/UX, responsividade, layout ou experiência do usuário no ChefeBot, o build passando **não é suficiente** para considerar a tarefa concluída. É obrigatório validar no navegador de verdade, seguindo este fluxo, antes de reportar sucesso.

## Fluxo obrigatório

1. **Build** — `npm run build` (ou equivalente) sem erros.
2. **Abrir a aplicação no navegador** — usar as ferramentas de preview do projeto (`preview_start`, `preview_eval`, `preview_snapshot`, `preview_screenshot`, `preview_resize`), não assumir visualmente sem checar.
3. **Login** — quando a tela exigir autenticação, fazer login usando acesso fornecido pelo usuário ou sessão já existente. **Nunca tentar extrair credenciais de `.env*` ou adivinhar senhas** — se não houver acesso disponível, parar e pedir ao usuário antes de prosseguir com o restante do fluxo.
4. **Navegar pela tela alterada** até o estado relevante para a mudança feita.
5. **Validar desktop** (≥1024px).
6. **Validar tablet** (768–1023px).
7. **Validar mobile** (<768px).
8. **Validar breakpoints** — especificamente as transições entre as faixas acima (não só o meio de cada faixa).
9. **Procurar problemas de**:
   - alinhamento
   - overflow (horizontal principalmente)
   - scroll indevido/duplicado
   - z-index (sobreposição de elementos fixos/sticky)
   - responsividade (grid quebrando, texto cortado)
   - contraste
   - espaçamento
   - consistência visual entre telas (ver [[admin-ui]] quando for painel administrativo)
   - acessibilidade básica (foco, labels, tamanho de alvo de toque)
10. **Capturar screenshots** dos estados importantes (`preview_screenshot`), e usar `preview_inspect` para conferir estilos computados quando a dúvida for sobre cor/tamanho/espaçamento exatos, não só aparência.
11. **Comparar com o artefato visual aprovado** (quando existir um, gerado no fluxo de UI/UX antes da implementação).
12. Só então considerar a tarefa concluída.

## Relatório obrigatório ao final

Sempre entregar:
- Prints (ou artefato visual atualizado).
- Problemas encontrados, um por um.
- Severidade de cada problema (bloqueante / importante / cosmético).
- Sugestões de correção.
- Veredito explícito: aprovado para PR, ou precisa de correção antes.

## Quando não for possível concluir o fluxo

Se faltar acesso (credenciais, ambiente, dado necessário), **não improvisar contornando autenticação ou lendo segredos** — parar nesse ponto, reportar exatamente o que foi validado e o que ficou pendente, e perguntar ao usuário como prosseguir.

**Por quê:** regra permanente definida pelo usuário (2026-07-08) para este projeto, depois de uma validação de `/admin` que só tinha build/diff mas não tinha passado por checagem visual real no navegador. Ver [[feedback_ui_ux_workflow]] para o fluxo de aprovação de artefato que vem *antes* da implementação — esta Skill cobre a validação que vem *depois*.
