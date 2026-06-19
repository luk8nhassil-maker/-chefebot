# BOT_FLOW_BASELINE

## Objetivo

Este arquivo registra o estado atual do fluxo do bot antes das próximas correções, para evitar releitura desnecessária do `src/lib/bot.ts` em toda tarefa.

## Arquivo principal

`src/lib/bot.ts`

## Webhook principal

`src/app/api/bot/route.ts`

## Fluxo principal de pedido

`welcome` → `category` → `size` → `flavor` → `segundo_sabor` → `border_escolha` → `border` → `add_more` → `observacao` → `delivery_type` → `neighborhood` → `address` → `payment` → `troco`/`aguardando_pix` → `pedindo_nome` → `confirm` → `done`

## Steps existentes

| Step | Descrição |
|---|---|
| `welcome` | Primeira mensagem ao cliente novo |
| `returning` | Retorno de cliente com histórico |
| `name` | Coleta nome do cliente |
| `category` | Escolha de categoria (pizza, lanche, bebida, suco) |
| `size` | Tamanho da pizza |
| `flavor` | Primeiro sabor |
| `segundo_sabor` | Segundo sabor (meio a meio) |
| `border_escolha` | Pergunta se quer borda |
| `border` | Escolha do tipo de borda |
| `add_more` | "Quer mais alguma coisa?" |
| `lanche_escolha` | Seleção de lanche |
| `lanche_flavor` | Sabor do lanche (calzone, mini-pizza) |
| `lanche_macarronada_size` | Tamanho da macarronada |
| `bebida_escolha` | Seleção de bebida |
| `suco_escolha` | Seleção de suco |
| `suco_leite` | Com ou sem leite |
| `observacao` | Observações do pedido |
| `delivery_type` | Delivery / Retirada / Consumo no local |
| `neighborhood` | Bairro (para delivery) |
| `confirma_bairro_fuzzy` | Confirmação de bairro por fuzzy match |
| `address` | Endereço completo |
| `confirm_address` | Confirmação de endereço |
| `payment` | Forma de pagamento |
| `payment_hibrido_valor` | Valor parcial em pagamento híbrido |
| `payment_hibrido_complemento` | Complemento de pagamento híbrido |
| `troco` | Troco para pagamento em dinheiro |
| `pedindo_nome` | Pede nome antes de confirmar (cliente que pulou o step) |
| `confirm` | Confirmação final do pedido |
| `aguardando_pix` | Aguarda comprovante de Pix |
| `consulta_preco` | Responde consulta de preço |
| `consulta_fatias` | Responde consulta de fatias por tamanho |
| `confirma_produto_valor` | Ambiguidade de produto identificado por valor |
| `confirma_sabor_ambiguo` | Ambiguidade de sabor |
| `confirma_item_ambiguo` | Ambiguidade de lanche ou bebida |
| `confirmando_mudanca` | Confirmação de mudança de categoria em andamento |
| `escalado` | Transferido para atendente humano |
| `done` | Pedido encerrado |

## Detectores importantes

| Função | O que detecta |
|---|---|
| `detectaTipoEntregaCompleto` | delivery / pickup / dine_in |
| `detectaBairro` | bairro por match exato de palavra inteira |
| `detectaBairroFuzzy` | bairro com erro de digitação (Levenshtein) |
| `detectaBairroPrefix` | bairro por prefixo de 3 letras |
| `detectaPagamento` | Pix / Dinheiro / Cartão |
| `detectaSaborDaMensagem` | sabor único via fuzzy + apelidos |
| `detectaDoisSabores` | dois sabores para meio a meio |
| `detectaBordaDaMensagem` | tipo de borda citada na mensagem |
| `detectaTamanhoDaMensagem` | tamanho P/M/G/F em texto livre |
| `detectaIntencaoDireta` | categoria de produto mencionada |
| `detectaIntencaoCardapio` | cliente quer ver o cardápio |
| `detectaPedidoCompleto` | pedido com tamanho + sabor + borda numa mensagem |
| `detectaPedidoParcial` | pedido com campos incompletos |
| `detectaConsultaPreco` | perguntas de preço ("quanto custa...") |
| `verificaConsultaFatias` | perguntas sobre número de fatias |
| `detectaCategoriaEValor` | "lanche de 18", "bebida de 6" |
| `detectaLeiteTexto` | "com leite" / "sem leite" em sucos |
| `precisaEscalar` | palavras que acionam atendente humano |
| `pareceNomeHumano` | diferencia nome próprio de pedido no step `name` |
| `parsearMultiSuco` | múltiplos sucos numa mensagem |
| `parsearQtdEItem` | "3 coca", "2x burguer" |
| `processarPedidoCompleto` | pedido inteiro + entrega + pagamento em 1 mensagem |

## Fluxos suportados atualmente

| Fluxo | Status |
|---|---|
| Pizza meio a meio | ✅ `detectaDoisSabores` + step `segundo_sabor` |
| Borda | ✅ steps `border_escolha` e `border`, preço por tamanho |
| Bebida | ✅ step `bebida_escolha`, upsell automático em `add_more` |
| Delivery | ✅ com bairro, taxa e endereço |
| Retirada | ✅ sem taxa, sem endereço |
| Consumo no local | ✅ `dine_in`, sem taxa, sem endereço |
| Pagamento em dinheiro | ✅ com fluxo de troco |
| Pagamento em Pix | ✅ com step `aguardando_pix` e análise de comprovante |
| Pagamento em cartão | ✅ vai direto para confirmação |
| Pedido completo em uma mensagem | ✅ `processarPedidoCompleto` e `detectaPedidoCompleto` |

## Pontos de risco

1. **Detectores fuzzy de sabor** — `resolveUmSabor` usa Levenshtein + apelidos; mudanças no cardápio podem gerar falsos positivos silenciosos.
2. **`processarPedidoCompleto`** — interpreta produto + entrega + pagamento em uma mensagem; ordem de precedência rígida (`isPizza → lanche → suco → bebida`) — novo produto pode quebrar a cadeia.
3. **Regex de tamanho** — `detectaTamanhoDaMensagem` usa letras isoladas (`/p\b/`, `/m\b/`) que podem colidir com palavras comuns.
4. **Match de bairro** — regex montada em runtime com o nome do bairro; caracteres especiais no nome quebram sem erro visível.
5. **`MENU` global mutável** — `setMenuDinamico` e `setEsgotados` alteram estado em memória; em serverless (Vercel) cada instância pode ter estado diferente.
6. **Heurística de nome humano** — `pareceNomeHumano` é heurística; pode aceitar palavra de domínio como nome ou rejeitar nome válido curto.
