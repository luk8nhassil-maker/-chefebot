# Decisão técnica: corrida read-modify-write na chave `pedidos`

**Status: IMPLEMENTADO** (ver seção 8) — `src/lib/pedidosStore.ts` e a
migração de todos os writers de produção da chave `pedidos` para ele. As
seções 1-7 abaixo são o registro histórico da análise/decisão que motivou a
implementação; a seção 8 documenta o que foi de fato construído, testado e
suas garantias/limitações reais.

A ativação do Modo Sobrevivência em Production (`SURVIVAL_MODE_ENABLED=true`)
permanece bloqueada — este PR é estritamente estrutural (concorrência da
chave `pedidos`), não ativa nenhuma flag e não inicia a Etapa 2 de interface.

## 1. O risco, com precisão

`pedidos` é uma única chave Redis (`String`, um array JSON com *todos* os
pedidos), lida e reescrita por inteiro em cada criação:

```
const pedidos = await redis.get("pedidos");           // snapshot A
...                                                     // validações, Pix, etc.
await redis.set("pedidos", [...pedidos, novoPedido]);  // escreve A + novoPedido
```

Se duas requisições **com `clientRequestId` diferentes** (dois clientes reais
pedindo ao mesmo tempo, ou o mesmo cliente abrindo duas abas com dois
carrinhos diferentes) executarem o `GET` quase simultaneamente, ambas veem o
mesmo snapshot `A`. Cada uma escreve `A + seuPedido` de volta — a segunda
escrita sobrescreve a primeira. Resultado: **um dos dois pedidos desaparece
silenciosamente da lista**, sem erro, sem log, sem qualquer sinal para quem
fez aquele pedido (que recebeu `200 OK` com `pedidoId` real — o pedido foi
"confirmado" e depois apagado por uma escrita concorrente).

Importante, e por isso este risco **não** é resolvido pela idempotência
implementada no PR 1: a proteção por `clientRequestId` (claim atômico +
fingerprint) só serializa tentativas que **compartilham o mesmo
identificador** — ou seja, protege contra o mesmo cliente duplicar o próprio
pedido. Não protege dois pedidos **legítimos e distintos** de colidirem na
mesma reescrita da chave `pedidos`.

Esse risco é **pré-existente** (não introduzido por este programa) e já está
documentado em `docs/architecture/REDIS_KEY_INVENTORY.md` como o principal
argumento para a migração a PostgreSQL (`ADR-POSTGRES-SOURCE-OF-TRUTH.md`),
que é um programa arquitetural separado, aprovado mas **não iniciado**. O
Modo Sobrevivência 1.0 **não migra pedidos nem implementa dual-write** — essa
restrição está explícita no comando original deste programa. Este documento
não contradiz isso: propõe a **menor mitigação segura possível dentro do
Redis atual**, não uma solução definitiva.

## 2. Por que isso importa para o Modo Sobrevivência

Um dos princípios centrais do programa é "o cliente nunca vê 'pedido
confirmado' quando o pedido não foi persistido". A corrida acima viola esse
princípio de um jeito mais sutil: o cliente **viu** a confirmação, o pedido
**foi** persistido no momento do `SET` — só que uma escrita concorrente
depois o apagou sem deixar rastro. Isso é pior do que um erro visível, porque
ninguém (cliente, atendente, painel) percebe que algo deu errado até o
pedido simplesmente não aparecer.

## 3. Opções consideradas

### Opção A — Lock distribuído curto ao redor do `GET`+`SET`

Envolver as duas operações (`GET pedidos` → `SET pedidos`) com o mesmo padrão
de lock já usado em `src/lib/mercadoPagoReconciliacao.ts` (`SET NX EX` +
compare-and-delete atômico via Lua ao liberar):

```
const lockAdquirido = await redis.set("lock:pedidos:append", token, { nx: true, ex: 5 });
if (!lockAdquirido) {
  // retry com backoff curto (ex.: até 3 tentativas, ~150ms entre elas) —
  // nunca espera indefinidamente, nunca falha silenciosamente o pedido.
}
try {
  const pedidos = await redis.get("pedidos");
  await redis.set("pedidos", [...pedidos, novoPedido]);
} finally {
  await liberarLockSeDono(token); // compare-and-delete, mesmo padrão já usado
}
```

**Prós:** mudança pequena e isolada, reaproveita um padrão já validado em
produção (Pix), fácil de entender e reverter.
**Contras:** serializa TODAS as criações de pedido (mesmo entre clientes sem
relação alguma) atrás de um único lock — em pico (sexta/sábado à noite,
citado nos docs de infraestrutura), isso pode virar um gargalo de fila se o
volume de pedidos simultâneos for alto. Precisa de retry com backoff bem
calibrado para não rejeitar pedidos legítimos sob concorrência real.

### Opção B — Append atômico via Lua (sem lock explícito)

Um único script Lua faz leitura + append + escrita como uma operação atômica
no próprio Redis (sem round-trip de "ler no Node, escrever no Node"):

```lua
-- KEYS[1] = "pedidos", ARGV[1] = JSON do novo pedido
local atual = redis.call("get", KEYS[1])
local lista = atual and cjson.decode(atual) or {}
table.insert(lista, cjson.decode(ARGV[1]))
redis.call("set", KEYS[1], cjson.encode(lista))
return 1
```

**Prós:** verdadeiramente atômico (o Redis executa Lua de forma
single-threaded — não há janela de corrida possível), sem lock/retry, sem
custo de round-trip extra.
**Contras:** depende de `cjson` estar disponível no ambiente Lua da Upstash
(não confirmado nesta auditoria — precisa de um teste manual contra a
instância real antes de adotar); um array `pedidos` grande (cresce
indefinidamente hoje) precisa ser desserializado/serializado inteiro dentro
do script a cada chamada, o que já é o custo atual (não piora), mas o limite
de tempo de execução de scripts Lua da Upstash precisa ser confirmado para
volumes de pico.

### Opção C — Não mitigar agora, só monitorar

Manter o comportamento atual e usar o `Guardião`/painel operacional (Etapa 4
do programa) para detectar e alertar quando um pedido reportado por um
cliente não aparece na lista — mitigação reativa, não preventiva.

**Prós:** zero mudança de código, zero risco de regressão.
**Contras:** não prevê o problema, só o detecta depois — inaceitável para o
princípio central do programa ("nunca perder um pedido confirmado
silenciosamente").

## 4. Recomendação preliminar (para revisão humana, não uma decisão tomada)

**Opção A** (lock curto com retry limitado) parece o menor risco de
implementação — reaproveita 100% um padrão já testado em produção (Pix), sem
depender de confirmar suporte a `cjson` no ambiente Lua da Upstash. O custo
de gargalo em pico pode ser mitigado com um TTL de lock curto (2-5s, bem
abaixo do tempo de criação de um pedido) e poucas tentativas de retry
(2-3, com jitter) antes de devolver um erro recuperável ao cliente (nunca um
500 cru) — o mesmo padrão de resposta "tente de novo em instantes" já
estabelecido neste programa.

A Opção B é mais elegante a longo prazo, mas requer validação prévia contra
a instância Upstash real (fora do escopo de uma decisão só de código).

## 5. O que qualquer implementação futura precisa cobrir

- **Comandos Redis adicionais:** Opção A adiciona 2 comandos por criação de
  pedido (`SET NX` do lock + liberação via `EVAL`) no caminho feliz, mais
  possíveis re-tentativas sob concorrência real (bounded, nunca ilimitadas).
  Opção B não adiciona comando algum (substitui o `GET`+`SET` existente por
  1 único `EVAL`).
- **Impacto no fluxo atual:** nenhuma mudança de contrato de
  `POST /api/pedido-app` — o lock/atomicidade fica inteiramente dentro da
  função, invisível ao cliente, exceto no caso raro de esgotar os retries
  (resposta recuperável, nunca 500 cru). Outros pontos do sistema (fora do
  escopo desta decisão, mas relevantes para avaliar compatibilidade) também
  usam o padrão `GET pedidos` → `SET pedidos` completo (edição de
  pedido, cancelamento, mudança de status pelo painel `/pedidos`,
  confirmação de Pix manual). Qualquer lock/atomicidade adotado aqui
  precisaria, no mínimo, ser avaliado quanto a se esses outros pontos também
  precisam do mesmo mecanismo — ou se o escopo fica deliberadamente restrito
  à CRIAÇÃO de pedido (onde a colisão de dois clientes é mais provável) e os
  demais pontos (edição por um único painel, tipicamente um atendente por
  vez) ficam de fora por ora, com uma nota explícita de risco residual
  aceito.
- **Testes de concorrência:** duas criações simultâneas de pedidos
  DIFERENTES (não relacionados por `clientRequestId`) nunca podem resultar
  em `pedidos.length < 2` depois de ambas retornarem sucesso — este é o
  teste mínimo que qualquer implementação desta decisão precisa provar antes
  de ser aceita.
- **Rollback:** qualquer lock introduzido precisa ter TTL curto e
  compare-and-delete por token (nunca um lock "preso" bloqueando pedidos
  futuros); reverter = remover o lock/script e voltar ao `GET`+`SET` direto
  de hoje, sem migração de dado nenhuma envolvida.

## 6. Risco adicional identificado (4ª revisão de segurança): colisão de `pedidoId`

`pedidoId = Date.now().toString()` (milissegundos desde epoch) é o único
identificador do pedido dentro do array `pedidos` — usado como chave de
busca por `buscarPedidoPersistidoPorId`/`buscarPedidoPorClientRequestIdHash`
(módulo de idempotência do PR 1) e por praticamente todo o resto do sistema
(edição, status, Pix, painel). **Duas requisições distintas que persistem
dentro do mesmo milissegundo recebem o MESMO `pedidoId`** — em pico de
tráfego (o mesmo cenário de concorrência descrito nas seções 1-2), isso não
é apenas teórico.

Consequências, combinadas com o risco já descrito:

- Se a Opção A/B desta decisão for implementada (serializando os `SET` em
  `pedidos`), a colisão de `pedidoId` ainda pode ocorrer entre dois pedidos
  que — mesmo serializados — foram criados no mesmo milissegundo por
  execuções sequenciais rápidas. O lock/atomicidade da chave `pedidos`
  resolve a corrida de **escrita** (nenhum pedido é perdido), mas não
  resolve a colisão de **identidade** (dois pedidos diferentes, ambos
  presentes no array, com o mesmo `id`).
- Um `pedidoId` duplicado quebra qualquer busca por id (`buscarPedidoPersistidoPorId`,
  edição, status, Pix) de forma ambígua — `Array.find` sempre retorna o
  **primeiro** match, então o segundo pedido com o mesmo id fica
  efetivamente invisível para essas buscas, incluindo a própria
  recuperação de idempotência deste PR.
- **Necessidade de um identificador realmente único**: um UUID
  (`crypto.randomUUID()`, já usado em `ownerToken`/`statusToken`/
  `clientRequestId` neste mesmo programa) elimina a colisão por
  construção, ao custo de deixar de ser ordenável cronologicamente pelo
  próprio valor (hoje `pedidoId` também serve, informalmente, de proxy de
  ordenação temporal em alguns lugares — precisaria de auditoria separada
  para confirmar se algum consumidor depende disso). Alternativa que
  preserva ordenação: manter `Date.now()` como prefixo e apensar um sufixo
  aleatório curto (`${Date.now()}-${crypto.randomUUID().slice(0,8)}`) ou
  usar um contador atômico Redis (`INCR`, mesmo padrão já usado por
  `proximoNumeroPedido`) como sufixo de desambiguação.
- **Relação com o lock/append atômico (seções 3-5)**: qualquer solução para
  a corrida de escrita da chave `pedidos` deveria, no mesmo trabalho,
  garantir unicidade de `pedidoId` — por exemplo, a Opção B (script Lua)
  poderia verificar unicidade antes do `table.insert` e regenerar o id se
  colidir, dentro da mesma operação atômica; a Opção A (lock) poderia gerar
  o id **depois** de adquirir o lock (usando o snapshot já lido para
  conferir colisão) em vez de antes.
- **Relação com os estados `pending_critical_confirmation`/`completed`/
  `recovery_required`** (revisão de segurança #4, implementada neste PR):
  a atualização de estado (`marcarSurvivalStateDoPedido`) também busca por
  `pedidoId` dentro de `pedidos` — sofre exatamente a mesma ambiguidade se
  dois pedidos colidirem no mesmo id. Qualquer implementação futura desta
  decisão precisa cobrir esse update de estado como parte do MESMO
  lock/atomicidade da criação, não como uma operação separada e
  desprotegida.

Nenhuma mudança de `pedidoId` foi implementada neste PR — permanece
`Date.now().toString()`, sem alteração de comportamento. Este risco é
formalizado aqui para que a decisão futura sobre a chave `pedidos` (seções
3-5) resolva os dois problemas (corrida de escrita + colisão de
identidade) numa única mudança coerente, em vez de duas mudanças
separadas que poderiam se contradizer.

### 6.1 Escopo completo que qualquer implementação futura precisa cobrir junto (4ª revisão de segurança)

A 4ª rodada de revisão de segurança pediu explicitamente que esta decisão
considere, **em conjunto** (não como mudanças isoladas que poderiam se
contradizer), todos os pontos abaixo — a lista consolidada, incluindo o que
já existia nas seções 1-6 e o que foi introduzido pelas correções mais
recentes do PR 1:

- **Append atômico/lock da chave `pedidos`** (Opções A/B, seção 3): a
  corrida de escrita entre `clientRequestId`s diferentes.
- **Atualização `pending_critical_confirmation` → `completed`**
  (`marcarSurvivalStateDoPedido`): já apontada na seção 6 — busca por
  `pedidoId` dentro do mesmo array, sofre a mesma ambiguidade de colisão de
  id, precisa do MESMO lock/atomicidade da criação.
- **Rollback do resgate** (remoção do pedido de `pedidos` quando
  `confirmarResgatePontos` falha): é uma terceira operação de
  read-modify-write sobre a MESMA chave `pedidos`, hoje sem qualquer
  proteção contra a corrida da seção 1 — se a decisão desta seção adotar um
  lock/append atômico só para a CRIAÇÃO, o rollback continuaria vulnerável a
  perder/reintroduzir pedidos de outros clientes por escrita concorrente.
  Qualquer solução final precisa decidir explicitamente se o rollback
  entra no mesmo mecanismo de proteção ou se fica deliberadamente fora,
  com o risco residual documentado (mesma lógica já aplicada à edição/status
  do painel abaixo).
- **Edição/status do painel `/pedidos`** (edição de pedido, cancelamento,
  mudança de status, confirmação de Pix manual): já citados na seção 5 como
  outros consumidores do padrão `GET pedidos` → `SET pedidos` completo — a
  decisão final precisa declarar se ficam fora do escopo (risco residual
  aceito, já que tipicamente é um único atendente por vez) ou se também
  precisam do mesmo lock/atomicidade.
- **`pedidoId` único** (seção 6): a colisão por `Date.now()` — resolvida
  idealmente na MESMA operação atômica que resolve a corrida de escrita
  (gerar/conferir o id só depois de adquirir o lock, ou dentro do próprio
  script Lua).
- **"Attempt" de identidade estável** (revisão de segurança, 4ª rodada,
  ponto 3, já implementado neste PR em `src/survival/pedidoIdempotencia.ts`
  — chave separada `survival:idempotencia:pedido:{clientRequestId}:attempt`,
  fora de `pedidos`): fixa `pedidoId`/`txid` ANTES de qualquer efeito externo
  (Jornada, Pix), sobrevivendo a uma persistência que falhe. Isso já
  resolve, por construção, o caso de retry-com-mesmo-clientRequestId gerando
  um pedidoId novo — mas não substitui a necessidade de um `pedidoId`
  globalmente único entre `clientRequestId`s DIFERENTES (o risco desta
  seção 6 continua real mesmo com o attempt implementado). Qualquer solução
  futura de unicidade de `pedidoId` (ex.: sufixo de `INCR` atômico) precisa
  ser compatível com o valor já fixado pelo attempt — nunca gerar um
  `pedidoId` diferente do que o attempt já reivindicou para aquele
  `clientRequestId`.
- **Custo Redis**: qualquer lock/atomicidade adicional (Opção A: +2
  comandos por criação; Opção B: substitui `GET`+`SET` por 1 `EVAL`) se soma
  ao custo já existente do attempt (+1 `SET NX`/`GET` por criação, ver
  `docs/architecture/MODO_SOBREVIVENCIA_1_0.md`) — a decisão final deve
  recalcular o total combinado, não avaliar cada peça isoladamente.
- **Compatibilidade com Pix e Jornada do Chef**: o `pedidoId` (agora
  estabilizado pelo attempt) é a base determinística do `txid`
  (`gerarTxidPixInterno`) e, por consequência, da `X-Idempotency-Key` do
  Mercado Pago — qualquer mudança futura no formato/geração de `pedidoId`
  (ex.: sufixo `INCR`) precisa preservar essa cadeia determinística para não
  reabrir o risco de cobrança duplicada. O vínculo da Jornada do Chef
  (`confirmarReservaNoPedido`, idempotente por `pedidoId`) tem a mesma
  dependência: uma mudança de formato de `pedidoId` precisa ser auditada
  contra os dois fluxos antes de ser adotada.

Nenhuma implementação foi feita para nenhum destes pontos além do que já
está descrito nas seções anteriores (attempt, estados
pending/completed/recovery_required). **Sem PostgreSQL, sem dual-write, sem
contratar serviço novo, sem ativar recurso pago** — a mitigação, quando
decidida, permanece inteiramente dentro do Redis/Upstash já em uso.

## 8. Implementação (este PR): o que foi construído, custo e limitações

Este PR implementa a variante da **Opção A** (lock distribuído curto), ao
invés da Opção B (Lua puro), pelo mesmo motivo apontado na seção 4: reaproveita
100% o padrão já validado em produção (`mercadoPagoReconciliacao.ts`,
`pedidoEdicao.ts`) sem depender de confirmar suporte a `cjson` no ambiente Lua
da Upstash. O mecanismo, o desenho de `pedidoId` e a estratégia de `revision`
foram resolvidos **juntos**, como a seção 6.1 pedia.

### 8.1 Módulo central — `src/lib/pedidosStore.ts`

Único ponto autorizado a fazer `GET`+mutação+`SET` da chave `pedidos`.
Operações nomeadas (nunca um helper genérico): `adicionarPedidoAtomico`,
`atualizarPedidoAtomico` (com `expectedRevision` opcional),
`mutarPedidoPorIdAtomico` (atalho sem checagem de revisão),
`removerPedidoAtomico`, `mutarLotePedidosAtomico` (escape hatch documentado
para transformações em lote), `listarPedidos`/`buscarPedido` (leitura, sem
lock), e `executarComLockPedidos` (escape hatch para os pouquíssimos
consumidores que precisam gravar `pedidos` atomicamente JUNTO com outra
chave na mesma operação — ex.: atribuição de entregador com fila em Lua,
merge por id da reconciliação Mercado Pago).

Lock: `SET lock:pedidos:mutex NX EX 5` + token aleatório (`crypto.randomUUID`)
+ liberação por Lua compare-and-delete (nunca um `DEL` cego — uma execução
cujo lock expirou por TTL nunca libera o lock de uma execução nova que já
tenha adquirido a chave). Retry limitado (40 tentativas, 20-50ms + jitter,
~2s de espera total no pior caso) — nunca espera indefinidamente; esgotar os
retries devolve `lock_indisponivel`, que cada endpoint traduz em **503
recuperável** (nunca um 500 cru, nunca finge sucesso).

A seção crítica contém **só** GET fresco → validação de identidade → aplica
mutação → SET. O lock **nunca** envolve chamada de rede externa (Mercado
Pago, WhatsApp, cardápio, autenticação) — endpoints que precisam desse
trabalho pesado (ex.: `editar/salvar`, que cria cobrança Pix) o fazem
**antes** de entrar na seção crítica, e revalidam o estado fresco dentro do
lock só no commit final.

### 8.2 `pedidoId` — `gerarPedidoIdUnico()`

`${Date.now()}${randomBytes(4).toString("hex")}` — substitui
`Date.now().toString()` isolado. Nunca colide, mesmo com centenas de criações
no mesmo milissegundo (testado com 5000 gerações no mesmo ms — unicidade
100%). Auditoria de TODOS os consumidores de `pedidoId` confirmou apenas um
site com suposição numérica (`timestampOrdenacaoPedido` em
`clientePedidos.ts`), já defensivamente coberto por fallback de data+horario;
`txid`/`X-Idempotency-Key`/vínculo da Jornada são interpolação de string pura,
sem suposição numérica. Pedidos legados com id puramente numérico continuam
funcionando sem qualquer migração de dado.

### 8.3 `revision` — controle de concorrência otimista

Campo já existente (`PedidoComEdicao.revision?: number`) agora é a fonte de
verdade para conflito controlado: toda atualização via `atualizarPedidoAtomico`
pode exigir uma revisão esperada — divergência devolve `conflito_revisao`
(409 para o cliente, nunca sobrescreve silenciosamente uma mudança mais
nova). Pedidos legados sem `revision` usam o fallback documentado (`1`) e
ganham uma revisão válida na primeira mutação pelo módulo. `salvar/route.ts`
(edição do cliente) é o único fluxo que usa `expectedRevision` de verdade
hoje; os demais usam `mutarPedidoPorIdAtomico` (sem checagem) porque são
mutações best-effort de campo único sem um "valor esperado" do lado do
chamador — ainda protegidas pelo MESMO lock global contra perda de mutação
concorrente de outro pedido, só não contra conflito no MESMO pedido (risco
residual documentado abaixo, seção 8.6).

### 8.4 Custo Redis (recontado, combinado — não por peça)

Caminho feliz de uma mutação de um único pedido (`adicionarPedidoAtomico`/
`atualizarPedidoAtomico`/`removerPedidoAtomico`/`mutarPedidoPorIdAtomico`):

| Comando | Quando |
|---|---|
| `SET lock:pedidos:mutex NX EX 5` | Sempre (aquisição do lock) |
| `GET pedidos` | Sempre (leitura fresca dentro do lock) |
| `SET pedidos` | Sempre (escrita) |
| `EVAL` (compare-and-delete) | Sempre (liberação do lock) |

**4 comandos por mutação no caminho feliz** — 2 a mais do que o `GET`+`SET`
direto de antes (a Opção A da seção 3 já previa exatamente isso). Sob
contenção (lock ocupado por outra execução), soma-se 1 `SET NX` extra por
tentativa de retry (até 40, mas o caso comum sob concorrência real de poucos
writers simultâneos são 1-3 tentativas antes de conseguir o lock). O escape
hatch `executarComLockPedidos` (atribuição de entregador, reconciliação Pix)
soma o mesmo custo de lock (`SET`+`EVAL`) em cima do que essas operações já
faziam.

**Latência adicionada:** desprezível no caminho feliz (lock sem contenção =
1 round-trip de `SET NX` a mais, tipicamente <10ms na rede Upstash). Sob
contenção, cada tentativa de retry aguarda 20-50ms + jitter — no pior caso
teórico (40 tentativas esgotadas) chega a ~2s, mas isso só acontece com um
volume de escritas concorrentes na MESMA janela muito acima do observado em
produção hoje (pico é dezenas de pedidos por hora, não por segundo).

**Comportamento sob 2/10/50 mutações concorrentes** (medido nos testes de
concorrência, `src/lib/pedidosStore.concorrencia.test.ts`): nenhuma perdida,
nenhuma duplicada, em todos os três volumes — o lock serializa a seção
crítica (GET+SET), então o custo cresce linearmente com o número de mutações
concorrentes disputando a MESMA janela (cada uma espera a anterior liberar o
lock), não exponencialmente. Isso é esperado e aceitável para os volumes
reais do negócio (não há dezenas de pedidos sendo criados por segundo).

**Tamanho atual do array `pedidos`:** não recontado neste PR (nenhuma
mudança na estratégia de arquivamento/limpeza — `cron/limpeza`,
`cron/route.ts`, `arquivar` continuam removendo pedidos antigos do array
normalmente, agora via `mutarLotePedidosAtomico`). O custo de serializar o
array inteiro a cada `SET` já existia antes deste PR e não piora — só se
soma o `GET`+`EVAL`+`SET` extra do lock.

**Limite operacional conhecido:** este mecanismo serializa TODAS as mutações
de `pedidos` atrás de um único lock global, independente de quais pedidos
estão envolvidos. Isso significa que o sistema tem um teto de throughput de
escrita = (1 / duração média da seção crítica) mutações por segundo,
somado entre TODOS os canais (site, WhatsApp, painel, cron, webhooks). Não
foi medido um número absoluto de mutações/segundo suportável — a suposição
de segurança é que o volume real de pedidos do negócio está ordens de
magnitude abaixo desse teto. **Não alegamos escala infinita.** Este é uma
mitigação segura para a arquitetura Redis/Upstash **atual**, não um
substituto para um banco transacional — se o volume de escrita concorrente
crescer significativamente (ex.: múltiplas lojas, volume 10-100x maior), a
migração a PostgreSQL (`ADR-POSTGRES-SOURCE-OF-TRUTH.md`, programa separado)
continua sendo a solução definitiva.

### 8.5 Compatibilidade Pix/Jornada/fidelidade (auditada, não alterada além do necessário)

- **Pix:** o mesmo `pedidoId`/`txid`/`X-Idempotency-Key` de uma tentativa é
  preservado através de qualquer retry (nada mudou na cadeia determinística
  `gerarTxidPixInterno`). Confirmação manual (`confirmar-pix-manual`) e
  webhook (`pix/webhook`) agora revalidam idempotência/cobrança-substituída
  DENTRO do lock antes de gravar — corrida entre os dois nunca gera dupla
  cobrança nem sobrescreve o resultado um do outro (o que chega primeiro
  vence, o segundo recebe `pix_ja_confirmado`/409 sem reescrever nada). A
  reconciliação periódica (`mercadoPagoReconciliacao.ts`) manteve 100% da sua
  lógica de merge-por-id/"primeira confirmação vence" — só a releitura+escrita
  final passou a rodar sob o mesmo lock global, fechando a última janela de
  corrida com outro writer.
- **Jornada do Chef:** vínculo por `pedidoId` inalterado; rollback
  (`removerPedidoAtomico`) sempre revalida existência e mira exatamente o id
  correto dentro do lock, nunca reintroduz nem remove um pedido diferente.
- **Fidelidade:** nenhuma mudança nos fluxos de crédito/estorno de pontos —
  eles não escrevem a chave `pedidos` diretamente (confirmado na auditoria de
  writers, seção 8.7); continuam lendo o pedido (agora sempre via
  `pedidosStore` nos writers migrados) para decidir o crédito.

### 8.6 Riscos residuais conhecidos (não resolvidos por este PR)

- **`mutarPedidoPorIdAtomico` sem `expectedRevision`:** a maioria dos writers
  migrados usa a variante sem checagem de revisão (mutação best-effort de
  campo único). Isso protege contra PERDA de mutação concorrente (o lock
  global garante isso sempre), mas não contra um CONFLITO SEMÂNTICO no mesmo
  pedido (ex.: painel aceita o pedido no mesmo instante em que o cliente tenta
  salvar uma edição) além do que os próprios guards de negócio (`editStatus`,
  `pedidoAguardandoAceite`, etc., revalidados frescos dentro do lock) já
  cobrem. `editar/salvar` é o único fluxo com `expectedRevision` real hoje.
- **Tamanho do array `pedidos`:** continua crescendo indefinidamente até ser
  arquivado/limpo pelos crons existentes — este PR não muda essa estratégia,
  só protege as mutações dela.
- **Teto de throughput:** ver seção 8.4 — não medido em número absoluto,
  aceito como adequado para o volume real do negócio hoje.

### 8.7 Escopo da migração de writers

Auditoria completa (Explore agent) encontrou 15 read-only consumers (sem
escrita, fora do escopo) e ~22 read-modify-write writers em produção — todos
migrados para `pedidosStore.ts` neste PR: `pedido-app/route.ts` (criação,
rollback de resgate, `survivalState`), `whatsapp/route.ts` (8 sites:
criação, escalonamento, cancelamento solicitado, fechamento de
escalonamento, evidência/confirmação/rejeição de Pix por texto e mídia,
confirmação de entrega), `orders/route.ts` (limpeza preguiçosa, mudança de
status/atribuição de entregador, criação manual, remoção individual/em
lote), `confirmar-pix-manual`, `arquivar`, `pix/webhook`,
`mercadoPagoReconciliacao.ts`, `resolver`, `finalizar-atendimento`, os 4
endpoints de edição do cliente (`iniciar`/`salvar`/`descartar`/`status`),
3 crons (`limpeza`, `pix-pendente`, `route.ts`), `bot/route.ts` (simulador,
incluindo o `DELETE` de reset total) e `dev/reset`. Um teste de arquitetura
(`src/lib/pedidosStore.arquitetura.test.ts`) falha automaticamente se um novo
writer direto for criado fora da allowlist explícita do escape hatch.

## 9. Bloqueio explícito

Enquanto esta decisão não for revisada e aprovada, **`SURVIVAL_MODE_ENABLED`
não deve ser ativado em Production** — a idempotência por `clientRequestId`
(PR 1) é real e testada, mas não é uma substituta para a proteção da chave
`pedidos` como um todo, e ativar o Modo Sobrevivência sem essa peça deixaria
uma lacuna conhecida e não comunicada.
