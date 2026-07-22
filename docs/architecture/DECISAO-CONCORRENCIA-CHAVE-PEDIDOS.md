# Decisão técnica pendente: corrida read-modify-write na chave `pedidos`

**Status: proposta para revisão — nada neste documento foi implementado.**
A ativação do Modo Sobrevivência em Production (`SURVIVAL_MODE_ENABLED=true`)
permanece bloqueada até esta decisão ser revisada e aprovada separadamente.

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

## 7. Bloqueio explícito

Enquanto esta decisão não for revisada e aprovada, **`SURVIVAL_MODE_ENABLED`
não deve ser ativado em Production** — a idempotência por `clientRequestId`
(PR 1) é real e testada, mas não é uma substituta para a proteção da chave
`pedidos` como um todo, e ativar o Modo Sobrevivência sem essa peça deixaria
uma lacuna conhecida e não comunicada.
