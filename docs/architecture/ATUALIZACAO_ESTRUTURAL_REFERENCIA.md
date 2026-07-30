# Atualização estrutural — auditoria comparativa

**Referência usada:** `referencia-estrutural-sao-francisco.md`
**SHA da referência:** `7fbe0418eb2a2113ea22194885547113f1575e59`
**Data da comparação:** 2026-07-30

A referência é um documento **arquitetural** produzido por auditoria somente
leitura de outro projeto. Ela descreve a *forma* de 12 soluções, sem preços,
produtos, textos comerciais, credenciais ou limiares de política operacional.
Nada foi copiado literalmente: onde o ChefeBot já tinha solução equivalente ou
superior, a dele foi preservada. Os limiares operacionais deste documento são
política do ChefeBot, definidos aqui.

## Resultado da comparação, eixo a eixo

| # | Eixo da referência | Situação no ChefeBot |
|---|---|---|
| 1a | Busca na lista de pedidos | **Já existia** — `src/app/pedidos/page.tsx` filtra em memória, normaliza o termo uma vez, compara telefone por dígitos nos dois lados e casa contra o rótulo exibido do status |
| 1b | Busca de produto na montagem manual | **Não se aplica hoje** — o ChefeBot não tem montagem manual de pedido no painel; não foi criada uma para servir a um padrão |
| 2 | Fluxo guiado de montagem | **Já existia** — o construtor de pizza do cardápio é um fluxo por etapas (tamanho → sabores → borda) com avanço condicionado |
| 3 | Pagamento composto e sua invariante | **Faltava** — implementado (ver abaixo) |
| 4 | Fechamento de alertas resolvidos | **Faltava** — implementado (ver abaixo) |
| 5 | Token do cardápio no momento certo | **Já existia** — `src/lib/cardapioToken.ts`, com TTL, reuso, resolução só no servidor e degradação quando expira |
| 6 | Retorno correto para categorias | **Já existia** — a categoria ativa é estado separado do produto aberto |
| 7 | Sincronização segura do catálogo | **Já existia** — `src/app/cardapio/liveMenu.ts` faz polling `no-store` com pausa por visibilidade, mantém o último cardápio bom em caso de falha e só sinaliza erro na carga inicial |
| 8 | Impressão automática confiável | **Já existia** — `imprimirPedidoSilencioso` com guarda de SSR, iframe invisível, limpeza no `afterprint`, `@page { size: 80mm auto }` e bloqueio do botão manual enquanto o cliente edita. O disparo por *chegada* de pedido novo foi deliberadamente **não** adotado: o ChefeBot imprime no aceite, decisão da loja sobre consumo de bobina |
| 9 | Tratamento de pedidos inválidos | **Já existia** — validação estrutural antes de efeitos, predicados em vez de casts, `409`/`503` escolhidos por caso |
| 10 | Idempotência de criação de pedido | **Já existia** — `src/survival/*`, entregue no Modo Sobrevivência 1.0 |
| 11 | Estados de erro e carregamento | **Parcial** — os padrões de carregamento já existiam; faltavam fronteiras de erro por rota (ver abaixo) |
| 12 | Rastreamento em tempo real | **Já existia** — `src/lib/pedidoStatusPublico.ts` monta a projeção pública campo a campo; a página usa etapas por modalidade, polling com pausa por visibilidade e mapa com `ssr: false` |

## O que foi implementado

### Eixo 3 — pagamento composto (`src/lib/pagamentoComposto.ts`)

Módulo puro que passa a ser a **única gramática** de pagamento misto do
projeto: parse, validação e montagem da string canônica. Aritmética em
centavos inteiros, tolerância de um centavo, resultado discriminado
(`{ ok: true, valor } | { ok: false, erro }`).

Corrigiu dois defeitos reais encontrados na comparação:

1. **Grafia divergente.** A tela `/pedido/editar/[id]` gravava
   `Pix (R$ 30.00) + Dinheiro (R$ 20.00)` com ponto decimal, enquanto o
   checkout e o bot gravam com vírgula. Os helpers centralizados de
   `src/lib/bot.ts` (`valorPixEsperado`/`valorDinheiroEsperado`) leem o ponto
   como separador de **milhar** — a cobrança Pix e a base do troco iam para a
   casa dos milhares. A rota de salvamento agora normaliza para a forma
   canônica antes de qualquer efeito, e a interface deixou de montar a string.
2. **Invariante não revalidada.** Um pagamento misto válido na criação
   continuava sendo aceito depois de o cliente alterar itens na edição, mesmo
   com o total já diferente. `pagamentoAindaValido(pagamento, total)` é
   verificado no salvamento contra o total **recalculado**, e a tela avisa
   antes do envio com a instrução do que ajustar.

Pagamentos simples (Pix, Dinheiro, Cartão) são sempre válidos — não há
invariante de soma neles — e passam intactos pela normalização.

### Eixo 4 — limpeza operacional (`src/lib/limpezaOperacionalPedidos.ts`)

Rede final para pedidos que ficam parados numa etapa e nunca chegam a um
estado terminal. Lógica pura, testável sem mock:

- `classificarPendencia` devolve **uma** pendência ou `null`, por cascata do
  motivo mais crítico para o menos. Arquivado, terminal e já resolvido são
  descartados antes de qualquer cálculo de idade.
- A idade é medida na **etapa atual**, não na criação: carimbo de mudança de
  status → `horarioInicio` do preparo → o próprio ID (que é um `Date.now()` de
  13 dígitos) → carimbos do Pix → o horário `HH:MM`, com reconstrução no fuso
  fixo do estabelecimento e ajuste para a virada de meia-noite.
- **Direção do erro:** idade indeterminada é `0` e o pedido não gera
  pendência. Um falso negativo é silencioso; um falso positivo entulharia o
  painel com alarme falso justamente no pico.
- Para Pix pendente a ação primária é **verificar o Mercado Pago antes de
  decidir**, não cancelar — cancelar um pedido efetivamente pago é o erro caro
  deste fluxo. Verificar não grava resolução: se o Pix entrou, o pedido sai
  desse motivo sozinho na classificação seguinte.
- A resolução grava `limpezaOperacional { motivo, acao, resolvidoEm,
  resolvidoPor }` no próprio pedido, no **mesmo PATCH** que muda o status — é
  isso que fecha o alerta de forma durável e preserva o porquê da decisão.
  `calcularAnaliseOperacional` lê esse mesmo campo, com comparação de "mesmo
  dia" no fuso do estabelecimento, nunca no do navegador.

Limiares (política do ChefeBot, constantes nomeadas no topo do módulo): Pix
pendente 20 min, novo sem aceite 15 min, preparo 75 min, entrega 60 min.

O gate (`src/components/LimpezaOperacionalPainel.tsx`) é bloqueante e
apresenta uma pendência por vez, sem "fechar" nem "ignorar".

**Ativação:** `NEXT_PUBLIC_LIMPEZA_OPERACIONAL_ENABLED=true`. Desligado por
padrão — mesma postura do Modo Sobrevivência 1.0. Com a flag ausente ou
`false`, o painel de pedidos se comporta exatamente como antes.

Efeito colateral adotado independentemente da flag: o PATCH de `/api/orders`
passa a gravar `statusAtualizadoEm`. Campo aditivo e opcional; pedidos
anteriores a ele continuam válidos e caem na cadeia de fallback.

### Eixo 11 — fronteiras de erro por rota

`error.tsx` em `/pedidos`, `/cardapio`, `/cliente`, `/pedido` e
`/rastrear/[pedidoId]`, no mesmo formato do que já existia em `/conversas`:
registram o erro no log, apresentam título do que falhou, texto de ação e um
botão que chama `reset()`. A mensagem técnica nunca vai para a tela.

## Limites conhecidos

- O gate de limpeza operacional classifica a partir da lista que o painel já
  tem em memória. Um pedido que não esteja nessa lista (arquivado, por
  exemplo) nunca gera pendência — por definição, não por omissão.
- `statusAtualizadoEm` só existe para transições feitas a partir deste
  commit. Pedidos anteriores medem a idade da etapa pela cadeia de fallback,
  que é menos precisa para pedidos que já mudaram de status.
- A normalização da grafia legada de pagamento composto acontece no
  salvamento da edição. Pedidos antigos que nunca forem editados mantêm a
  string como foi gravada; os helpers de leitura continuam funcionando para a
  grafia com vírgula, que é a produzida pelo checkout e pelo bot.
