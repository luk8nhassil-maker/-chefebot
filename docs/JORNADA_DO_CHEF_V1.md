# Jornada do Chef — V1

Segunda camada de fidelidade do ChefeBot, criada **ao lado** do programa de
pontos existente (`src/lib/fidelidade.ts`), nunca em substituição a ele.

## Diferença entre Pontos e Jornada do Chef

| | Pontos | Jornada do Chef |
|---|---|---|
| Recompensa | Volume (R$1 = 1 ponto) | Recorrência (12 pizzas elegíveis) |
| Fonte de verdade | `fidelidade:pontos:*` | `jornada:*` |
| Determinação do prêmio | Configurável (desconto/pizza) | Determinística por ciclo, sem RNG |
| Quando credita | Pedido `entregue` | Pedido `entregue` (mesmo evento) |

As duas camadas processam o **mesmo pedido**, de forma independente. Nenhuma
mudança desta feature altera o cálculo, o saldo ou o extrato de pontos.

## Elegibilidade — o que conta como pizza

`contarPizzasElegiveisPedido(pedido)` em `src/lib/jornadaChef.ts` é a única
fonte de verdade. Não faz parsing de texto livre — sempre parte de dados
estruturados:

- Pedido do site/app (`itensDetalhados: ItemApp[]`): conta itens
  `kind === "pizza"` (mini-pizza é `kind: "simple"` no cardápio do site, já
  fica de fora). Quantidade 3 do mesmo item = 3 pizzas. Meio a meio / 3
  sabores são **um único item** (`detail` com os sabores), sempre = 1 pizza.
  Itens de promoção (`kind: "promo"`) **não contam nesta V1** — o bundle
  mistura pago + grátis num preço único, sem decompor pizzas individualmente
  (mesma limitação que já existe no modelo de pontos hoje).
- Pedido do WhatsApp (`itensJornada: ItemElegibilidadeJornada[]`): calculado
  a partir de `session.cart` (`CartItem[]` do bot) no momento da criação do
  pedido (`itensJornadaDoCarrinhoWhatsApp`). Cada item `category === "pizza"`
  = 1 pizza. Mini-pizza é `category: "lanche"` no bot, já fica de fora.
- Item recebido como recompensa (`recompensaJornadaId` presente) nunca conta,
  em nenhum canal.
- Pedido `cancelado` conta 0.
- Pedido antigo sem nenhum dos dois campos estruturados: fallback
  conservador, conta 0 — nunca quebra, nunca inventa progresso retroativo.

## Teto econômico por pedido

No máximo `config.limitePizzasPorPedido` (padrão e máximo seguro: **4**)
pizzas de um mesmo pedido avançam na trilha, mesmo que o pedido tenha mais
pizzas elegíveis. Todas as pizzas continuam gerando pontos normalmente — o
teto é só da trilha da Jornada. Um pedido nunca desbloqueia mais de uma
caixa por padrão (4 ≤ 12), mas o motor (`processarConclusaoPedidoJornada`)
já é genérico o suficiente para lidar com múltiplos ciclos no mesmo pedido
caso o limite seja alterado no futuro.

## Fases e ciclo

- Meta: `config.metaPizzas` (padrão e valor aprovado para V1: **12**).
- Fase 1: 0–2, Fase 2: 3–5, Fase 3: 6–8, Fase 4: 9–11 (sempre meta/4 por
  fase). A fase é **sempre derivada** de `pizzasNoCiclo` (`derivarFaseAtual`),
  nunca armazenada como fonte de verdade separada.
- Ao atingir a meta: cria uma recompensa ("caixa fechada"), incrementa
  `totalJornadasConcluidas`, inicia um novo ciclo preservando o excedente
  (ex.: 10/12 + 4 pizzas → caixa + novo ciclo em 2/12).
- Todas as fases cruzadas num único pedido são registradas
  (`jornada:fase:*`), mesmo que mais de uma seja cruzada de uma vez.
- Progresso nunca expira (sem TTL na chave de progresso).

## Idempotência e concorrência

Cada pedido processado grava um registro de auditoria em
`jornada:pedido:{tenant}:{pedidoId}` (rule 8: pedidoId, clienteId, canal,
tipo de atendimento, pizzas elegíveis/na trilha, ciclo antes/depois,
progresso antes/depois, fases cruzadas, recompensas criadas, timestamp,
eventual reversão). Esse registro é o guard de idempotência: reprocessar o
mesmo pedido (retry, webhook duplicado, clique duplo) sempre devolve o
mesmo resultado, nunca credita duas vezes.

Concorrência é protegida por um lock exclusivo por cliente
(`jornada:lock:{tenant}:{clienteId}`, `SET NX` + TTL 5s + Lua
compare-and-delete) — mesmo padrão já usado com segurança no modelo de
pontos (`comBloqueioCliente` em `fidelidade.ts`), reimplementado aqui num
namespace próprio.

## Recompensa determinística — zero RNG

`escolherRecompensaDoCiclo` escolhe o prêmio por índice
`(cicloConcluido - 1) % ativos.length` sobre as entradas **ativas** da
sequência configurada pela Kellyne (`config:jornada_chef`). Sem sorteio, sem
`Math.random`, sem tabela de probabilidade.

### Modelo estruturado da sequência de presentes

Cada entrada de `sequenciaRecompensas` (`RecompensaConfigCiclo`) é sempre uma
referência estruturada ao cardápio real — nunca um `produtoId` genérico nem
texto livre:

- **`bebida_sobremesa`**: `item` — referência estável (`ItemCatalogoJornada`,
  `produtoId` de `catalogoDoMenu`/`@/lib/promocoes`, `produtoNome` snapshot,
  `categoria`).
- **`pizza`**: `pizza` — `tamanho` (código de `menu.sizes`) + `sabores`
  (lista de sabores permitidos, de `menu.saltyFlavors`/`sweetFlavors`). Borda
  e adicionais nunca estão incluídos. Não há opção de "pagar a diferença"
  nesta V1 — decidimos não implementar isso ainda porque exigiria integração
  adicional com o cálculo de carrinho para ser aplicado com segurança.
- **`presente_especial`**: `composicao` — lista estruturada de
  `{ item, quantidade }`, nunca uma string livre.

O catálogo real (tamanhos, sabores, itens individuais com status de
esgotado) é servido por `obterCatalogoJornada()` — lido de
`getMENUDinamico()` (@/lib/menu) e `catalogoDoMenu` (@/lib/promocoes), nunca
duplicado ou hardcodado no frontend. O painel da Kellyne consome isso via
`GET /api/admin/jornada-chef/catalogo`.

### Validação e ativação

`validarSequenciaRecompensas` rejeita, em `salvarConfigJornadaChef` (chamado
por `POST /api/jornada-chef/config`): produto inexistente/removido/esgotado,
tamanho de pizza inválido, sabor inválido ou ausente, composição vazia de
presente especial. A configuração inteira é rejeitada (nada é salvo
parcialmente) se qualquer entrada for inválida.

A Jornada do Chef **não pode ser ativada** (`ativo: true`) sem ao menos uma
recompensa configurada e ativa na sequência — tentar ativar sem isso retorna
erro claro, sem ativar parcialmente (rule 8).

Além da validação no momento de salvar, `criarRecompensa` **revalida contra
o catálogo atual** no momento em que uma caixa é de fato criada (um produto
configurado pode ter ficado esgotado entre a configuração e a conclusão do
ciclo) — nesse caso a caixa é criada "fechada" sem produto definido, e uma
pendência de revisão é aberta automaticamente (`produtos_nao_configurados`),
nunca entregando um produto que já não existe no cardápio.

## Ciclo de vida da recompensa

`fechada → disponivel (abrirRecompensa) → reservada (reservarRecompensaParaProximoPedido
+ confirmarReservaNoPedido) → resgatada (na conclusão do pedido)`, com
desvios possíveis para `expirada`, `suspensa` ou `cancelada`. Abertura,
reserva e confirmação são todas protegidas pelo mesmo lock por cliente e são
idempotentes — refresh, clique duplo e reprocessamento nunca alteram o
resultado já decidido. Validade de 30 dias (configurável) começa na
abertura, não na criação da caixa.

## Reversão (pedido reaberto/cancelado/estornado)

`reverterConclusaoPedidoJornada`:

1. Se o pedido nunca creditou, não há nada a reverter.
2. Se a(s) recompensa(s) criada(s) por ele ainda estão `fechada` (nunca
   abertas) **e** nada mais aconteceu para este cliente desde então (o
   estado atual bate exatamente com o snapshot "depois" salvo), reverte
   totalmente: desfaz o delta de pizzas e cancela a(s) recompensa(s).
3. Caso contrário — recompensa já aberta/reservada/resgatada, **ou**
   progresso do cliente já avançou por pedidos posteriores — a reversão
   automática de progresso é **proibida** (corromperia avanços legítimos).
   Suspende o que ainda dá para suspender e abre uma pendência de revisão
   manual (`jornada:pendencias:*`) para a Kellyne decidir. Nunca cria saldo
   negativo silenciosamente, nunca retira da tela um prêmio já visualizado.

`liberarRecompensaDePedidoCancelado` cuida do caso irmão: se o pedido
cancelado tinha um presente **reservado nele** (não a criação da caixa, mas
o uso de um presente já existente), devolve a reserva para "disponivel" —
ou, se já havia sido marcada como resgatada, abre pendência em vez de
reverter.

## Namespaces Redis

Todos exclusivos da Jornada do Chef, nunca reaproveitando `cliente:<telefone>`
(a colisão corrigida no PR #237) nem `fidelidade:*`:

```
jornada:config:{tenant}
jornada:progresso:{tenant}:{clienteId}
jornada:pedido:{tenant}:{pedidoId}
jornada:recompensa:{tenant}:{recompensaId}
jornada:recompensas-cliente:{tenant}:{clienteId}
jornada:fase:{tenant}:{clienteId}
jornada:codigo:{tenant}:{codigoPublico}
jornada:pendencias:{tenant}
jornada:analytics:{tenant}
jornada:lock:{tenant}:{clienteId}          (TTL — lock)
jornada:msg:{tenant}:{pedidoId}:{tipo}     (TTL — dedupe de mensagem)
```

`tenant` é hoje sempre `"default"` (uma única pizzaria), mas todo o domínio
já é organizado por tenant para permitir multi-loja futuramente sem
reestruturar chaves. Só as chaves de lock e dedupe de mensagem têm TTL —
progresso e recompensa são permanentes.

## Segurança

- Toda ação do cliente (abrir, reservar, cancelar reserva) exige sessão
  válida (`lerSessaoCliente`) e sempre resolve o `clienteId` a partir do
  telefone da SESSÃO — nunca de um id enviado pelo frontend.
- O item-presente no pedido do site (`ItemApp.recompensaJornadaId`) tem o
  preço sempre forçado a 0 no servidor; a legitimidade (pertence a este
  cliente, está `reservada`) é validada antes de criar o pedido, e a
  confirmação do vínculo usa o mesmo padrão de rollback do resgate de pontos
  (se falhar, o pedido é desfeito).
- Código de resgate manual (`codigoPublico`) é aleatório
  (`crypto.randomBytes`), não deriva de telefone/clienteId, não pode ser
  reutilizado, é revogável e nunca aparece em log/analytics.

## Analytics

Eventos sanitizados em `jornada:analytics:{tenant}` (lista com cap):
`jornada_creditada`, `fase_concluida`, `caixa_desbloqueada`,
`caixa_aberta`, `recompensa_reservada`, `recompensa_resgatada`,
`resgate_manual`, `falha_processamento`. Nunca telefone completo, nome,
cookie, token, OTP ou código integral de resgate.

## Configuração e feature flag — rollout canário

`GET/POST /api/jornada-chef/config` (admin/atendente leem, só admin/dev
escrevem). `salvarConfigJornadaChef` sempre reforça os limites econômicos
aprovados, mesmo com payload adulterado: meta entre 4 e 60, limite por
pedido entre 1 e min(4, meta), validade entre 1 e 365 dias.

A ativação simples (`ativo: boolean`) foi substituída por `modoRollout`:

- **`off`** (padrão): ninguém participa — pontos e pedidos continuam
  funcionando normalmente, dados já existentes da Jornada não são apagados,
  a UI do cliente fica oculta e nenhuma nova recompensa é criada.
- **`canary`**: só os clientes em `canaryClienteIds` participam — permite o
  primeiro teste real em Production sem expor a feature a ninguém mais.
- **`on`**: todo cliente elegível participa.

`jornadaAtivaParaCliente(config, clienteId)` em `src/lib/jornadaChef.ts` é a
**única** função que decide isso — todo hook de crédito
(`processarConclusaoPedidoJornada`), toda rota do cliente (progresso, abrir,
reservar, cancelar-reserva) e a mensagem de WhatsApp dependem dela; nenhuma
rota reimplementa a checagem.

A lista canário guarda **somente `clienteId`** (derivado no servidor a
partir do telefone via `derivarClienteIdPorTelefone`) — o telefone em si
nunca é persistido como campo separado. `adicionarClienteCanario(telefone)` /
`removerClienteCanario(clienteId)` gerenciam a lista; `listarClientesCanario`
sempre devolve um identificador mascarado (`…últimos 4 dígitos`, mesmo padrão
já usado no modelo de pontos), nunca o telefone completo. Trocar de modo
(`off`↔`canary`↔`on`) nunca apaga progresso ou recompensas existentes —
só muda quem tem acesso a partir de agora.

Painel: `/admin/jornada-chef` tem um seletor de 3 estados para o modo de
rollout e uma seção "Clientes canário" (adicionar por telefone, remover por
identificador mascarado) via `/api/admin/jornada-chef/canario`.

## Painel da Kellyne

`/admin/jornada-chef` — configuração, pendências de revisão e consulta por
telefone (progresso, ciclo, recompensas, código de resgate, revogar código,
resgate manual). `POST /api/admin/jornada-chef/resgate-manual` cobre
aplicar/revogar/substituir; substituição sempre fica registrada no
histórico da recompensa (`historicoSubstituicao`).

## Fora do escopo da V1

- Níveis/títulos ("Chef de Bairro", "Chef Mestre", "Lenda").
- Pizzas dentro de promoções compostas contando para a trilha.
- Resgate automático do presente pelo canal WhatsApp (o cliente usa o app;
  no WhatsApp, o fallback é sempre o resgate manual da Kellyne).
- Multi-tenant real (a estrutura já suporta, mas só existe um tenant hoje).

## Plano futuro de migração para banco relacional

Toda a persistência vive isolada em `src/lib/jornadaChef.ts` — nenhuma
chamada direta ao Redis por fora deste módulo. Migrar para um banco
relacional no futuro significa reimplementar as funções deste arquivo
mantendo as mesmas assinaturas (estado, recompensa, registro de
processamento, pendência viram tabelas/linhas em vez de chaves Redis); nada
fora deste módulo precisa mudar.
