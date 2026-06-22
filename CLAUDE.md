@AGENTS.md

## Regras permanentes de arquitetura do ChefeBot

### Regra de confiança: Guardião antes de qualquer chute

Nenhum caminho interno de baixa confiança pode responder antes do Guardião/Fallback.
O bot só responde de forma determinística quando houver **intenção clara**; caso contrário, aciona o Guardião (`respostaInvalida`) ou pede esclarecimento.

- Match claro de produto/categoria/ação → segue fluxo determinístico.
- Match fraco, fuzzy, por preço, parecido ou genérico → **não responde direto**.
- Ambíguo ou sem certeza → Guardião/Fallback Inteligente.

### Regra sobre números em mensagens

`detectaCategoriaEValor` só é legítima quando o número é claramente um preço/faixa (ex: "lanche de 20", "bebida de 5 reais").
**Nunca deve disparar quando o número é uma quantidade ou tamanho colado a unidade** (ex: "2l", "500ml", "1kg", "2 litros").
Garantido pelo `\b` no regex e pela checagem de palavras de unidade após o número.

### Regra sobre "baiana" e fuzzy match

"baiana" **NUNCA** vira "banana" via fuzzy-match. Protegido pelo guard em `category` e `add_more`
que chama `montarPizzaDoPedido` antes de `tentaAdicionarComQtd` quando há intenção clara de pizza.

### O que NUNCA alterar sem revisão explícita

Preços · Pix · pagamento híbrido · troco · entrega · retirada · consumo no local · borda ·
pizza meio a meio · sabores · carrinho · upsell numerado de bebidas · copy já validada ·
WhatsApp/simulador.
