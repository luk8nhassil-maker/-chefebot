# BOT_TEST_CHECKLIST

## Objetivo

Esta checklist deve ser usada após mudanças no fluxo do bot para garantir que os caminhos principais continuam funcionando.

## Testes obrigatórios do bot

### 1. Saudação e nome

* Cliente novo recebe saudação correta.
* Cliente que manda "cardápio" não vira nome.
* Cliente que manda pedido direto não vira nome.

### 2. Pizza normal

Teste:
"quero uma pizza grande de calabresa"

Validar:

* reconhece categoria pizza
* reconhece tamanho grande
* reconhece sabor calabresa
* pergunta borda ou avança corretamente

### 3. Pizza meio a meio

Teste:
"quero uma pizza família metade baiana metade mexicana"

Validar:

* reconhece tamanho família
* reconhece os dois sabores
* mantém apenas uma pizza no pedido
* calcula preço corretamente

### 4. Borda

Validar:

* aceita sem borda
* aceita borda disponível
* não adiciona borda quando cliente nega

### 5. Bebida no fechamento

Validar:

* em `add_more`, opção de bebida funciona
* "não quero mais nada" finaliza
* número "2" não deve virar quantidade de pizza se o step espera escolha de fechamento

### 6. Delivery

Teste:
"entrega no bairro centro, rua principal, pix"

Validar:

* detecta delivery
* detecta bairro
* detecta endereço
* detecta pagamento
* aplica taxa de entrega correta

### 7. Retirada

Teste:
"vou retirar no balcão e pagar no cartão"

Validar:

* detecta retirada
* não pede bairro
* não pede endereço
* vai para pagamento/confirmação

### 8. Consumo no local

Teste:
"vou comer aí"

Validar:

* detecta consumo no local
* não pede bairro
* não pede endereço
* vai para pagamento/confirmação

### 9. Pagamento

Validar:

* pix
* dinheiro com troco
* dinheiro sem troco
* cartão
* pagamento híbrido, se suportado

### 10. Pedido completo em uma mensagem

Teste:
"quero uma pizza grande metade baiana metade mexicana sem borda entrega no centro rua 10 pix"

Validar:

* reconhece pizza
* reconhece tamanho
* reconhece dois sabores
* reconhece sem borda
* reconhece delivery
* reconhece bairro
* reconhece endereço
* reconhece pagamento

### 11. Produto fora do cardápio

Validar:

* bot não confirma produto inexistente
* oferece opções próximas ou pede para escolher novamente

### 12. Escalar para humano

Validar:

* palavras de reclamação, erro ou atendente acionam fluxo de atendimento humano

## Regra de validação depois de mudança

Depois de alterar `src/lib/bot.ts`, sempre:

1. Rodar `npm run build`.
2. Testar manualmente pelo simulador ou WhatsApp real pelo menos o fluxo afetado.
3. Confirmar que nenhum fluxo principal foi quebrado.
