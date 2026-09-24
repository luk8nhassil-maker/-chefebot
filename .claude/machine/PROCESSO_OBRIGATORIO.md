# Processo Obrigatório

Ordem que toda tarefa técnica no ChefeBot deve seguir.

## 1. Antes de programar

- Identificar o projeto, o objetivo real da tarefa e o impacto esperado
  (o que muda, para quem, e o que pode quebrar).
- Consultar `CLAUDE.md`, `AGENTS.md` e os arquivos específicos desta máquina
  (`.claude/machine/*.md`) antes de qualquer ação.
- Não iniciar implementação sem entender o escopo real da solicitação.

## 2. Investigar antes de perguntar

- Investigar o código, os testes, os dados e as integrações antes de fazer
  qualquer pergunta que possa ser respondida tecnicamente.
- Fazer perguntas simples e diretas apenas quando faltar uma **decisão
  comercial** (preço, regra de negócio, prioridade) que não pode ser
  descoberta lendo o repositório.
- Nunca inventar produtos, preços, sabores, categorias, regras comerciais
  ou resultados. Se a informação não existe no repositório, isso é uma
  lacuna a ser reportada, não preenchida por suposição.

## 3. Separar fatos de hipóteses

- Ao reportar qualquer análise, separar claramente:
  - **Fatos**: confirmados por leitura de código, execução de comando ou
    evidência técnica real.
  - **Hipóteses**: inferências plausíveis, mas não confirmadas.
  - **Informações faltantes**: o que não pôde ser determinado e precisa de
    decisão humana ou investigação adicional.

## 4. Execução

- Trabalhar sempre em branch ou worktree isolado — nunca diretamente na
  `main`.
- Preferir o patch mínimo necessário para atingir o objetivo.
- Não misturar correção de bug, refatoração, mudança de design e nova
  funcionalidade na mesma tarefa, salvo necessidade explícita.
- Não quebrar fluxos existentes. Se uma mudança tem potencial de quebrar
  algo em produção, isso deve ser explicitado antes de prosseguir.

## 5. Encerramento de tarefa

Uma tarefa só é considerada concluída depois de, nesta ordem:
1. Testes reais executados e resultado comparado ao baseline.
2. Deploy de Preview gerado e validado.
3. Aprovação explícita do usuário.
4. Merge autorizado.
5. Deploy em produção.
6. Health check pós-deploy.

Pular qualquer uma dessas etapas significa que a tarefa **não** está
concluída, mesmo que o código esteja pronto.
