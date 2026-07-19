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

Se, no momento em que o ciclo se completa, nenhum produto configurado
resolve contra o catálogo real (removido/esgotado), a recompensa nasce
**`suspensa`** — nunca uma caixa `fechada` abrível que resultaria num prêmio
vazio. `suspensa` nunca aparece como caixa abrível para o cliente e
`abrirRecompensa` a rejeita. Uma substituição válida pela Kellyne
(`substituirRecompensa`) devolve a recompensa para `fechada` — a validade só
começa quando o cliente efetivamente abrir a caixa corrigida.

### Materialização server-side do presente no pedido (bloqueio econômico crítico)

O pedido do site (`POST /api/pedido-app`) recebe o presente da Jornada como um
campo **dedicado**, nunca como um item arbitrário do carrinho:

```ts
recompensaJornada?: {
  recompensaId: string;
  escolha?: { sabor?: string }; // só a pizza-presente usa isso
}
```

O frontend só informa QUAL recompensa reservada usar e, quando aplicável, o
sabor escolhido para a pizza. Produto, preço, quantidade, tamanho e
composição **nunca** vêm do carrinho — são sempre reconstruídos no servidor a
partir do snapshot estruturado da própria recompensa
(`materializarItensRecompensa`, em `@/lib/jornadaChef`):

- **Bebida/item individual**: exatamente 1 unidade do produto do snapshot, preço 0.
- **Pizza**: tamanho fixo do snapshot; o cliente escolhe um sabor entre
  `recompensa.pizza.sabores` (sabor fora da lista é rejeitado); sem borda,
  sem adicional, quantidade sempre 1.
- **Presente especial**: materializa a composição exata configurada (todos os
  itens e quantidades), sempre vinculados à mesma recompensa — a regra "um
  presente por pedido" continua valendo mesmo quando isso gera vários itens
  gratuitos no pedido.

Qualquer item que chegue com `recompensaJornadaId` (o contrato antigo,
inseguro) é rejeitado de imediato — um campo vindo do navegador nunca decide
o que é gratuito.

**Ordem atômica da vinculação** (rule 6): a recompensa é vinculada ao
`pedidoId` (`confirmarReservaNoPedido`, já idempotente e protegida por lock)
**antes** de persistir o pedido. Se a vinculação falhar, nenhum pedido chega
a ser criado. Se a persistência do pedido falhar depois, só o vínculo desta
recompensa é liberado (`liberarVinculoRecompensaPedidoNaoCriado`) — nunca uma
reescrita ampla da lista inteira de pedidos como compensação.

### Autorização pela sessão, nunca pelo telefone digitado

Quando `recompensaJornada` está presente no pedido, o servidor **exige uma
sessão válida da Área do Cliente** antes de qualquer outra validação: lê
`CLIENTE_COOKIE`, chama `verificarTokenCliente`, e busca o cliente real por
`payload.clienteId` (`buscarClientePorId`). `clienteIdJornada` é derivado
exclusivamente do telefone canônico desse perfil autenticado — nunca de
`body.telefone`, `whatsappToken`, nome digitado ou qualquer `clienteId`
enviado pelo frontend (nenhum desses prova propriedade da recompensa). O
telefone do pedido precisa corresponder (após normalização) ao telefone
canônico da sessão; divergência é rejeitada com 403, nunca transferindo a
recompensa silenciosamente para outro número. Sem cookie ou com sessão
inválida: 401. Pedido comum sem presente continua funcionando como convidado,
sem exigir login — a exigência de sessão vale só quando uma recompensa da
Jornada está sendo usada.

`prepararResgateParaPedido` também reforça a checagem central de rollout
(`jornadaAtivaParaCliente`): modo `off` bloqueia todos, `canary` só libera
quem está na lista (um cliente removido nunca completa o resgate mesmo com
sessão válida), `on` libera todo cliente elegível.

### Pizza-presente nunca conta para a fidelidade antiga (por pizzas)

`pizzasCount` — o contador que alimenta o programa antigo de fidelidade
(compra N pizzas, ganha 1 grátis, creditado quando o pedido chega a
`entregue`) — é calculado por `contarPizzasPagasParaFidelidade`
(`@/lib/pedidoAppItens`), que exclui explicitamente qualquer item com
`recompensaJornadaId` (e quantidade não positiva). A pizza-presente da
Jornada do Chef nunca pode avançar o progresso de OUTRO programa de
fidelidade que o cliente não pagou. Distinta de `contarPizzas`
(`@/lib/fidelidade`), usada só para exibição/registro, sem essa exclusão.
Pontos por valor (`calcularPontosElegiveisPedido`) e a própria trilha da
Jornada (`contarPizzasElegiveisPedido`, via `gratuito: true`) já excluíam
corretamente o presente — nada mudou aí.

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
- O presente no pedido do site é sempre materializado no servidor a partir do
  snapshot da própria recompensa (ver "Materialização server-side" acima) —
  preço sempre 0 calculado pelo servidor, nunca por um campo do carrinho. A
  legitimidade (pertence a este cliente, está `reservada`, não expirada, não
  vinculada a outro pedido) é validada antes de vincular ao pedido, e a
  vinculação acontece antes da persistência do pedido (nunca depois, nunca
  compensada reescrevendo a lista inteira de pedidos).
- Código de resgate manual (`codigoPublico`) é aleatório
  (`crypto.randomBytes`), não deriva de telefone/clienteId, não pode ser
  reutilizado, é revogável e nunca aparece em log/analytics.
- **Substituição manual estruturada** (`substituirRecompensa`): nunca aceita
  `produtoId`/`produtoNome` livres. Recebe uma especificação estruturada
  (`{tipo, item?, pizza?, composicao?}`, o mesmo formato da sequência de
  presentes), valida contra o catálogo real, reconstrói `produtoId`/`produtoNome`
  no servidor e limpa os campos do tipo antigo (ex.: trocar bebida→pizza
  remove `item`, define `pizza`, sem deixar os dois ao mesmo tempo).
- **Valor de referência** (`valorReferencia`): calculado no servidor a partir
  do preço oficial do catálogo (nunca informado pelo admin), salvo tanto na
  configuração da sequência quanto na recompensa concreta. Uma substituição só
  é aceita se o novo valor for igual ou superior ao valor de referência
  original — protege contra trocar um presente por um produto mais barato.
  Toda substituição registra o antes/depois (produto e valor) em
  `historicoSubstituicao`.

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
- **`canary`**: só os clientes em `canaryClientes` participam — permite o
  primeiro teste real em Production sem expor a feature a ninguém mais.
- **`on`**: todo cliente elegível participa.

`jornadaAtivaParaCliente(config, clienteId)` em `src/lib/jornadaChef.ts` é a
**única** função que decide isso — todo hook de crédito
(`processarConclusaoPedidoJornada`), toda rota do cliente (progresso, abrir,
reservar, cancelar-reserva) e a mensagem de WhatsApp dependem dela; nenhuma
rota reimplementa a checagem.

### Lista canário — modelo opaco, sem telefone recuperável

`clienteId` tem o formato `cli_<telefone sanitizado>` em todo o domínio
(convenção já existente no modelo de pontos) — ou seja, guardá-lo puro na
lista canário equivaleria a persistir o telefone completo. Por isso a lista
guarda uma entrada estruturada, nunca o `clienteId` nem o telefone:

```ts
type ClienteCanario = {
  ref: string;            // HMAC-SHA256(AUTH_SECRET, clienteId) — nunca reversível sem o segredo
  idPublico: string;       // prefixo curto de `ref` (12 hex) — seguro para expor/usar como referência de remoção
  labelMascarado: string;  // "…últimos 4 dígitos", só para exibição
};
```

- `ref` reaproveita o mesmo `AUTH_SECRET` já usado para assinar sessões
  (`@/lib/auth`, `@/lib/clienteAuth`) — nunca um SHA simples sem segredo.
  Diferente dessas duas rotinas, aqui **nunca há fallback para um segredo de
  desenvolvimento**: sem `AUTH_SECRET` configurado, `jornadaAtivaParaCliente`
  falha fechado (bloqueia o acesso) em vez de calcular uma referência
  previsível.
- `jornadaAtivaParaCliente` recebe o `clienteId` interno, calcula a mesma
  referência (`refCanario`) e compara só com `canaryClientes[].ref` — nunca
  compara telefone ou `clienteId` puro, e nunca loga a referência completa.
- `adicionarClienteCanario(telefone)` recebe o telefone só na chamada,
  deriva o `clienteId` **em memória** (nunca persistido), calcula `ref` e
  `idPublico`, e devolve só `{ idPublico, labelMascarado }` — nunca
  `clienteId` nem telefone.
- `removerClienteCanario(idPublico)` e `listarClientesCanario` operam e
  devolvem só `idPublico`/`labelMascarado` — a `ref` completa nunca sai do
  módulo de domínio.
- Trocar de modo (`off`↔`canary`↔`on`) nunca apaga progresso ou recompensas
  existentes — só muda quem tem acesso a partir de agora.

Painel: `/admin/jornada-chef` tem um seletor de 3 estados para o modo de
rollout e uma seção "Clientes canário" (adicionar por telefone, remover por
`idPublico`) via `/api/admin/jornada-chef/canario` — que só aceita
`telefone` no POST e só `idPublico` no DELETE, nunca `clienteId`.

### Analytics sanitizado — pseudonimização, nunca telefone ou clienteId

Os eventos de `jornada:analytics:<tenant>` (`caixa_aberta`,
`recompensa_reservada`, `recompensa_resgatada`, `resgate_manual`,
`jornada_creditada`, `fase_concluida`, `caixa_desbloqueada`,
`credito_revertido`, `falha_processamento`) nunca gravam `clienteId`,
telefone, nome, cookie, token, OTP ou o código público de resgate completo.

- `refAnalytics(clienteId)` calcula `HMAC-SHA256(AUTH_SECRET,
  "jornada-analytics:v1:" + clienteId)`, truncado a 24 caracteres hex — uma
  referência **exclusiva de analytics**, com separação de domínio: a mensagem
  HMAC é diferente da usada pela lista canário (`refCanario`), então as duas
  referências nunca podem ser cruzadas entre si mesmo com o mesmo segredo.
  Sem `AUTH_SECRET` disponível, `clienteRef` fica ausente do evento — nunca
  cai para o `clienteId` puro como alternativa.
- `registrarEventoAnalytics` centraliza a sanitização: mesmo que uma chamada
  erre e envie `clienteId`, `telefone`, `nome`, `cookie`, `token`, `otp`,
  `codigoPublico` ou um nome de operador, esses campos são removidos antes de
  persistir — a proteção não depende da disciplina de cada call site.
- No resgate manual, quem aplicou o resgate é gravado como `papelOperador`
  (o papel, ex. `"admin"`) — nunca o nome de usuário. Esse campo é diferente
  do `historicoSubstituicao` de uma recompensa (que continua guardando quem
  fez a substituição, para auditoria da própria recompensa) — a mudança é
  só no analytics agregado.

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
