# BEHAVIOR ANALYTICS V1 — Camada de monitoramento comportamental

## Objetivo

Registrar a jornada de uso do cliente antes, durante e depois da compra para permitir evolução do Cofre do Chefe, retenção, UX, funil e futura decisão econômica baseada em comportamento real.

Esta camada é analítica. Ela não altera preço, pedido, Pix, fidelidade, Ranking, estoque, impressão ou WhatsApp.

## Princípios

1. Eventos comportamentais nunca são fonte de verdade financeira.
2. Pedido criado, valor, pagamento e demais fatos comerciais continuam vindo do servidor oficial.
3. Identidade nunca é aceita do body da telemetria.
4. Eventos usam sessão aleatória e, quando possível, actor pseudonimizado.
5. Nome, telefone, endereço, observação do pedido, token, OTP e texto livre não entram no evento comportamental.
6. Preview nunca escreve telemetria comportamental real.
7. Nenhum evento sozinho autoriza cupom ou benefício.
8. Retenção é obrigatória e configurável; ausência de configuração mantém o coletor desligado.

## Fluxo

Navegador
→ fila local em memória
→ POST /api/comportamento
→ validação allowlist
→ rate limit
→ associação com sessão autenticada ou cookie assinado do link oficial do WhatsApp
→ pseudonimização server-side
→ Redis com TTL
→ índices globais / por sessão / por ator
→ APIs dev somente leitura
→ agregação para funil e resumo individual.

## Identidade e sessões

Cada aba recebe um sessionId UUID salvo em sessionStorage.

Antes de o cliente ser identificado, eventos ficam vinculados somente à sessão. Não há identificador anônimo persistente entre sessões nem índice comportamental por visitante.

Quando a mesma sessão produz um fato autenticado ou um pedido oficial, o servidor registra um evento associado ao cliente pseudonimizado. A leitura individual pode então recuperar também os eventos anônimos anteriores daquela mesma sessão.

Quando o cliente abre um link oficial do WhatsApp, o servidor valida o token e define cookie HttpOnly de finalidade restrita com pseudônimo HMAC assinado e validade de 30 dias; escolher outro WhatsApp apaga o cookie do navegador. O cookie só é enviado ao endpoint de telemetria, não autentica compras e nunca contém telefone ou clienteId. Sessões sem login, sem link oficial e sem pedido permanecem anônimas.

## Eventos V1

### Acesso e navegação
- app_open
- whatsapp_link_verified
- screen_view
- page_exit

### Interesse
- search_used
- category_view
- product_view

### Carrinho
- cart_state
- cart_add
- cart_remove
- cart_quantity_change

### Checkout
- checkout_start
- delivery_step_view
- payment_step_view
- order_submit_attempt
- action_result (sucesso/falha do envio; categorias técnicas controladas)

### Relacionamento
- fidelity_open
- ranking_open
- cofre_open

### Fato oficial
- order_created

order_created é gerado no servidor somente depois de o pedido existir.

## Contexto permitido

Somente campos explicitamente permitidos podem ser persistidos:

- screen;
- source;
- categoryId;
- productId;
- cartItems;
- cartDistinctItems;
- queryLength;
- resultCount;
- deliveryType;
- paymentFamily;
- target;
- pedidoId apenas em evento server-side;
- deviceClass: mobile/tablet/desktop;
- viewportClass: compact/medium/wide;
- displayMode: browser/standalone;
- referrerKind: direct/internal/external/whatsapp_link;
- engagementMs.

Qualquer campo fora da allowlist é descartado.

## Dados propositalmente não coletados nos eventos

- nome;
- apelido;
- telefone;
- endereço;
- bairro em texto;
- rua/número/referência;
- observação do pedido;
- texto digitado na busca;
- mensagem de WhatsApp;
- senha;
- OTP;
- token de sessão;
- token de status do pedido;
- QR/Payload Pix;
- número de cartão;
- geolocalização precisa;
- user-agent cru;
- IP persistido.

O IP recebido pela infraestrutura pode ser usado apenas para rate limit técnico. A chave do rate limit é HMAC/pseudonimizada e expira rapidamente.

## Contexto técnico coarse

No app_open o navegador pode informar:
- classe de dispositivo;
- classe de viewport;
- PWA/browser;
- origem coarse do acesso.

Não é armazenado user-agent cru.

No page_exit é registrado tempo de engajamento ativo da página. Tempo com a aba oculta é descontado.

## Redis

Namespace:
- behavior:v1:event:{tenant}:{eventId}
- behavior:v1:idx:{tenant}:{YYYYMMDD}
- behavior:v1:actor:{tenant}:{actorHash}:{YYYYMMDD}
- behavior:v1:session:{tenant}:{sessionId}:{YYYYMMDD}
- behavior:v1:rate:{hash}:{janela}

Eventos são idempotentes por eventId. Se a gravação do evento tiver sucesso e a criação de algum índice falhar, o retry relê o evento canônico e completa os índices com operações idempotentes, sem substituir o evento. Todos os eventos e índices recebem TTL de retenção.

### Custo Redis por sessão

Para cada evento novo e único, o coletor executa:
- 1 `SET NX EX` para o evento;
- 2 comandos por índice (`ZADD` + `EXPIRE`) para os índices global e de sessão;
- mais 2 comandos (`ZADD` + `EXPIRE`) quando o evento está associado a um cliente autenticado.

Assim, o custo normal é **5 comandos Redis por evento anônimo** ou **7 por evento associado**. Cada lote HTTP acrescenta um `INCR` ao rate limit e o primeiro lote de uma chave/janela acrescenta um `EXPIRE`. Com lotes cheios de até 20 eventos, a estimativa é:

| Eventos únicos na sessão | Anônimo | Associado |
| ---: | ---: | ---: |
| 10 | ~52 comandos | ~72 comandos |
| 20 | ~102 comandos | ~142 comandos |
| 40 | ~204 comandos | ~284 comandos |

A tabela supõe lotes cheios, uma janela de rate limit e eventos gravados sem retry. Cada pedido oficial acrescenta **7 comandos quando associado a um cliente** ou **5 quando anônimo**. O cliente também envia lotes após uma espera curta, então sessões com pausas podem usar mais requisições HTTP e comandos de rate limit. Reenvios idempotentes não criam eventos duplicados, mas consultam o evento existente e repetem os comandos dos índices para repará-los. São estimativas de operações Redis, não preços: o custo monetário depende do plano e da região. O Redis é usado também por outros recursos do ChefeBot; para atribuir custo real ao módulo, instrumentar contadores de operações na aplicação para as chaves `behavior:v1` e comparar com a linha de base geral do Redis.

## Release gates

Servidor:
BEHAVIOR_ANALYTICS_ENABLED=true

Cliente:
NEXT_PUBLIC_BEHAVIOR_ANALYTICS_ENABLED=true

Retenção:
BEHAVIOR_ANALYTICS_RETENTION_DAYS=<7..730>

Segredo de pseudonimização:
BEHAVIOR_ANALYTICS_HASH_SECRET=<segredo server-side com no mínimo 24 caracteres>

Fallback permitido do segredo:
AUTH_SECRET.

Mesmo com as flags, VERCEL_ENV=preview bloqueia escrita no servidor.

## Leitura administrativa

### Funil agregado
GET /api/dev/comportamento/resumo?periodo=7|30|60|90

Retorna, entre outros:
- eventos;
- sessões;
- sessões com busca;
- sessões com produto;
- sessões com carrinho;
- sessões com checkout;
- sessões com pedido;
- abandono de checkout;
- conversão checkout→pedido;
- conversão sessão→pedido;
- mediana abertura→pedido;
- mediana de tempo ativo;
- contagem por tipo de evento.

Não retorna identidade de cliente.

### Cliente individual
POST /api/dev/comportamento/cliente

Entrada da sala Dev:
- telefone;
- período 7/30/60/90.

O telefone é usado apenas no servidor para localizar o cliente e derivar o ID canônico. A resposta não devolve telefone nem actorHash. Os endpoints antigos sob `/api/admin/comportamento/*` aceitam somente perfil `dev`; administradores da pizzaria recebem 401.

Retorna somente:
- linha do tempo;
- resumo comportamental individual (sem nome, apelido, telefone, endereço ou actorHash);
- resumo comportamental individual:
  - sessões;
  - sessões com e sem pedido;
  - acessos;
  - pesquisas;
  - produtos vistos;
  - interações de carrinho;
  - entradas no checkout;
  - aberturas do Ranking;
  - aberturas da fidelidade;
  - tempo ativo;
  - intervalo mediano entre sessões;
  - primeira e última observação.

Não retorna nome, apelido, telefone ou endereço. O telefone de entrada é usado somente no servidor para resolver o ID canônico e não é ecoado. A leitura limita-se a 1.000 eventos por cliente/período; quando `timeline.truncated` for verdadeiro, contagens e medianas podem estar incompletas.

### Métricas disponíveis e derivação futura

O resumo atual calcula sessões com/sem pedido, aberturas, buscas, produtos vistos, interações de carrinho, entradas no checkout, aberturas de Ranking/Fidelidade, engajamento somado/mediano, mediana de dias entre sessões e primeira/última observação. A timeline permite derivar dias ativos por data UTC distinta e comportamento recente versus histórico comparando períodos iguais dentro da janela de 90 dias. Também permite contar sessões com carrinho, checkout sem pedido e tempo entre primeira abertura e pedido, agrupando por `sessionId`; essas três métricas ainda não fazem parte do resumo individual.

O intervalo entre pedidos exige eventos `order_created` completos e deduplicados para o mesmo ator, ou deve ser calculado a partir do histórico oficial de pedidos. Para decisões econômicas, o histórico oficial é a fonte de verdade. Até implementar essas métricas no resumo com paginação/limites explícitos, qualquer timeline truncada deve ser tratada como amostra e não como histórico completo.

## Cobertura inicial

Instrumentado:
- /cardapio e /pedido, pelo PublicCardapio compartilhado;
- /cliente;
- /cliente/pedidos;
- /rastrear/[pedidoId];
- criação oficial do pedido no servidor.

A Sala Dev permite localizar uma jornada pelo telefone informado pelo próprio cliente, revisar eventos em ordem temporal e ver padrões como falha de checkout, checkout sem pedido e produto revisitado. A interface explica quando o histórico é truncado ou não contém eventos. A timeline mostra somente campos allowlisted e não exibe identidade civil.

## Relação com o Cofre do Chefe

Behavior Analytics V1 fornece sinais para o futuro Motor de Próxima Melhor Ação.

Exemplos de sinais possíveis no futuro:
- muitas sessões sem compra;
- pesquisa recorrente;
- repetição de visualização;
- carrinho recorrente sem checkout;
- checkout abandonado;
- cliente que compra sem incentivo;
- intervalo entre acessos aumentando;
- acesso ao Ranking antes de comprar.

Nenhum desses sinais possui threshold comercial hardcoded nesta camada. Os sinais exibidos na Sala Dev orientam investigação de UX; eles não disparam descontos nem ações invisíveis sobre o cliente.

## Ativação econômica

Esta camada não decide valor de cupom.

O motor econômico deve cruzar comportamento com:
- CMV oficial por item/variante;
- custos variáveis aprovados;
- margem mínima;
- orçamento;
- venda incremental estimada.

Sem essas fontes, benefícios financeiros continuam fail-closed.

## Preview

Preview pode executar UI e testes com flags cliente ligadas, mas o servidor bloqueia escrita quando VERCEL_ENV=preview.

É proibido validar esta camada escrevendo no Redis de produção durante Preview.

## Critério de sucesso da V1

A V1 está tecnicamente pronta quando:
- taxonomia está allowlisted;
- sessão é idempotente;
- cliente não é confiado do navegador;
- pedido oficial liga sessão à conversão;
- eventos anônimos não são forçados a uma identidade;
- retenção existe;
- Preview não escreve;
- admin do dono não acessa a consulta individual; resposta Dev não expõe telefone/actorHash;
- cobertura dos fluxos públicos relevantes está testada;
- suíte, lint, typecheck e build passam.
