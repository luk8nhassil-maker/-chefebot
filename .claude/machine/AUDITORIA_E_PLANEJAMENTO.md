# Auditoria e Planejamento

## Antes de propor ou executar qualquer mudança

Auditar, nesta ordem:

1. **Estado da `main`** — SHA atual, se está à frente ou atrás do baseline
   conhecido registrado em `CHEFEBOT_CONTEXTO.md`.
2. **Código relevante** — os arquivos e módulos que a tarefa realmente
   toca, não apenas os nomes que parecem óbvios.
3. **Testes existentes** — quais cobrem a área afetada, quais já falham
   antes de qualquer mudança (falhas preexistentes).
4. **Dados** — schema, seeds, migrações relevantes à tarefa.
5. **Integrações** — WhatsApp, Pix, impressão, estoque, fidelidade, Redis,
   banco — quais a tarefa toca, direta ou indiretamente.
6. **PRs abertos** — se existe trabalho em andamento ou conflitante com a
   tarefa proposta (ver estado conhecido em `CHEFEBOT_CONTEXTO.md` e
   `MEMORIA_OPERACIONAL.md`).

## Planejamento

- O plano deve nascer da auditoria, não da leitura superficial do pedido.
- Escopo deve ser o menor necessário para resolver o problema real.
- Se a auditoria revelar que o pedido depende de uma decisão comercial
  (preço, regra, prioridade) ainda não tomada, isso deve ser reportado
  como pergunta simples e objetiva — não como suposição.
- Se a auditoria revelar risco técnico (quebra de fluxo, dependência de
  Fase ainda não autorizada, PR conflitante), isso deve ser explicitado
  antes de qualquer implementação.

## Papel do ChatGPT vs Claude Code nesta etapa

- ChatGPT propõe estratégia, revisa escopo, audita evidências e recomenda
  o próximo passo.
- Claude Code executa o trabalho técnico autorizado: auditoria técnica
  real (ler código, rodar comandos, checar PRs), devolvendo fatos — não
  decide sozinho mudanças de escopo de negócio.
- Somente o usuário aprova o plano final, commit, push, PR, merge e
  deploy. ChatGPT e Claude Code não substituem a aprovação explícita do
  usuário — mesmo quando ambos concordam entre si, isso não equivale a
  autorização do usuário.
