# ChefeBot

## Projeto

ChefeBot é uma IA de automação de WhatsApp para pizzarias e restaurantes.

## Stack

* Next.js
* TypeScript
* Tailwind
* Redis/Upstash
* Evolution API
* Vercel

## Regra principal

Nunca refatorar partes não relacionadas à tarefa solicitada.

## Fluxo principal do bot

O fluxo atual envolve:

1. Saudação
2. Nome do cliente
3. Categoria ou tamanho
4. Sabor
5. Meio a meio quando necessário
6. Borda
7. Bebida ou adicional
8. Finalização
9. Forma de recebimento: delivery, retirada ou consumo no local
10. Bairro e endereço quando for delivery
11. Pagamento
12. Confirmação do pedido

## Regras de execução

* Antes de alterar código, listar os arquivos que pretende modificar.
* Fazer sempre a menor alteração possível.
* Não alterar UI quando a tarefa for backend.
* Não alterar fluxo do bot quando a tarefa for apenas UI.
* Não mudar textos de atendimento sem pedido explícito.
* Não criar novas features durante correção de bug.
* Preservar os fluxos existentes de pizza, meio a meio, borda, bebida, delivery, retirada, consumo no local, pagamento e confirmação.
* Sempre rodar `npm run build` após alterações.
* Se o build falhar, corrigir somente o erro causado pela alteração.
* No final de cada tarefa, informar:

  * arquivos alterados
  * causa do problema
  * correção aplicada
  * resultado do `npm run build`

Mantenha este arquivo simples, objetivo e com menos de 200 linhas.
